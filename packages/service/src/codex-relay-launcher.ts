import { createHash } from "node:crypto";
import { AdapterFault } from "./adapter-contract.ts";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import {
  officialCodexLauncher,
  verifyCodexInstallation,
  type CodexLauncher,
  type CodexLaunchLifecycle,
} from "./codex-app-server.ts";
import { createOwnedBridgeFactory } from "./owned-bridge.ts";
import { captureCodexHomeCleanup } from "./codex-home-cleanup.ts";
import { composeCodexRelayHandle } from "./codex-relay-handle.ts";
import { observeWindowsChildExit } from "./windows-exit-observer.ts";

type Prepared = Awaited<
  ReturnType<ReturnType<typeof createOwnedBridgeFactory>["prepareClient"]>
>;
/** Shared typed lifecycle; caller owns the fresh home and original host launch. */
export function createCodexRelayLifecycle(
  bridge: Prepared,
  dataRoot: string,
  allowed: () => boolean,
): CodexLaunchLifecycle {
  return {
    async prepare(work) {
      const cleanup = await captureCodexHomeCleanup(dataRoot, work);
      return {
        abort: cleanup,
        attach(host, child: ChildProcessWithoutNullStreams) {
          return composeCodexRelayHandle({
            host,
            bridge,
            cleanup,
            stillAuthorized: allowed,
            observeRelay: () =>
              observeWindowsChildExit(child, bridge.launch.args[0]),
          });
        },
      };
    },
  };
}

/** Explicit trusted registration only. Never called by the default HTTP service. */
export function officialCodexRelayLauncher(
  profile: unknown,
  bridgeConfig: unknown,
): CodexLauncher {
  if (
    !profile ||
    typeof profile !== "object" ||
    Array.isArray(profile) ||
    "bridge" in profile ||
    "relay_binding" in profile
  )
    throw new Error("CODEX_RELAY_PROFILE");
  const target = (bridgeConfig as { config?: { target?: unknown } } | null)
    ?.config?.target;
  if (target !== "codex") throw new Error("CODEX_RELAY_PROFILE");
  const pinned = structuredClone(profile) as Record<string, unknown>;
  const base = officialCodexLauncher(pinned);
  const factory = createOwnedBridgeFactory(bridgeConfig);
  // Only a single-task bridge may be registered for an owner-authorized turn.
  const cfg = (
    bridgeConfig as {
      config: {
        project_id: string;
        task_ids: string[];
        execution_ids: string[];
        allow_message_poll: boolean;
      };
    }
  ).config;
  const taskProfile =
    base.providerMetadata &&
    cfg.task_ids.length === 1 &&
    !cfg.execution_ids.length &&
    !cfg.allow_message_poll
      ? Object.freeze({
          ...base.providerMetadata,
          project_id: cfg.project_id,
          task_id: cfg.task_ids[0]!,
        })
      : undefined;
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        version: "codex-relay-launch/1",
        host: base.fingerprint,
        bridge: factory.fingerprint,
      }),
    )
    .digest("hex");
  return Object.freeze({
    ...(taskProfile ? { taskProfile } : {}),
    fingerprint,
    clientVersion: base.clientVersion,
    source: "official_codex" as const,
    async launch(allowed: () => boolean) {
      if (!allowed()) throw new AdapterFault("CODEX_AUTHORIZATION_CHANGED");
      if (officialCodexLauncher(pinned).fingerprint !== base.fingerprint)
        throw new AdapterFault("CODEX_CONFIG_CHANGED");
      await verifyCodexInstallation(
        pinned.installation_root as string,
        pinned.executable_sha256 as string,
      );
      const bridge = await factory.prepareClient(allowed);
      try {
        if (officialCodexLauncher(pinned).fingerprint !== base.fingerprint)
          throw new AdapterFault("CODEX_CONFIG_CHANGED");
        const lifecycle = createCodexRelayLifecycle(
          bridge,
          pinned.data_root as string,
          allowed,
        );
        return await officialCodexLauncher(
          {
            ...pinned,
            relay_binding: JSON.parse(bridge.launch.env.TEAM_RELAY),
          },
          lifecycle,
        ).launch(allowed);
      } catch (error) {
        await bridge.abort();
        throw error;
      }
    },
  });
}
