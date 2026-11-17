import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  createReadStream,
  existsSync,
  readFileSync,
} from "node:fs";
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
 * Field names come from the JSON Schema the fixed CLI itself generates
 * (`codex app-server generate-json-schema`, v1 `InitializeResponse`:
 * `codexHome`, `platformFamily`, `platformOs`, `userAgent`). Only labelled
 * fields that can be type-checked are surfaced; every other key is counted and
 * dropped, so an unknown field can never become a capability claim.
 */
export interface CodexInitialize {
  user_agent: string | null;
  codex_home: string | null;
  platform_family: string | null;
  platform_os: string | null;
  unrecognized_fields: number;
  /** Which fixed schema this projection was validated against. */
  schema: "codex-app-server/v1";
}
/**
 * Facts about exactly one native turn. Every turn gets its own generation and
 * its own counters, so a late or duplicated terminal event from an earlier turn
 * can never move the projection of the current one.
 */
export interface CodexTurnFacts {
  generation: number;
  thread_id: string;
  turn_id: string | null;
  state: "running" | "completed" | "failed" | "interrupted" | "unknown";
  started_at: number;
  completed_at: number | null;
  last_agent_message: string | null;
  token_usage: { total: number; input: number; output: number } | null;
  /** Terminal events that did not match this turn (stale or foreign). */
  stale_terminal_notifications: number;
  /** Notifications attributed to a different turn while this one ran. */
  foreign_notifications: number;
}
export interface CodexStatistics {
  requests: number;
  responses: number;
  notifications: number;
  unknown_notifications: string[];
  refused_server_requests: number;
  last_method: string | null;
  /** The turn this connection is currently tracking; null before any turn. */
  turn: CodexTurnFacts | null;
  /** Turns that reached a terminal state on this connection. */
  turns_terminal: number;
  /** Highest generation issued on this connection. */
  generation: number;
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
  "codexHome",
  "platformFamily",
  "platformOs",
  "userAgent",
]);
/**
 * The fixed schema's JSON-RPC envelopes carry no `jsonrpc` member
 * (`JSONRPCRequest` requires `id` and `method` only). Outgoing frames therefore
 * never add one; an incoming `jsonrpc` member is tolerated only as "2.0".
 */
