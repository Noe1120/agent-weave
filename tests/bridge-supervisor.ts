import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync } from "node:fs";
export type HostExit = {
  code: number | null;
  exit_observed: boolean;
  forced: boolean;
};
/** Offline prototype only. The caller owns the child; no PID attachment or launch API. */
export class BridgeSupervisor {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly options: { reportPath: string; deadlineMs: number };
  private state = "open";
  private fault: string | null = null;
  private serial = 0;
  private buffer = Buffer.alloc(0);
  private total = 0;
  private readonly pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void }
  >();
  private drain: (() => void) | undefined;
  private stopping: Promise<void> | undefined;
  private readonly ended: Promise<{
    code: number | null;
    signal: string | null;
  }>;
  constructor(
    child: ChildProcessWithoutNullStreams,
    options: { reportPath: string; deadlineMs: number },
  ) {
    if (
      !Number.isInteger(options.deadlineMs) ||
      options.deadlineMs < 1 ||
      options.deadlineMs > 30000
    )
      throw new Error("BRIDGE_OPTIONS");
    this.child = child;
    this.options = { ...options };
    this.ended = new Promise((resolve) => {
      child.once("close", (code, signal) => {
        if (this.state === "open" || this.state === "draining")
          this.fail("BRIDGE_EARLY_EXIT");
        resolve({ code, signal });
      });
    });
    child.on("error", () => this.fail("BRIDGE_PROCESS"));
    child.stdin.on("error", () => this.fail("BRIDGE_STDIN"));
    child.stderr.resume(); // Never forward possibly sensitive diagnostics.
    child.stdout.on("data", (chunk: Buffer) => this.receive(chunk));
  }
  snapshot() {
    return { state: this.state, pending: this.pending.size, fault: this.fault };
  }
  private fail(reason: string) {
    this.fault ??= reason;
    this.state = "failed";
    for (const p of this.pending.values()) p.reject(new Error(this.fault));
    this.pending.clear();
    this.drain?.();
  }
  private frame(method: string, params: unknown, id?: number) {
    if (this.state !== "open") throw new Error("BRIDGE_NOT_OPEN");
    if (typeof method !== "string" || !method || method.length > 128)
      throw new Error("BRIDGE_INPUT");
    const text =
      JSON.stringify({
        jsonrpc: "2.0",
        ...(id === undefined ? {} : { id }),
        method,
        params,
      }) + "\n";
    if (Buffer.byteLength(text) > 65536) throw new Error("BRIDGE_INPUT_LIMIT");
    return text;
  }
  request(method: string, params: unknown): Promise<any> {
    try {
      if (this.pending.size >= 64) throw new Error("BRIDGE_PENDING_LIMIT");
      const id = ++this.serial,
        text = this.frame(method, params, id);
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        this.child.stdin.write(text, (error) => {
          if (error) this.fail("BRIDGE_STDIN");
        });
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }
  notify(method: string, params: unknown) {
    this.child.stdin.write(this.frame(method, params), (error) => {
      if (error) this.fail("BRIDGE_STDIN");
    });
  }
  private receive(chunk: Buffer) {
    if (this.state === "failed") return;
    this.total += chunk.length;
    if (this.total > 1048576) {
      this.fail("BRIDGE_OUTPUT_LIMIT");
      return;
    }
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const i = this.buffer.indexOf(10);
      if (i > 131072 || (i < 0 && this.buffer.length > 131072)) {
        this.fail("BRIDGE_OUTPUT_LIMIT");
        return;
      }
      if (i < 0) return;
      const bytes = this.buffer.subarray(0, i);
      this.buffer = this.buffer.subarray(i + 1);
      try {
        const f = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        );
        if (
          !f ||
          f.jsonrpc !== "2.0" ||
          !Number.isSafeInteger(f.id) ||
          f.method !== undefined ||
          Object.hasOwn(f, "result") === Object.hasOwn(f, "error")
        )
          throw new Error();
        const p = this.pending.get(f.id);
        if (!p) throw new Error();
        this.pending.delete(f.id);
        p.resolve(f.error ? { protocol_error: f.error } : f.result);
        if (!this.pending.size) this.drain?.();
      } catch {
        this.fail("BRIDGE_PROTOCOL");
        return;
      }
    }
  }
  stop(closeHost: () => Promise<HostExit>): Promise<void> {
    if (this.stopping) return this.stopping;
    if (this.state !== "open")
      return Promise.reject(new Error(this.fault ?? "BRIDGE_NOT_OPEN"));
    this.state = "draining"; // Synchronous admission fence before any await.
    this.stopping = this.finish(closeHost);
    return this.stopping;
  }
  private async finish(closeHost: () => Promise<HostExit>) {
    const deadline = Date.now() + this.options.deadlineMs;
    const bounded = async <T>(
      promise: Promise<T>,
      reason: string,
    ): Promise<T> => {
      let timer: NodeJS.Timeout | undefined;
      try {
        return await Promise.race([
          promise,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(reason)),
              Math.max(0, deadline - Date.now()),
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      if (this.pending.size)
        await bounded(
          new Promise<void>((resolve) => {
            this.drain = resolve;
          }),
          "BRIDGE_DRAIN_TIMEOUT",
        );
      if (this.fault) throw new Error(this.fault);
      this.state = "eof";
      this.child.stdin.end();
      const exit = await bounded(this.ended, "BRIDGE_EXIT_TIMEOUT");
      if (this.fault) throw new Error(this.fault);
      if (exit.code !== 0 || exit.signal !== null)
        throw new Error("BRIDGE_EXIT");
      if (this.buffer.length) throw new Error("BRIDGE_PROTOCOL");
      let report: any;
      try {
        report = JSON.parse(readFileSync(this.options.reportPath, "utf8"));
      } catch {
        throw new Error("BRIDGE_EVIDENCE");
      }
      if (
        report.initialized !== true ||
        report.stdin_eof !== true ||
        report.fault !== null ||
        report.tool_errors !== 0
      )
        throw new Error("BRIDGE_EVIDENCE");
      this.state = "host";
      const host = await bounded(
        Promise.resolve().then(closeHost),
        "HOST_EXIT_TIMEOUT",
      );
      if (
        host.code !== 0 ||
        host.exit_observed !== true ||
        host.forced !== false
      )
        throw new Error("HOST_EXIT_UNPROVEN");
      this.state = "closed";
    } catch (error) {
      this.fail(
        error instanceof Error && /^(BRIDGE|HOST)_[A-Z_]+$/.test(error.message)
          ? error.message
          : "BRIDGE_STOP_FAILED",
      );
      throw new Error(this.fault!);
    }
  }
}
