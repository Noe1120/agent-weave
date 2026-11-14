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

export interface AcpHello {
  protocol_version: 1;
  bridge_version: string;
  advertised: {
    mcp_http: boolean;
    image: boolean;
    audio: boolean;
    embedded_context: boolean;
    session_list: boolean;
    session_resume: boolean;
    session_close: boolean;
  };
}
export interface AcpExit {
  code: number | null;
  signal: string | null;
  exit_observed: boolean;
  forced: boolean;
  fault: string | null;
  stderr_bytes: number;
  initialize_requests: number;
  initialize_responses: number;
}
export interface AcpHandle {
  readonly status: {
    state: "initializing" | "ready" | "closing" | "closed";
    fault: string | null;
  };
  ready: Promise<AcpHello>;
  closed: Promise<AcpExit>;
  close(): void;
}
export interface DshLauncher {
  readonly fingerprint: string;
  readonly clientVersion: string;
  readonly source: "official_dsh" | "development_fixture";
  launch(stillAuthorized: () => boolean): Promise<AcpHandle>;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AdapterFault("DSH_PROTOCOL");
  return value as Record<string, unknown>;
}
function hello(value: unknown): AcpHello {
  const frame = object(value);
  if (
    frame.jsonrpc !== "2.0" ||
    frame.id !== 1 ||
    "method" in frame ||
    "error" in frame
  )
    throw new AdapterFault("DSH_PROTOCOL");
  const result = object(frame.result),
    info = object(result.agentInfo),
    caps = object(result.agentCapabilities);
  if (
    result.protocolVersion !== 1 ||
    info.name !== "deepseek-harness-acp" ||
    !label(info.version)
  )
    throw new AdapterFault("DSH_PROTOCOL");
  if (!Array.isArray(result.authMethods) || result.authMethods.length !== 0)
    throw new AdapterFault("DSH_AUTH_REQUIRED");
  const mcp =
    caps.mcpCapabilities === undefined ? {} : object(caps.mcpCapabilities);
  const prompt =
    caps.promptCapabilities === undefined
      ? {}
      : object(caps.promptCapabilities);
  const session =
    caps.sessionCapabilities === undefined
      ? {}
      : object(caps.sessionCapabilities);
  const flag = (o: Record<string, unknown>, key: string) => {
    if (o[key] !== undefined && typeof o[key] !== "boolean")
      throw new AdapterFault("DSH_PROTOCOL");
    return o[key] === true;
  };
  const declared = (key: string) => {
    if (session[key] === undefined) return false;
    object(session[key]);
    return true;
  };
  return {
    protocol_version: 1,
    bridge_version: info.version,
    advertised: {
      mcp_http: flag(mcp, "http"),
      image: flag(prompt, "image"),
      audio: flag(prompt, "audio"),
      embedded_context: flag(prompt, "embeddedContext"),
      session_list: declared("list"),
      session_resume: declared("resume"),
      session_close: declared("close"),
    },
  };
}
/** Initialization only. No generic request method, sessions, permission replies or prompts. */
export class InitializeOnlyAcp implements AcpHandle {
  readonly ready: Promise<AcpHello>;
  readonly closed: Promise<AcpExit>;
  private child: ChildProcessWithoutNullStreams;
  private resolveReady!: (value: AcpHello) => void;
  private rejectReady!: (error: Error) => void;
  private resolveClosed!: (value: AcpExit) => void;
  private received = false;
  private requests = 0;
  private ended = false;
  private closing = false;
  private forced = false;
  private fault: string | null = null;
  private stderrBytes = 0;
  private stdoutBytes = 0;
  private pending = Buffer.alloc(0);
  private initializeTimer?: NodeJS.Timeout;
  private closeTimer?: NodeJS.Timeout;
  private finalTimer?: NodeJS.Timeout;
  private readonly closeMs: number;
  constructor(
    child: ChildProcessWithoutNullStreams,
    options: {
      initializeMs?: number;
      closeMs?: number;
      onStderr?: (bytes: Buffer) => void;
    } = {},
  ) {
    this.child = child;
    this.closeMs = options.closeMs ?? 5000;
    const initializeMs = options.initializeMs ?? 15000;
    contract(
      [this.closeMs, initializeMs].every(
        (n) => Number.isInteger(n) && n > 0 && n <= 60000,
      ),
    );
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    // A close-before-ready caller need not attach a rejection handler immediately.
    void this.ready.catch(() => {});
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });
    this.initializeTimer = setTimeout(
      () => this.fail("DSH_INITIALIZE_TIMEOUT"),
      initializeMs,
    );
    child.once("spawn", () => {
      if (this.closing) return;
      this.requests++;
      child.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: 1,
            clientCapabilities: {
              fs: { readTextFile: false, writeTextFile: false },
              terminal: false,
            },
            clientInfo: { name: "agent-weave", version: "0.3.0" },
          },
        }) + "\n",
      );
    });
    child.stdout.on("data", (data: Buffer) => this.consume(data));
    child.stderr.on("data", (data: Buffer) => {
      const retained = data.subarray(0, Math.max(0, 65536 - this.stderrBytes));
      this.stderrBytes += data.length;
      try {
        if (retained.length) options.onStderr?.(retained);
      } catch {
        this.fail("DSH_DIAGNOSTIC_WRITE");
      }
      if (this.stderrBytes > 65536) this.fail("DSH_STDERR_LIMIT");
    });
    child.stdin.on("error", () => {
      if (!this.closing) this.fail("DSH_STDIN");
    });
    child.stdout.on("error", () => this.fail("DSH_STDOUT"));
    child.stdout.once("end", () => {
      if (!this.closing) this.fail("DSH_DISCONNECTED");
    });
    child.stderr.on("error", () => this.fail("DSH_STDERR"));
    child.once("error", () => this.fail("DSH_LAUNCH"));
    child.once("close", (code, signal) => {
      if (this.pending.length && !this.fault) this.fault = "DSH_PROTOCOL";
      if (
        (code !== 0 || !this.received) &&
        (!this.fault || this.fault === "DSH_DISCONNECTED")
      )
        this.fault = "DSH_EXIT";
      this.finish(code, signal, true);
    });
  }
  get status(): AcpHandle["status"] {
    return {
      state: this.ended
        ? "closed"
        : this.closing
          ? "closing"
          : this.received
            ? "ready"
            : "initializing",
      fault: this.fault,
    };
  }
  private consume(data: Buffer) {
    if (this.ended) return;
    this.stdoutBytes += data.length;
    if (this.stdoutBytes > 262144) {
      this.fail("DSH_STDOUT_LIMIT");
      return;
    }
    this.pending = Buffer.concat([this.pending, data]);
    for (;;) {
      const i = this.pending.indexOf(10);
      if (i < 0) {
        if (this.pending.length > 65536) this.fail("DSH_FRAME_LIMIT");
        return;
      }
      const bytes = this.pending.subarray(0, i);
      this.pending = this.pending.subarray(i + 1);
      if (bytes.length > 65536) {
        this.fail("DSH_FRAME_LIMIT");
        return;
      }
      try {
        if (this.received || this.closing)
          throw new AdapterFault("DSH_PROTOCOL");
        const result = hello(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
        );
        this.received = true;
        clearTimeout(this.initializeTimer);
        this.resolveReady(result);
      } catch (error) {
        this.fail(error instanceof AdapterFault ? error.code : "DSH_PROTOCOL");
        return;
      }
    }
  }
  private fail(code: string) {
    if (this.ended) return;
    this.fault ??= code;
    if (!this.received) this.rejectReady(new AdapterFault(this.fault));
    this.close();
  }
  close() {
    if (this.closing || this.ended) return;
    this.closing = true;
    clearTimeout(this.initializeTimer);
    if (!this.received)
      this.rejectReady(new AdapterFault(this.fault ?? "DSH_CLOSED"));
    this.child.stdin.end();
    this.closeTimer = setTimeout(() => {
      if (this.ended) return;
      this.forced = true;
      this.fault ??= "DSH_CLOSE_TIMEOUT";
      // The live owned handle only; never reopen a saved PID or terminate Desktop.
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
    clearTimeout(this.initializeTimer);
    clearTimeout(this.closeTimer);
    clearTimeout(this.finalTimer);
    if (!this.received)
      this.rejectReady(new AdapterFault(this.fault ?? "DSH_EXIT"));
    this.resolveClosed({
      code,
      signal,
      exit_observed: observed,
      forced: this.forced,
      fault: this.fault,
      stderr_bytes: this.stderrBytes,
      initialize_requests: this.requests,
      initialize_responses: this.received ? 1 : 0,
    });
  }
}
interface DshProfile {
  installation_root: string;
  data_root: string;
  client_version: string;
  executable_sha256: string;
  archive_sha256: string;
}
async function unlinked(absolute: string, file: boolean) {
  let current = absolute;
  while (true) {
    const s = await lstat(current);
    if (
      s.isSymbolicLink() ||
      (current === absolute && file && (!s.isFile() || s.nlink !== 1))
    )
      throw new AdapterFault("DSH_UNSAFE_PATH");
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
/** Trusted controller configuration only. Ordinary runtime requests cannot supply these fields. */
export function officialDshLauncher(input: unknown): DshLauncher {
  const o = object(input),
    keys = [
      "installation_root",
      "data_root",
      "client_version",
      "executable_sha256",
      "archive_sha256",
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
  contract(
    label(o.client_version) &&
      fingerprint(o.executable_sha256) &&
      fingerprint(o.archive_sha256),
  );
  const p = structuredClone(o) as unknown as DshProfile;
  p.installation_root = resolve(p.installation_root);
  p.data_root = resolve(p.data_root);
  const between = relative(p.installation_root, p.data_root);
  contract(
    between !== "" &&
      (between === ".." ||
        between.startsWith(".." + sep) ||
        isAbsolute(between)),
  );
  const executable = join(p.installation_root, "DeepSeek Harness.exe"),
    archive = join(p.installation_root, "resources", "app.asar");
  const fp = createHash("sha256")
    .update(
      canonical({
        profile: p,
        protocol: 1,
        policy: "empty-home-initialize-only/1",
      }),
    )
    .digest("hex");
  return Object.freeze({
    fingerprint: fp,
    clientVersion: p.client_version,
    source: "official_dsh" as const,
    async launch(stillAuthorized: () => boolean) {
      if (!stillAuthorized())
        throw new AdapterFault("DSH_AUTHORIZATION_CHANGED");
      await unlinked(executable, true);
      await unlinked(archive, true);
      if (
        (await hash(executable)) !== p.executable_sha256 ||
        (await hash(archive)) !== p.archive_sha256
      )
        throw new AdapterFault("DSH_CONFIG_CHANGED");
      if (!stillAuthorized())
        throw new AdapterFault("DSH_AUTHORIZATION_CHANGED");
      // Parent must exist and be trusted, never follow a newly supplied junction.
      await unlinked(p.data_root, false);
      const root = await mkdtemp(join(p.data_root, "dsh-init-"));
      const names = [
        "home",
        "agents",
        "user",
        "appdata",
        "localappdata",
        "temp",
        "work",
      ];
      const dirs = Object.fromEntries(names.map((n) => [n, join(root, n)]));
      for (const d of Object.values(dirs)) await mkdir(d);
      const diagnostic = join(root, "stderr.log");
      await writeFile(diagnostic, "", { flag: "wx" });
      if (!stillAuthorized())
        throw new AdapterFault("DSH_AUTHORIZATION_CHANGED");
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
        DSH_HOME: dirs.home,
        DSH_AGENTS_HOME: dirs.agents,
        DSH_TELEMETRY_DISABLED: "1",
        DSH_PERMISSION_MODE: "read-only",
        ELECTRON_RUN_AS_NODE: "1",
        NO_COLOR: "1",
      };
      const child = spawn(
        executable,
        [
          "--expose-internals",
          join(
            archive,
            "dsh",
            "node_modules",
            "@deepseek-ai",
            "dsh-desktop-host",
            "lib",
            "cli.js",
          ),
          "--profile",
          "acp",
        ],
        {
          cwd: dirs.work,
          env,
          windowsHide: true,
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      return new InitializeOnlyAcp(child, {
        onStderr: (bytes) => appendFileSync(diagnostic, bytes),
      });
    },
  });
}
