import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, appendFileSync } from "node:fs";
import { lstat, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  AdapterFault,
  contract,
  fingerprint,
  label,
} from "./adapter-contract.ts";
import { canonical } from "./domain.ts";

/**
 * Projection of the official app-server `initialize` result.
 *
 * The online documentation for the fixed build is the only available schema
 * source, and it is explicitly not a schema for this machine. Only labelled
 * fields that can be type-checked are surfaced; every other key is counted and
 * dropped, so an unknown field can never become a capability claim.
 */
export interface CodexInitialize {
  protocol_version: string | null;
  user_agent: string | null;
  declared: {
    approvals: boolean;
    request_user_input: boolean;
    interrupt: boolean;
  };
  unrecognized_fields: number;
  schema: "candidate/1";
}
export interface CodexStatistics {
  requests: number;
  responses: number;
  notifications: number;
  unknown_notifications: string[];
  refused_server_requests: number;
  last_method: string | null;
  turn_state: "none" | "running" | "completed" | "failed" | "interrupted";
}
export interface CodexExit {
  code: number | null;
  signal: string | null;
  exit_observed: boolean;
  forced: boolean;
  fault: string | null;
  stderr_bytes: number;
  frames_in: number;
  frames_out: number;
  statistics: CodexStatistics;
}
export interface CodexHandle {
  readonly status: {
    state: "initializing" | "ready" | "busy" | "closing" | "closed";
    fault: string | null;
  };
  readonly statistics: CodexStatistics;
  /** Fresh isolated directory created for this launch; the native thread's cwd. */
  readonly workDirectory: string;
  ready: Promise<CodexInitialize>;
  closed: Promise<CodexExit>;
  /** Native thread creation; the returned identifier is an opaque native value. */
  startThread(cwd: string): Promise<string>;
  /** One synthetic acceptance instruction. No free-form text channel exists. */
  startTurn(threadId: string, text: string): Promise<string | null>;
  interruptTurn(threadId: string, turnId: string): Promise<void>;
  close(): void;
}
export interface CodexLauncher {
  readonly fingerprint: string;
  readonly clientVersion: string;
  readonly source: "official_codex" | "development_fixture";
  launch(stillAuthorized: () => boolean): Promise<CodexHandle>;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AdapterFault("CODEX_PROTOCOL");
  return value as Record<string, unknown>;
}
const known = new Set([
  "protocolVersion",
  "userAgent",
  "capabilities",
  "serverInfo",
]);
function initializeFrame(value: unknown, id: number): CodexInitialize {
  const frame = object(value);
  if ("jsonrpc" in frame && frame.jsonrpc !== "2.0")
    throw new AdapterFault("CODEX_PROTOCOL");
  if (frame.id !== id || "method" in frame)
    throw new AdapterFault("CODEX_PROTOCOL");
  if ("error" in frame) {
    const error = object(frame.error);
    if (!Number.isSafeInteger(error.code))
      throw new AdapterFault("CODEX_PROTOCOL");
    throw new AdapterFault(
      typeof error.message === "string" &&
        /unauthor|login|auth|token|401|403/i.test(error.message)
        ? "CODEX_AUTH_REQUIRED"
        : "CODEX_INITIALIZE_REJECTED",
    );
  }
  if (!("result" in frame)) throw new AdapterFault("CODEX_PROTOCOL");
  const result = object(frame.result);
  const optionalLabel = (key: string) => {
    const v = result[key];
    if (v === undefined) return null;
    if (!label(v)) throw new AdapterFault("CODEX_PROTOCOL");
    return v;
  };
  const caps =
    result.capabilities === undefined ? {} : object(result.capabilities);
  const flag = (key: string) => {
    if (caps[key] !== undefined && typeof caps[key] !== "boolean")
      throw new AdapterFault("CODEX_PROTOCOL");
    return caps[key] === true;
  };
  return {
    protocol_version: optionalLabel("protocolVersion"),
    user_agent: optionalLabel("userAgent"),
    declared: {
      approvals: flag("approvals"),
      request_user_input: flag("requestUserInput"),
      interrupt: flag("interrupt"),
    },
    unrecognized_fields: Object.keys(result).filter((k) => !known.has(k))
      .length,
    schema: "candidate/1",
  };
}
/**
 * Bounded JSONL transport for the candidate app-server entry. Exactly four
 * client requests are expressible (initialize, thread/start, turn/start,
 * turn/interrupt); there is no generic request, shell, approval reply or
 * process control method. Server-initiated requests are always refused.
 */