function envelope(frame: Record<string, unknown>) {
  if ("jsonrpc" in frame && frame.jsonrpc !== "2.0")
    throw new AdapterFault("CODEX_PROTOCOL");
}
function initializeFrame(value: unknown, id: number): CodexInitialize {
  const frame = object(value);
  envelope(frame);
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
  // The response is v1 `InitializeResponse`; the four required members are
  // projected and everything else is only counted.
  const projection: CodexInitialize = {
    user_agent: optionalLabel("userAgent"),
    codex_home: optionalLabel("codexHome"),
    platform_family: optionalLabel("platformFamily"),
    platform_os: optionalLabel("platformOs"),
    unrecognized_fields: Object.keys(result).filter((k) => !known.has(k))
      .length,
    schema: "codex-app-server/v1",
  };
  if (
    projection.codex_home === null ||
    projection.platform_family === null ||
    projection.platform_os === null ||
    projection.user_agent === null
  )
    throw new AdapterFault("CODEX_PROTOCOL");
  return projection;
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
    turn: null,
    turns_terminal: 0,
    generation: 0,
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
      this.write({ id: 1, method: "initialize", params: this.hello() });
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
      // v1 InitializeCapabilities: only documented keys, experimental API off.
      capabilities: { experimentalApi: false },
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
      this.write({ id, method, params });
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
    return this.request("thread/start", {
      cwd,
      approvalPolicy: "never",
    }).then((frame) => {
      const thread = object(frame.thread);
      if (!label(thread.id) || thread.id.length > 128)
        return this.protocolFailure();
      return thread.id;
    });
  }
  startTurn(threadId: string, text: string) {
    if (!label(threadId) || typeof text !== "string" || text.length > 4000)
      return Promise.reject(new AdapterFault("CODEX_TURN_ARGS"));
    if (this.statistics.turn?.state === "running")
      return Promise.reject(new AdapterFault("CODEX_BUSY"));
    // A new generation is opened before the request leaves, so an early
    // `turn/started` notification already belongs to this attempt.
    this.statistics.generation++;
    const facts: CodexTurnFacts = {
      generation: this.statistics.generation,
      thread_id: threadId,
      turn_id: null,
      state: "running",
      started_at: Date.now(),
      completed_at: null,
      last_agent_message: null,
      token_usage: null,
      stale_terminal_notifications: 0,
      foreign_notifications: 0,
    };
    this.statistics.turn = facts;
    return this.request("turn/start", {
      threadId,
      input: [{ type: "text", text }],
    }).then((frame) => {
      const turn = object(frame.turn),
        id = turn.id;
      if (id === undefined || id === null) return null;
      if (!label(id)) return this.protocolFailure();
      if (this.statistics.turn === facts) facts.turn_id = id;
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
      id,
      error: {
        code: -32601,
        message: "agent-weave refuses server-initiated requests in this mode",
      },
    });
  }
  /**
   * True when this notification belongs to the turn this connection is tracking.
   * A turn without an acknowledged id yet is matched by thread only; once the id
   * is known, both thread and turn must match.
   */
  private owned(
    params: Record<string, unknown>,
    turnId: unknown,
  ): CodexTurnFacts | null {
    const turn = this.statistics.turn;
    if (!turn) return null;
    if (params.threadId !== turn.thread_id) return null;
    if (turn.turn_id !== null) {
      if (typeof turnId === "string" ? turnId !== turn.turn_id : true)
        return null;
    }
    return turn;
  }
  private notification(method: string, frame: Record<string, unknown>) {
    this.statistics.notifications++;
    if (method === "turn/started") {
      const params = object(frame.params ?? {});
      const turn = this.statistics.turn;
      const id = object(params.turn ?? {}).id;
      if (turn && params.threadId === turn.thread_id && label(id)) {
        if (turn.turn_id === null) turn.turn_id = id;
        else if (turn.turn_id !== id) turn.foreign_notifications++;
      } else if (turn) turn.foreign_notifications++;
      return;
    }
    if (method === "turn/completed") {
      // `TurnStatus` is exactly completed | interrupted | failed | inProgress.
      // Only a terminal value that matches THIS turn may move the projection.
      let params: Record<string, unknown> = {};
      let status: unknown;
      let turnId: unknown;
      try {
        params = object(frame.params ?? {});
        const turn = object(params.turn ?? {});
        status = turn.status;
        turnId = turn.id;
      } catch {
        status = undefined;
      }
      const owner = this.owned(params, turnId);
      if (!owner) {
        const current = this.statistics.turn;
        if (current) current.stale_terminal_notifications++;
        countOnce(
          this.statistics.unknown_notifications,
          "turn/completed:stale",
        );
        return;
      }
      if (status === "completed") owner.state = "completed";
      else if (status === "failed") owner.state = "failed";
      else if (status === "interrupted") owner.state = "interrupted";
      else if (status === "inProgress") owner.state = "running";
      else countOnce(this.statistics.unknown_notifications, "turn/completed");
      if (
        status === "completed" ||
        status === "failed" ||
        status === "interrupted"
      ) {
        owner.completed_at = Date.now();
        this.statistics.turns_terminal++;
      }
      return;
    }
    if (method === "thread/tokenUsage/updated") {
      try {
        const params = object(frame.params ?? {});
        const total = object(object(params.tokenUsage).total);
        const pick = (k: string) => {
          const v: unknown = total[k];
          return typeof v === "number" &&
            Number.isSafeInteger(v) &&
            v >= 0 &&
            v <= 100000000
            ? v
            : null;
        };
        const out = pick("outputTokens"),
          input = pick("inputTokens"),
          sum = pick("totalTokens");
        const owner = this.owned(params, params.turnId);
        if (!owner) {
          if (this.statistics.turn)
            this.statistics.turn.foreign_notifications++;
          return;
        }
        if (out !== null && input !== null && sum !== null)
          owner.token_usage = { total: sum, input, output: out };
      } catch {}
      return;
    }
    if (method === "item/completed") {
      let params: Record<string, unknown> = {};
      let item: Record<string, unknown> | undefined;
      try {
        params = object(frame.params ?? {});
        item = object(params.item ?? {});
      } catch {
        item = undefined;
      }
      const owner = this.owned(params, params.turnId);
      if (owner && item && item.type === "agentMessage") {
        if (typeof item.text === "string" && item.text.length <= 20000)
          owner.last_agent_message = item.text.slice(0, 2000);
        return;
      }
      if (item && item.type === "agentMessage" && this.statistics.turn)
        this.statistics.turn.foreign_notifications++;
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
      this.statistics.turn = null;
      this.statistics.generation = 0;
      this.statistics.turns_terminal = 0;
      this.settle(null, object(frame.result));
      clearTimeout(this.requestTimer);
      // `initialized` is a real client notification in this build's schema.
      this.write({ method: "initialized", params: {} });
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
export interface CodexRelayBinding {
  port: number;
  instance: string;
  token: string;
}
function relayBinding(value: unknown): asserts value is CodexRelayBinding {
  const b = object(value);
  contract(
    Object.keys(b).sort().join(",") === "instance,port,token" &&
      Number.isInteger(b.port) &&
      Number(b.port) > 0 &&
      Number(b.port) <= 65535 &&
      typeof b.instance === "string" &&
      /^[a-f0-9]{32}$/.test(b.instance) &&
      typeof b.token === "string" &&
      /^[a-f0-9]{64}$/.test(b.token),
  );
}
interface CodexProfile {
  installation_root: string;
  data_root: string;
  client_version: string;
  executable_sha256: string;
  model_provider?: { base_url: string; model: string };
  bridge?: { config_path: string; report_dir: string };
  relay_binding?: CodexRelayBinding;
  code_mode?: CodexCodeMode;
  provider_reuse?: {
    source_config: string;
    provider_id: string;
    model?: string;
    sha256: string;
  };
}
const loopback = (v: unknown): v is string =>
  typeof v === "string" &&
  /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(v) &&
  Number(v.split(":").at(-1)) <= 65535;
/** Same rule, but a path suffix is allowed for a provider base URL (/v1…). */
const loopbackBase = (v: unknown): v is string =>
  typeof v === "string" &&
  /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}(\/[A-Za-z0-9._\-\/]{0,64})?$/.test(
    v,
  ) &&
  Number(v.split(":")[2]?.split("/")[0] ?? 0) <= 65535;
function tomlString(v: string) {
  return JSON.stringify(v);
}
/** Read one `key = "value"` from a section of an operator-supplied TOML file. */
export function tomlSectionValue(
  text: string,
  section: string | null,
  key: string,
): string | null {
  let current: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      current = header[1] ?? null;
      continue;
    }
    if (current !== section) continue;
    const kv = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/);
    if (!kv || kv[1] !== key) continue;
    const value = (kv[2] ?? "").replace(/\s+#.*$/, "").trim();
    const quoted = value.match(/^"(.*)"$/s) ?? value.match(/^'(.*)'$/s);
    if (quoted) {
      try {
        return JSON.parse('"' + (quoted[1] ?? "") + '"');
      } catch {
        return null;
      }
    }
    // Bare TOML scalars (booleans, integers) are returned verbatim.
    return /^(true|false|-?[0-9]+(\.[0-9]+)?)$/.test(value) ? value : null;
  }
  return null;
}
/**
 * The isolated home configuration this platform writes for itself.
 *
 * Only three things can appear: a loopback model endpoint (a local stub, or the
 * operator's own loopback provider when they authorized reuse), the platform's
 * own stdio read bridge, and fixed non-secret defaults. No user plugin,
 * marketplace, approval, sandbox or MCP entry of the installed client is copied.
 * `bridge.command` is the running Node executable and `bridge.args` is the
 * platform's own compiled entry, both fixed by the trusted caller.
 */
