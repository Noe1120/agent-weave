// Acceptance-only transport. Production DshRuntimeController remains initialize-only.
import { createHash } from "node:crypto";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { isAbsolute } from "node:path";
export interface SessionProbeReport {
  outcome: "PASS" | "FAILED" | "UNKNOWN";
  fault: string | null;
  rpc_error_code: number | null;
  requests: string[];
  acknowledged: string[];
  session_state: "not_created" | "unknown" | "open" | "closed";
  session_id_sha256: string | null;
  stdin_eof: boolean;
  stderr_bytes: number;
  streams_closed: boolean;
  exit: {
    code: number | null;
    signal: string | null;
    observed: boolean;
    forced: boolean;
  };
}
const expectedHello = {
  protocolVersion: 1,
  agentInfo: { name: "deepseek-harness-acp", version: "0.0.1" },
  agentCapabilities: {
    mcpCapabilities: { http: true },
    promptCapabilities: { image: false, audio: false, embeddedContext: false },
    sessionCapabilities: { close: {}, list: {}, resume: {} },
  },
  authMethods: [],
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("DSH_PROTOCOL");
  return value as Record<string, unknown>;
}
/** Only the three fixed requests below are expressible; no permission reply or retry. */
export function probeFreshSession(
  child: ChildProcessWithoutNullStreams,
  cwd: string,
  options: {
    requestMs?: number;
    closeMs?: number;
    onStderr?: (bytes: Buffer) => void;
  } = {},
): Promise<SessionProbeReport> {
  const requestMs = options.requestMs ?? 15000,
    closeMs = options.closeMs ?? 5000;
  if (
    !isAbsolute(cwd) ||
    ![requestMs, closeMs].every(
      (n) => Number.isInteger(n) && n > 0 && n <= 60000,
    )
  )
    throw new Error("DSH_PROBE_CONFIG");
  return new Promise((resolve) => {
    const report: SessionProbeReport = {
      outcome: "UNKNOWN",
      fault: null,
      rpc_error_code: null,
      requests: [],
      acknowledged: [],
      session_state: "not_created",
      session_id_sha256: null,
      stdin_eof: false,
      stderr_bytes: 0,
      streams_closed: false,
      exit: { code: null, signal: null, observed: false, forced: false },
    };
    let sessionId: string | null = null,
      expectedId = 0,
      pending = Buffer.alloc(0),
      stdoutBytes = 0;
    let rootExit: {
      code: number | null;
      signal: string | null;
      observed: boolean;
    } = { code: null, signal: null, observed: false };
    let ended = false,
      closing = false;
    let requestTimer: NodeJS.Timeout | undefined,
      closeTimer: NodeJS.Timeout | undefined,
      finalTimer: NodeJS.Timeout | undefined;
    function finish(
      code: number | null,
      signal: string | null,
      observed: boolean,
      streamsClosed = false,
    ) {
      if (ended) return;
      ended = true;
      clearTimeout(requestTimer);
      clearTimeout(closeTimer);
      clearTimeout(finalTimer);
      report.exit = { code, signal, observed, forced: report.exit.forced };
      report.streams_closed = streamsClosed;
      if (observed && !streamsClosed) report.fault ??= "DSH_PIPE_TIMEOUT";
      if (pending.length) report.fault ??= "DSH_PROTOCOL";
      if (code !== 0 || !closing) report.fault ??= "DSH_EXIT";
      report.outcome = !observed
        ? "UNKNOWN"
        : !report.fault &&
            report.session_state === "closed" &&
            !report.exit.forced
          ? "PASS"
          : "FAILED";
      resolve(structuredClone(report));
    }
    function eof() {
      if (closing || ended) return;
      closing = true;
      clearTimeout(requestTimer);
      report.stdin_eof = true;
      child.stdin.end();
      closeTimer = setTimeout(() => {
        if (ended) return;
        report.fault ??= rootExit.observed
          ? "DSH_PIPE_TIMEOUT"
          : "DSH_EOF_TIMEOUT";
        if (!rootExit.observed) {
          report.exit.forced = true;
          // Only this owned handle, never a persisted PID or an attached Desktop process.
          child.kill();
        }
        finalTimer = setTimeout(
          () => finish(rootExit.code, rootExit.signal, rootExit.observed),
          2000,
        );
      }, closeMs);
    }
    function fail(code: string) {
      if (ended) return;
      report.fault ??= code;
      eof();
    }
    function send(id: 1 | 2 | 3) {
      if (closing || ended) return;
      const method =
        id === 1 ? "initialize" : id === 2 ? "session/new" : "session/close";
      const params =
        id === 1
          ? {
              protocolVersion: 1,
              clientCapabilities: {
                fs: { readTextFile: false, writeTextFile: false },
                terminal: false,
              },
              clientInfo: { name: "agent-weave", version: "0.3.0" },
            }
          : id === 2
            ? { cwd, mcpServers: [] }
            : { sessionId };
      expectedId = id;
      if (id === 2) report.session_state = "unknown";
      report.requests.push(method);
      requestTimer = setTimeout(
        () =>
          fail(
            id === 1
              ? "DSH_INITIALIZE_TIMEOUT"
              : id === 2
                ? "DSH_NEW_TIMEOUT"
                : "DSH_CLOSE_TIMEOUT",
          ),
        requestMs,
      );
      child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
    }
    function receive(value: unknown) {
      const frame = object(value);
      if ("method" in frame) throw new Error("DSH_SERVER_REQUEST");
      if (
        closing ||
        expectedId === 0 ||
        frame.jsonrpc !== "2.0" ||
        frame.id !== expectedId ||
        "error" in frame === "result" in frame
      )
        throw new Error("DSH_PROTOCOL");
      if ("error" in frame) {
        const error = object(frame.error);
        if (!Number.isSafeInteger(error.code)) throw new Error("DSH_PROTOCOL");
        report.rpc_error_code = error.code as number;
        throw new Error(
          expectedId === 1
            ? "DSH_INITIALIZE_REJECTED"
            : expectedId === 2
              ? "DSH_NEW_REJECTED"
              : "DSH_CLOSE_REJECTED",
        );
      }
      const result = object(frame.result),
        id = expectedId;
      if (id === 1) {
        if (Array.isArray(result.authMethods) && result.authMethods.length)
          throw new Error("DSH_AUTH_REQUIRED");
        if (!isDeepStrictEqual(result, expectedHello))
          throw new Error("DSH_HELLO_CHANGED");
      } else if (id === 2) {
        if (
          typeof result.sessionId !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            result.sessionId,
          )
        )
          throw new Error("DSH_PROTOCOL");
        sessionId = result.sessionId;
        report.session_id_sha256 = createHash("sha256")
          .update(sessionId)
          .digest("hex");
        report.session_state = "open";
      } else {
        if (Object.keys(result).length) throw new Error("DSH_PROTOCOL");
        report.session_state = "closed";
      }
      clearTimeout(requestTimer);
      report.acknowledged.push(
        id === 1 ? "initialize" : id === 2 ? "session/new" : "session/close",
      );
      expectedId = 0;
      // Drain the current stdout batch before advancing; duplicate/pipelined replies fail closed.
      if (id === 3) eof();
      else setImmediate(() => send(id === 1 ? 2 : 3));
    }
    child.once("spawn", () => send(1));
    child.stdout.on("data", (data: Buffer) => {
      if (ended) return;
      stdoutBytes += data.length;
      if (stdoutBytes > 262144) return fail("DSH_STDOUT_LIMIT");
      pending = Buffer.concat([pending, data]);
      while (true) {
        const end = pending.indexOf(10);
        if (end < 0) {
          if (pending.length > 65536) fail("DSH_FRAME_LIMIT");
          return;
        }
        const bytes = pending.subarray(0, end);
        pending = pending.subarray(end + 1);
        if (bytes.length > 65536) return fail("DSH_FRAME_LIMIT");
        try {
          receive(
            JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
          );
        } catch (error) {
          return fail(
            error instanceof Error && /^DSH_[A-Z_]+$/.test(error.message)
              ? error.message
              : "DSH_PROTOCOL",
          );
        }
      }
    });
    child.stderr.on("data", (data: Buffer) => {
      if (ended) return;
      const retained = data.subarray(
        0,
        Math.max(0, 65536 - report.stderr_bytes),
      );
      report.stderr_bytes += data.length;
      try {
        if (retained.length) options.onStderr?.(retained);
      } catch {
        fail("DSH_DIAGNOSTIC_WRITE");
      }
      if (report.stderr_bytes > 65536) fail("DSH_STDERR_LIMIT");
    });
    child.stdin.on("error", () => {
      if (!closing) fail("DSH_STDIN");
    });
    child.stdout.on("error", () => fail("DSH_STDOUT"));
    child.stderr.on("error", () => fail("DSH_STDERR"));
    child.stdout.once("end", () => {
      if (!closing) fail(pending.length ? "DSH_PROTOCOL" : "DSH_DISCONNECTED");
    });
    child.once("error", () => fail("DSH_LAUNCH"));
    child.once("exit", (code, signal) => {
      rootExit = { code, signal, observed: true };
    });
    child.once("close", (code, signal) =>
      finish(code, signal, rootExit.observed, true),
    );
  });
}