export class CodexAppServer implements CodexHandle {
  readonly ready: Promise<CodexInitialize>;
  readonly closed: Promise<CodexExit>;
  readonly workDirectory: string;
  readonly statistics: CodexStatistics = {
    requests: 0,
    responses: 0,
    notifications: 0,
    unknown_notifications: [],
    refused_server_requests: 0,
    last_method: null,
    turn_state: "none",
  };
  private child: ChildProcessWithoutNullStreams;
  private resolveReady!: (value: CodexInitialize) => void;
  private rejectReady!: (error: Error) => void;
  private resolveClosed!: (value: CodexExit) => void;
  private resolveRequest:
    ((frame: Record<string, unknown>) => void) | undefined;
  private rejectRequest: ((error: Error) => void) | undefined;
  private pendingId: number | null = null;
  private nextId = 1;
  private ended = false;
  private closing = false;
  private forced = false;
  private fault: string | null = null;
  private stderrBytes = 0;
  private stdoutBytes = 0;
  private framesIn = 0;
  private framesOut = 0;
  private pending = Buffer.alloc(0);
  private requestTimer?: NodeJS.Timeout;
  private closeTimer?: NodeJS.Timeout;
  private finalTimer?: NodeJS.Timeout;
  private readonly closeMs: number;
  private readonly requestMs: number;
  private initialized = false;
  constructor(
    child: ChildProcessWithoutNullStreams,
    options: {
      requestMs?: number;
      closeMs?: number;
      workDirectory?: string;
      onStderr?: (bytes: Buffer) => void;
    } = {},
  ) {
    this.child = child;
    this.workDirectory = options.workDirectory ?? process.cwd();
    contract(isAbsolute(this.workDirectory));
    this.closeMs = options.closeMs ?? 5000;
    this.requestMs = options.requestMs ?? 20000;
    contract(
      [this.closeMs, this.requestMs].every(
        (n) => Number.isInteger(n) && n > 0 && n <= 60000,
      ),
    );
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    void this.ready.catch(() => {});
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });
    child.once("spawn", () => {
      if (this.closing) return;
      // Exactly one initialization attempt; a late or duplicated reply fails closed.
      this.pendingId = 1;
      this.nextId = 2;
      this.statistics.last_method = "initialize";
      this.write({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: this.hello(),
      });
    });
    child.stdout.on("data", (data: Buffer) => this.consume(data));
    child.stderr.on("data", (data: Buffer) => {
      const retained = data.subarray(0, Math.max(0, 65536 - this.stderrBytes));
      this.stderrBytes += data.length;
      try {
        if (retained.length) options.onStderr?.(retained);
      } catch {
        this.fail("CODEX_DIAGNOSTIC_WRITE");
      }
      if (this.stderrBytes > 65536) this.fail("CODEX_STDERR_LIMIT");
    });
    child.stdin.on("error", () => {
      if (!this.closing) this.fail("CODEX_STDIN");
    });
    child.stdout.on("error", () => this.fail("CODEX_STDOUT"));
    child.stdout.once("end", () => {
      if (!this.closing) this.fail("CODEX_DISCONNECTED");
    });
    child.stderr.on("error", () => this.fail("CODEX_STDERR"));
    child.once("error", () => this.fail("CODEX_LAUNCH"));
    child.once("close", (code, signal) => {
      if (this.pending.length && !this.fault) this.fault = "CODEX_PROTOCOL";
      if (
        (code !== 0 || !this.initialized) &&
        (!this.fault || this.fault === "CODEX_DISCONNECTED")
      )
        this.fault = "CODEX_EXIT";
      this.finish(code, signal, true);
    });
    this.armRequest("CODEX_INITIALIZE_TIMEOUT");
  }
  private hello() {
    return {
      clientInfo: {
        name: "agent-weave",
        version: "0.3.0",
        title: "Agent Weave",
      },
      capabilities: { experimental: false, requestUserInput: false },
    };
  }
  get status(): CodexHandle["status"] {
    return {
      state: this.ended
        ? "closed"
        : this.closing
          ? "closing"
          : this.pendingId !== null
            ? "busy"
            : this.initialized
              ? "ready"
              : "initializing",
      fault: this.fault,
    };
  }
  private armRequest(code: string) {
    clearTimeout(this.requestTimer);
    this.requestTimer = setTimeout(() => this.fail(code), this.requestMs);
  }
  private request(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (this.ended) return Promise.reject(new AdapterFault("CODEX_CLOSED"));
    if (this.closing)
      return Promise.reject(new AdapterFault("CODEX_AUTHORIZATION_CHANGED"));
    if (this.pendingId !== null || !this.initialized)
      return Promise.reject(new AdapterFault("CODEX_BUSY"));
    return new Promise((resolveFrame, rejectFrame) => {
      const id = this.nextId++;
      this.pendingId = id;
      this.statistics.requests++;
      this.statistics.last_method = method;
      this.resolveRequest = resolveFrame;
      this.rejectRequest = rejectFrame;
      this.armRequest(timeoutCode(method));
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }
  private settle(code: string | null, frame?: Record<string, unknown>) {
    clearTimeout(this.requestTimer);
    this.pendingId = null;
    const resolveFrame = this.resolveRequest,
      rejectFrame = this.rejectRequest;
    this.resolveRequest = undefined;
    this.rejectRequest = undefined;
    if (code) rejectFrame?.(new AdapterFault(code));
    else resolveFrame?.(frame ?? {});
  }
  startThread(cwd: string) {
    if (!isAbsolute(cwd)) return Promise.reject(new AdapterFault("CODEX_CWD"));
    // Only the working directory is sent: no model, sandbox or approval policy is
    // invented for a schema that this machine has not been verified against.
    return this.request("thread/start", { cwd }).then((frame) => {
      const thread = object(frame.thread);
      if (!label(thread.id) || thread.id.length > 128)
        return this.protocolFailure();
      return thread.id;
    });
  }
  startTurn(threadId: string, text: string) {
    if (!label(threadId) || typeof text !== "string" || text.length > 4000)
      return Promise.reject(new AdapterFault("CODEX_TURN_ARGS"));
    return this.request("turn/start", {
      threadId,
      input: [{ type: "text", text }],
    }).then((frame) => {
      const turn = object(frame.turn),
        id = turn.id;
      if (id === undefined || id === null) return null;
      if (!label(id)) return this.protocolFailure();
      return id;
    });
  }
  interruptTurn(threadId: string, turnId: string) {
    if (!label(threadId) || !label(turnId))
      return Promise.reject(new AdapterFault("CODEX_TURN_ARGS"));
    return this.request("turn/interrupt", { threadId, turnId }).then(() => {});
  }
  private protocolFailure(): never {
    this.fail("CODEX_PROTOCOL");
    throw new AdapterFault("CODEX_PROTOCOL");
  }
  private write(frame: Record<string, unknown>) {
    if (this.ended) return;
    this.framesOut++;
    if (this.framesOut > 1000) return this.fail("CODEX_REQUEST_LIMIT");
    this.child.stdin.write(JSON.stringify(frame) + "\n");
  }
  private consume(data: Buffer) {
    if (this.ended) return;
    this.stdoutBytes += data.length;
    if (this.stdoutBytes > 1048576) return this.fail("CODEX_STDOUT_LIMIT");
    this.pending = Buffer.concat([this.pending, data]);
    for (;;) {
      const i = this.pending.indexOf(10);
      if (i < 0) {
        if (this.pending.length > 262144) this.fail("CODEX_FRAME_LIMIT");
        return;
      }
      const bytes = this.pending.subarray(0, i);
      this.pending = this.pending.subarray(i + 1);
      if (bytes.length > 262144) return this.fail("CODEX_FRAME_LIMIT");
      if (this.framesIn > 5000) return this.fail("CODEX_FRAME_COUNT");
      this.framesIn++;
      let frame: Record<string, unknown>;
      try {
        frame = object(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
        );
      } catch (error) {
        this.fail(
          error instanceof AdapterFault ? error.code : "CODEX_PROTOCOL",
        );
        return;
      }
      if ("jsonrpc" in frame && frame.jsonrpc !== "2.0")
        return this.fail("CODEX_PROTOCOL");
      if ("method" in frame) {
        if (typeof frame.method !== "string" || frame.method.length > 128)
          return this.fail("CODEX_PROTOCOL");
        if ("id" in frame) this.refuseServerRequest(frame);
        else this.notification(frame.method, frame);
        continue;
      }
      if (!("id" in frame)) return this.fail("CODEX_PROTOCOL");
      try {
        this.response(frame);
      } catch (error) {
        this.fail(
          error instanceof AdapterFault ? error.code : "CODEX_PROTOCOL",
        );
        return;
      }
    }
  }
  /** Approvals, clarifications and any other server request are never granted. */
  private refuseServerRequest(frame: Record<string, unknown>) {
    this.statistics.refused_server_requests++;
    if (this.statistics.refused_server_requests > 100)
      this.fail("CODEX_REQUEST_LIMIT");
    const id = frame.id;
    if (typeof id !== "string" && !Number.isSafeInteger(id))
      return this.fail("CODEX_PROTOCOL");
    this.write({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: "agent-weave refuses server-initiated requests in this mode",
      },
    });
  }
  private notification(method: string, frame: Record<string, unknown>) {
    this.statistics.notifications++;
    if (method === "turn/completed") {
      // The terminal status is read from a bounded field only; anything else is
      // recorded as unknown rather than promoted to a success claim.
      let status: unknown;
      try {
        status = object(frame.params ?? {}).turn
          ? object(object(frame.params).turn).status
          : undefined;
      } catch {
        status = undefined;
      }
      this.statistics.turn_state =
        status === "failed"
          ? "failed"
          : status === "interrupted"
            ? "interrupted"
            : "completed";
      return;
    }
    countOnce(this.statistics.unknown_notifications, method);
    if (this.statistics.unknown_notifications.length > 20)
      this.fail("CODEX_NOTIFICATION_LIMIT");
  }
  private response(frame: Record<string, unknown>) {
    const hasResult = "result" in frame,
      hasError = "error" in frame;
    if (hasResult === hasError) throw new AdapterFault("CODEX_PROTOCOL");
    if (this.pendingId === null || frame.id !== this.pendingId)
      throw new AdapterFault("CODEX_PROTOCOL");
    const method = this.statistics.last_method;
    if (method === "initialize") {
      const projection = initializeFrame(frame, frame.id as number);
      this.initialized = true;
      this.statistics.turn_state = "none";
      this.settle(null, object(frame.result));
      clearTimeout(this.requestTimer);
      this.write({ jsonrpc: "2.0", method: "initialized", params: {} });
      this.resolveReady(projection);
      return;
    }
    if (hasError) {
      const error = object(frame.error);
      if (!Number.isSafeInteger(error.code))
        throw new AdapterFault("CODEX_PROTOCOL");
      this.settle(errorCode(method));
      return;
    }
    this.statistics.responses++;
    this.settle(null, object(frame.result));
  }
  private fail(code: string) {
    if (this.ended) return;
    this.fault ??= code;
    if (!this.initialized) this.rejectReady(new AdapterFault(this.fault));
    if (this.pendingId !== null) this.settle(this.fault);
    this.close();
  }
  close() {
    if (this.closing || this.ended) return;
    this.closing = true;
    clearTimeout(this.requestTimer);
    if (!this.initialized)
      this.rejectReady(new AdapterFault(this.fault ?? "CODEX_CLOSED"));
    if (this.pendingId !== null) this.settle(this.fault ?? "CODEX_CLOSED");
    this.child.stdin.end();
    this.closeTimer = setTimeout(() => {
      if (this.ended) return;
      this.forced = true;
      this.fault ??= "CODEX_CLOSE_TIMEOUT";
      // Only this owned child handle; never a persisted PID or the desktop app.
      this.child.kill();
      this.finalTimer = setTimeout(() => this.finish(null, null, false), 2000);
    }, this.closeMs);
  }
  private finish(
    code: number | null,
    signal: string | null,
    observed: boolean,
  ) {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this.requestTimer);
    clearTimeout(this.closeTimer);
    clearTimeout(this.finalTimer);
    if (!this.initialized)
      this.rejectReady(new AdapterFault(this.fault ?? "CODEX_EXIT"));
    this.resolveClosed({
      code,
      signal,
      exit_observed: observed,
      forced: this.forced,
      fault: this.fault,
      stderr_bytes: this.stderrBytes,
      frames_in: this.framesIn,
      frames_out: this.framesOut,
      statistics: structuredClone(this.statistics),
    });
  }
}
function timeoutCode(method: string) {
  return method === "initialize"
    ? "CODEX_INITIALIZE_TIMEOUT"
    : method === "thread/start"
      ? "CODEX_THREAD_TIMEOUT"
      : method === "turn/start"
        ? "CODEX_TURN_TIMEOUT"
        : "CODEX_INTERRUPT_TIMEOUT";
}
function errorCode(method: string | null) {
  return method === "initialize"
    ? "CODEX_INITIALIZE_REJECTED"
    : method === "thread/start"
      ? "CODEX_THREAD_REJECTED"
      : method === "turn/start"
        ? "CODEX_TURN_REJECTED"
        : "CODEX_INTERRUPT_REJECTED";
}
function countOnce(list: string[], method: string) {
  if (list.length < 20 && !list.includes(method)) list.push(method);
}
interface CodexProfile {
  installation_root: string;
  data_root: string;
  client_version: string;
  executable_sha256: string;
}
async function unlinked(absolute: string, file: boolean) {
  let current = absolute;
  while (true) {
    const s = await lstat(current);
    if (
      s.isSymbolicLink() ||
      (current === absolute && file && (!s.isFile() || s.nlink !== 1))
    )
      throw new AdapterFault("CODEX_UNSAFE_PATH");
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
async function hash(filename: string) {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(filename)) h.update(chunk);
  return h.digest("hex");
}
/**
 * Trusted controller configuration only. The launcher always creates a fresh
 * empty CODEX_HOME, so no user configuration, credential, session or database
 * of the installed client is read or reused. A real turn needs a separately
 * authorized credential profile that this module does not implement.
 */
export function officialCodexLauncher(input: unknown): CodexLauncher {
  const o = object(input),
    keys = [
      "installation_root",
      "data_root",
      "client_version",
      "executable_sha256",
    ];
  contract(
    Object.keys(o).length === keys.length &&
      keys.every((k) => Object.hasOwn(o, k)),
  );
  contract(
    typeof o.installation_root === "string" &&
      isAbsolute(o.installation_root) &&
      typeof o.data_root === "string" &&
      isAbsolute(o.data_root),
  );
  contract(label(o.client_version) && fingerprint(o.executable_sha256));
  const p = structuredClone(o) as unknown as CodexProfile;
  p.installation_root = resolve(p.installation_root);
  p.data_root = resolve(p.data_root);
  const between = relative(p.installation_root, p.data_root);
  contract(
    between !== "" &&
      (between === ".." ||
        between.startsWith(".." + sep) ||
        isAbsolute(between)),
  );
  const executable = join(p.installation_root, "codex.exe");
  const fp = createHash("sha256")
    .update(
      canonical({
        profile: p,
        protocol: "codex-app-server-candidate/1",
        policy: "empty-home-initialize-only/1",
      }),
    )
    .digest("hex");
  return Object.freeze({
    fingerprint: fp,
    clientVersion: p.client_version,
    source: "official_codex" as const,
    async launch(stillAuthorized: () => boolean) {
      if (!stillAuthorized())
        throw new AdapterFault("CODEX_AUTHORIZATION_CHANGED");
      await unlinked(executable, true);
      if ((await hash(executable)) !== p.executable_sha256)
        throw new AdapterFault("CODEX_CONFIG_CHANGED");
      if (!stillAuthorized())
        throw new AdapterFault("CODEX_AUTHORIZATION_CHANGED");
      await unlinked(p.data_root, false);
      const root = await mkdtemp(join(p.data_root, "codex-init-"));
      const at = (name: string) => join(root, name);
      const dirs = {
        home: at("home"),
        user: at("user"),
        appdata: at("appdata"),
        localappdata: at("localappdata"),
        temp: at("temp"),
        work: at("work"),
      };
      for (const d of Object.values(dirs)) await mkdir(d);
      const diagnostic = join(root, "stderr.log");
      await writeFile(diagnostic, "", { flag: "wx" });
      if (!stillAuthorized())
        throw new AdapterFault("CODEX_AUTHORIZATION_CHANGED");
      const system = process.env.SystemRoot ?? process.env.SYSTEMROOT;
      contract(system && isAbsolute(system));
      const env = {
        SystemRoot: system,
        WINDIR: system,
        ComSpec: join(system, "System32", "cmd.exe"),
        PATH: join(system, "System32"),
        PATHEXT: ".COM;.EXE;.BAT;.CMD",
        OS: "Windows_NT",
        USERPROFILE: dirs.user,
        HOME: dirs.user,
        APPDATA: dirs.appdata,
        LOCALAPPDATA: dirs.localappdata,
        TEMP: dirs.temp,
        TMP: dirs.temp,
        CODEX_HOME: dirs.home,
        NO_COLOR: "1",
      };
      const child = spawn(executable, ["app-server"], {
        cwd: dirs.work,
        env,
        windowsHide: true,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return new CodexAppServer(child, {
        workDirectory: dirs.work,
        onStderr: (bytes) => appendFileSync(diagnostic, bytes),
      });
    },
  });
}