export interface CodexCodeMode {
  enabled?: boolean;
  direct_only_tool_namespaces?: string[];
  excluded_tool_namespaces?: string[];
}
/** Namespace entries are client identifiers, never free text. */
const namespaceName = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(v);
const namespaceList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= 8 && v.every(namespaceName);
export function codexHomeConfig(input: {
  model_provider?: {
    base_url: string;
    model: string;
    bearer_token?: string;
    label?: string;
  };
  bridge?: { command: string; args: string[] };
  relay_binding?: CodexRelayBinding;
  code_mode?: CodexCodeMode;
}): string {
  contract(!(input.bridge && input.relay_binding));
  const lines: string[] = [];
  if (input.model_provider) {
    const { base_url, model, bearer_token, label: name } = input.model_provider;
    contract(loopbackBase(base_url) && label(model));
    const providerId = name ? "agent-weave-reuse" : "agent-weave-loopback";
    const token = bearer_token ?? "synthetic-local-only";
    contract(
      typeof token === "string" && token.length > 0 && token.length <= 4096,
    );
    lines.push(
      "model = " + tomlString(model),
      "model_provider = " + tomlString(providerId),
      "",
      "[model_providers." + providerId + "]",
      "name = " + tomlString(name ?? "agent-weave loopback acceptance"),
      "base_url = " + tomlString(base_url),
      'wire_api = "responses"',
      "requires_openai_auth = false",
      "experimental_bearer_token = " + tomlString(token),
      // One turn must not fan out into provider-level retries: that is cost.
      "request_max_retries = 0",
      "stream_max_retries = 0",
    );
  }
  if (input.code_mode) {
    // The fixed build accepts exactly these three fields under this table;
    // anything else is a hard configuration error (verified by the key probe).
    const { enabled, direct_only_tool_namespaces, excluded_tool_namespaces } =
      input.code_mode;
    contract(
      (enabled === undefined || typeof enabled === "boolean") &&
        (direct_only_tool_namespaces === undefined ||
          namespaceList(direct_only_tool_namespaces)) &&
        (excluded_tool_namespaces === undefined ||
          namespaceList(excluded_tool_namespaces)),
    );
    if (lines.length) lines.push("");
    lines.push("[features.code_mode]");
    if (enabled !== undefined)
      lines.push("enabled = " + (enabled ? "true" : "false"));
    if (direct_only_tool_namespaces)
      lines.push(
        "direct_only_tool_namespaces = [" +
          direct_only_tool_namespaces.map((n) => JSON.stringify(n)).join(", ") +
          "]",
      );
    if (excluded_tool_namespaces)
      lines.push(
        "excluded_tool_namespaces = [" +
          excluded_tool_namespaces.map((n) => JSON.stringify(n)).join(", ") +
          "]",
      );
  }
  if (input.relay_binding) {
    relayBinding(input.relay_binding);
    if (lines.length) lines.push("");
    lines.push(
      "[mcp_servers.agent-weave-probe]",
      "command = " + JSON.stringify(process.execPath),
      "args = [" +
        JSON.stringify(join(import.meta.dirname, "bridge-relay-entry.js")) +
        "]",
      "startup_timeout_sec = 30",
      "[mcp_servers.agent-weave-probe.env]",
      "TEAM_RELAY = " + JSON.stringify(JSON.stringify(input.relay_binding)),
    );
  }
  if (input.bridge) {
    const { command, args } = input.bridge;
    contract(isAbsolute(command) && Array.isArray(args) && args.length <= 8);
    contract(args.every((a) => typeof a === "string" && a.length <= 512));
    if (lines.length) lines.push("");
    lines.push(
      "[mcp_servers.agent-weave-probe]",
      "command = " + JSON.stringify(command),
      "args = [" + args.map((a) => JSON.stringify(a)).join(", ") + "]",
      "startup_timeout_sec = 30",
    );
  }
  return lines.length ? lines.join("\n") + "\n" : "";
}
/**
 * Copy only the provider block of an operator-authorized config into the fresh
 * home. Rejects anything that is not a loopback Responses provider.
 */
