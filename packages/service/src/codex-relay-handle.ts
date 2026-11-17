import type { CodexHandle, CodexExit } from "./codex-app-server.ts";
import type { HostExit } from "./bridge-supervisor.ts";

export interface RelayExitObservation {
  /** Must use an already-held OS handle, never socket EOF or a recycled PID. */
  waitExit(): Promise<HostExit>;
  dispose(): Promise<void>;
}
export interface PreparedCodexBridge {
  ready: Promise<void>;
  stop(
    waitRelay: () => Promise<HostExit>,
    closeHost: () => Promise<HostExit>,
  ): Promise<void>;
  abort(): Promise<void>;
}
/** Trusted in-process composition. No launch, PID discovery or automatic registration. */
export function composeCodexRelayHandle(options: {
  host: CodexHandle;
  bridge: PreparedCodexBridge;
  observeRelay(): Promise<RelayExitObservation>;
  cleanup(): Promise<void>;
  stillAuthorized(): boolean;
  deadlineMs?: number;
}): CodexHandle {
  const { host, bridge } = options;
  const ms = options.deadlineMs ?? 20000;
  if (!Number.isInteger(ms) || ms < 1 || ms > 60000)
    throw new Error("CODEX_RELAY_OPTIONS");
  let fault: string | null = null,
    closing = false,
    finished = false,
    cleanupStarted = false,
    exitObserved = false;
  let observation: RelayExitObservation | undefined;
  let preparing: Promise<string> | undefined;
  let resolveClosed!: (exit: CodexExit) => void;
  const closed = new Promise<CodexExit>((resolve) => {
    resolveClosed = resolve;
  });
  const bounded = async <T>(work: Promise<T>, code: string): Promise<T> => {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(code)), ms);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const fail = (code: string) => {
    fault ??= code;
  };
  const cleanup = async (exit: CodexExit) => {
    cleanupStarted = true;
    const toDispose = observation;
    observation = undefined;
    if (exit.exit_observed) {
      try {
        await bounded(
          Promise.resolve().then(options.cleanup),
          "CODEX_RELAY_CLEANUP",
        );
      } catch {
        fail("CODEX_RELAY_CLEANUP");
      }
    } else fail("CODEX_RELAY_HOST_EXIT_UNKNOWN");
    if (toDispose) {
      try {
        await bounded(toDispose.dispose(), "CODEX_RELAY_OBSERVER_CLEANUP");
      } catch {
        fail("CODEX_RELAY_OBSERVER_CLEANUP");
      }
    }
    finished = true;
    exitObserved = exit.exit_observed;
    resolveClosed({ ...structuredClone(exit), fault: fault ?? exit.fault });
  };
  const closeHost = async () => {
    host.close();
    try {
      return await bounded(host.closed, "CODEX_RELAY_HOST_EXIT_UNKNOWN");
    } catch {
      fail("CODEX_RELAY_HOST_EXIT_UNKNOWN");
      return {
        code: null,
        signal: null,
        exit_observed: false,
        forced: false,
        fault,
        stderr_bytes: 0,
        frames_in: 0,
        frames_out: 0,
        statistics: structuredClone(host.statistics),
      } satisfies CodexExit;
    }
  };
  const abort = async () => {
    try {
      await bounded(bridge.abort(), "CODEX_RELAY_ABORT");
    } catch {
      fail("CODEX_RELAY_ABORT");
    }
  };
  const close = () => {
    if (closing || finished) return;
    closing = true; // Synchronous admission fence, before any await.
    void (async () => {
      try {
        if (preparing) await bounded(preparing, "CODEX_RELAY_PREPARE_TIMEOUT");
        if (!observation) throw new Error("CODEX_RELAY_PROOF_MISSING");
        await bounded(
          bridge.stop(() => observation!.waitExit(), closeHost),
          "CODEX_RELAY_CLOSE",
        );
      } catch {
        fail("CODEX_RELAY_CLOSE");
        await abort();
      }
      await cleanup(await closeHost());
    })();
  };
  void host.closed.then(async (exit) => {
    if (closing || finished) return;
    closing = true;
    fail("CODEX_RELAY_HOST_EARLY_EXIT");
    await abort();
    await cleanup(exit);
  });
  const allowed = () => {
    if (closing || finished) throw new Error(fault ?? "CODEX_RELAY_CLOSING");
    if (options.stillAuthorized() !== true) {
      fail("CODEX_RELAY_AUTHORIZATION_CHANGED");
      close();
      throw new Error(fault!);
    }
  };
  return {
    ready: host.ready,
    closed,
    workDirectory: host.workDirectory,
    get status() {
      return {
        ...(finished && exitObserved
          ? { state: "closed" as const, fault }
          : closing
            ? { state: "closing" as const, fault }
            : host.status),
      };
    },
    get statistics() {
      return structuredClone(host.statistics);
    },
    async startThread(cwd) {
      allowed();
      if (preparing) throw new Error("CODEX_RELAY_THREAD_EXISTS");
      preparing = (async () => {
        const thread = await host.startThread(cwd);
        await bounded(bridge.ready, "CODEX_RELAY_READY_TIMEOUT");
        allowed();
        // A late observer is disposed rather than silently leaked after timeout.
        const pending = options.observeRelay();
        let abandoned = false;
        void pending
          .then(async (value) => {
            if (abandoned) {
              try {
                await bounded(value.dispose(), "CODEX_RELAY_OBSERVER_CLEANUP");
              } catch {
                fail("CODEX_RELAY_OBSERVER_CLEANUP");
              }
            }
          })
          .catch(() => {
            fail("CODEX_RELAY_OBSERVE");
          });
        try {
          const value = await bounded(pending, "CODEX_RELAY_OBSERVE_TIMEOUT");
          if (cleanupStarted) {
            await bounded(value.dispose(), "CODEX_RELAY_OBSERVER_CLEANUP");
            throw new Error("CODEX_RELAY_CLOSING");
          }
          observation = value;
        } catch (error) {
          abandoned = true;
          throw error;
        }
        allowed();
        return thread;
      })();
      try {
        return await preparing;
      } catch {
        fail("CODEX_RELAY_PREPARE");
        close();
        throw new Error(fault!);
      }
    },
    async startTurn(thread, text) {
      allowed();
      if (!observation) throw new Error("CODEX_RELAY_NOT_READY");
      return host.startTurn(thread, text);
    },
    async interruptTurn(thread, turn) {
      allowed();
      return host.interruptTurn(thread, turn);
    },
    close,
  };
}
