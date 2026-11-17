import type {
  CodexHandle,
  CodexLauncher,
} from "../packages/service/src/codex-app-server.ts";
import type { HostExit } from "../packages/service/src/bridge-supervisor.ts";
import type { createOwnedBridgeFactory } from "../packages/service/src/owned-bridge.ts";

interface RelayFacts {
  relay_os_exit?: {
    exit_code: number | null;
    exit_observed: boolean;
    observed_at: string;
    started_at: string;
  };
  host_close_requested_at?: string;
  snapshot?: {
    state: string;
    fault: string | null;
    credentials_cleared: boolean;
    bridge_exit: HostExit | null;
    relay_exit: HostExit | null;
  };
}
export function relayJointComposition(
  prepared: Awaited<
    ReturnType<ReturnType<typeof createOwnedBridgeFactory>["prepareClient"]>
  >,
  base: CodexLauncher,
  options: { root: string; bridgeData: string; synthetic: boolean },
): {
  launcher: CodexLauncher;
  facts: RelayFacts;
  rpc(
    method: string,
    params?: unknown,
  ): Promise<{ id: number; result: unknown }>;
  arm(): Promise<void>;
  reports(): Array<Record<string, unknown>>;
  cleanup(): Promise<void>;
};