function reuseProvider(reuse: CodexProfile["provider_reuse"]): {
  base_url: string;
  model: string;
  bearer_token: string;
  label: string;
} {
  contract(reuse);
  const text = readFileSync(reuse.source_config, "utf8").replace(/^\uFEFF/, "");
  const section = "model_providers." + reuse.provider_id;
  const baseUrl = tomlSectionValue(text, section, "base_url");
  const wire = tomlSectionValue(text, section, "wire_api");
  const auth = tomlSectionValue(text, section, "requires_openai_auth");
  const token = tomlSectionValue(text, section, "experimental_bearer_token");
  const model = reuse.model ?? tomlSectionValue(text, null, "model");
  const selected = tomlSectionValue(text, null, "model_provider");
  contract(
    loopbackBase(baseUrl) &&
      wire === "responses" &&
      auth === "false" &&
      typeof token === "string" &&
      token.length > 0 &&
      token.length <= 4096 &&
      label(model) &&
      selected === reuse.provider_id,
  );
  return {
    base_url: baseUrl,
    model,
    bearer_token: token,
    label: "agent-weave provider reuse (loopback, operator-authorized)",
  };
}
/**
 * Trusted controller configuration only. The launcher always creates a fresh
 * CODEX_HOME; when a loopback model provider or the platform bridge is
 * configured it writes only those entries into that fresh home. No user
 * configuration, credential, session or database of the installed client is
 * read or reused.
 */
export function officialCodexLauncher(input: unknown): CodexLauncher {
  const o = object(input),
    required = [
      "installation_root",
      "data_root",
      "client_version",
      "executable_sha256",
    ],
    optional = [
      "model_provider",
      "bridge",
      "provider_reuse",
      "code_mode",
      "relay_binding",
    ];
  contract(
    required.every((k) => Object.hasOwn(o, k)) &&
      Object.keys(o).length <= required.length + optional.length &&
      Object.keys(o).every((k) => required.includes(k) || optional.includes(k)),
  );
  contract(
    typeof o.installation_root === "string" &&
      isAbsolute(o.installation_root) &&
      typeof o.data_root === "string" &&
      isAbsolute(o.data_root),
  );
  contract(label(o.client_version) && fingerprint(o.executable_sha256));
  if (o.model_provider !== undefined) {
    const m = object(o.model_provider);
    contract(
      Object.keys(m).length === 2 && loopback(m.base_url) && label(m.model),
    );
  }
  if (o.model_provider !== undefined && o.provider_reuse !== undefined)
    contract(false);
  if (o.provider_reuse !== undefined) {
    const r = object(o.provider_reuse);
    contract(
      Object.keys(r).length >= 2 &&
        Object.keys(r).length <= 3 &&
        Object.keys(r).every((k) =>
          ["source_config", "provider_id", "model"].includes(k),
        ) &&
        (r.model === undefined || label(r.model)) &&
        typeof r.source_config === "string" &&
        isAbsolute(r.source_config) &&
        existsSync(r.source_config) &&
        typeof r.provider_id === "string" &&
        /^[A-Za-z0-9_.-]{1,32}$/.test(r.provider_id),
    );
  }
  if (o.code_mode !== undefined) {
    const m = object(o.code_mode);
    contract(
      Object.keys(m).length > 0 &&
        Object.keys(m).every((k) =>
          [
            "enabled",
            "direct_only_tool_namespaces",
            "excluded_tool_namespaces",
          ].includes(k),
        ) &&
        (m.enabled === undefined || typeof m.enabled === "boolean") &&
        (m.direct_only_tool_namespaces === undefined ||
          namespaceList(m.direct_only_tool_namespaces)) &&
        (m.excluded_tool_namespaces === undefined ||
          namespaceList(m.excluded_tool_namespaces)),
    );
  }
  if (o.relay_binding !== undefined) {
    relayBinding(o.relay_binding);
    contract(o.bridge === undefined);
  }
  if (o.bridge !== undefined) {
    const b = object(o.bridge);
    contract(
      Object.keys(b).length === 2 &&
        typeof b.config_path === "string" &&
        isAbsolute(b.config_path) &&
        typeof b.report_dir === "string" &&
        isAbsolute(b.report_dir),
    );
  }
  const p = structuredClone(o) as unknown as CodexProfile;
  p.installation_root = resolve(p.installation_root);
  p.data_root = resolve(p.data_root);
  if (p.bridge) {
    p.bridge.config_path = resolve(p.bridge.config_path);
    p.bridge.report_dir = resolve(p.bridge.report_dir);
  }
  if (p.provider_reuse) {
    // The operator's config is read here only to pin its digest; the credential
    // itself is read at launch, kept in memory, and never stored or reported.
    const source = resolve(p.provider_reuse.source_config);
    p.provider_reuse = {
      source_config: source,
      provider_id: p.provider_reuse.provider_id,
      ...(p.provider_reuse.model ? { model: p.provider_reuse.model } : {}),
      sha256: createHash("sha256").update(readFileSync(source)).digest("hex"),
    };
  }
  const between = relative(p.installation_root, p.data_root);
  contract(
    between !== "" &&
      (between === ".." ||
        between.startsWith(".." + sep) ||
        isAbsolute(between)),
  );
  const executable = join(p.installation_root, "codex.exe");
  const bridgeEntry = join(import.meta.dirname, "mcp-entry.js");
  const relayEntry = join(import.meta.dirname, "bridge-relay-entry.js");
  const relaySha =
    p.relay_binding && existsSync(relayEntry)
      ? createHash("sha256").update(readFileSync(relayEntry)).digest("hex")
      : null;
  const fp = createHash("sha256")
    .update(
      canonical({
        profile: p,
        ...(p.relay_binding ? { relay_entry_sha256: relaySha } : {}),
        protocol: "codex-app-server/1",
        policy: "fresh-home-platform-config-only/1",
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
      // A reused provider block is validated before anything is created, and the
      // operator configuration must be byte-identical to what was pinned.
      if (p.provider_reuse) {
        const current = createHash("sha256")
          .update(readFileSync(p.provider_reuse.source_config))
          .digest("hex");
        if (current !== p.provider_reuse.sha256)
          throw new AdapterFault("CODEX_CONFIG_CHANGED");
      }

      await unlinked(executable, true);
      if ((await hash(executable)) !== p.executable_sha256)
        throw new AdapterFault("CODEX_CONFIG_CHANGED");
      if (p.relay_binding) {
        await unlinked(relayEntry, true);
        if (!relaySha || (await hash(relayEntry)) !== relaySha)
          throw new AdapterFault("CODEX_CONFIG_CHANGED");
      }
      if (p.bridge) {
        // The bridge inputs are re-verified before every launch: a moved file or
        // directory invalidates the configuration instead of being guessed at.
        await unlinked(p.bridge.config_path, true);
        await unlinked(p.bridge.report_dir, false);
        await unlinked(bridgeEntry, true);
      }
      const modelProvider = p.provider_reuse
        ? reuseProvider(p.provider_reuse)
        : p.model_provider;
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
      if (modelProvider || p.bridge || p.code_mode || p.relay_binding) {
        const config = codexHomeConfig({
          ...(modelProvider ? { model_provider: modelProvider } : {}),
          ...(p.code_mode ? { code_mode: p.code_mode } : {}),
          ...(p.relay_binding ? { relay_binding: p.relay_binding } : {}),
          ...(p.bridge
            ? {
                bridge: {
                  command: process.execPath,
                  args: [
                    bridgeEntry,
                    "--config",
                    p.bridge.config_path,
                    "--report-dir",
                    p.bridge.report_dir,
                  ],
                },
              }
            : {}),
        });
        contract(config.length > 0);
        await writeFile(join(dirs.home, "config.toml"), config, {
          flag: "wx",
        });
      }
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
