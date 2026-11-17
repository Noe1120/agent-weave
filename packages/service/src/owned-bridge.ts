import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  readdirSync,
  readFileSync,
  mkdtempSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve, extname } from "node:path";
import { BridgeSupervisor, type HostExit } from "./bridge-supervisor.ts";
import { openRelayEndpoint } from "./bridge-relay.ts";
import { McpReadClient } from "./mcp-read-client.ts";

function plain(path: string, file: boolean) {
  if (!isAbsolute(path)) throw new Error("BRIDGE_CONFIG");
  for (let at = resolve(path); ; at = dirname(at)) {
    const stat = lstatSync(at);
    if (
      stat.isSymbolicLink() ||
      (at === resolve(path) &&
        (file ? !stat.isFile() || stat.nlink !== 1 : !stat.isDirectory()))
    )
      throw new Error("BRIDGE_PATH");
    if (dirname(at) === at) break;
  }
}
const digest = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
function codeDigest() {
  const files = [
    process.execPath,
    ...readdirSync(import.meta.dirname)
      .filter((n) => /\.(js|ts)$/.test(n))
      .sort()
      .map((n) => join(import.meta.dirname, n)),
  ];
  return digest(
    files
      .map((file) => {
        plain(file, true);
        return file + ":" + digest(readFileSync(file));
      })
      .join("\n"),
  );
}
const safeReason = (error: unknown) =>
  error instanceof Error &&
  /^(BRIDGE|RELAY|HOST|MCP)_[A-Z_]+$/.test(error.message)
    ? error.message
    : "BRIDGE_RUNTIME_FAILED";
function own(child: ChildProcessWithoutNullStreams) {
  let result: HostExit | null = null,
    forced = false;
  const closed = new Promise<HostExit>((resolve) =>
    child.once("close", (code, signal) => {
      result = { code: signal ? null : code, exit_observed: true, forced };
      resolve(result);
    }),
  );
  child.on("error", () => {});
  return {
    child,
    closed,
    snapshot: () => (result ? { ...result } : null),
    async terminate() {
      if (result) return result;
      forced = true;
      child.kill();
      let timer: NodeJS.Timeout | undefined;
      try {
        return await Promise.race([
          closed,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("BRIDGE_EXIT_UNKNOWN")),
              5000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
/** Trusted composition only: no default registration, native-client launch or free command. */
export function createOwnedBridgeFactory(input: unknown) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).sort().join(",") !== "config,dataRoot"
  )
    throw new Error("BRIDGE_CONFIG");
  const p = input as { dataRoot: string; config: unknown };
  if (typeof p.dataRoot !== "string" || !isAbsolute(p.dataRoot))
    throw new Error("BRIDGE_CONFIG");
  const dataRoot = resolve(p.dataRoot),
    config = structuredClone(p.config);
  plain(dataRoot, false);
  new McpReadClient(config).checkDisclosure();
  const pinned = codeDigest(),
    fingerprint = digest(pinned + JSON.stringify(config));
  const suffix = extname(import.meta.filename),
    bridgeEntry = join(import.meta.dirname, "mcp-entry" + suffix),
    relayEntry = join(import.meta.dirname, "bridge-relay-entry" + suffix);
  async function create(
    stillAuthorized: () => boolean,
    external: boolean,
  ): Promise<any> {
    const authorized = () => {
      if (stillAuthorized() !== true)
        throw new Error("BRIDGE_AUTHORIZATION_CHANGED");
    };
    authorized();
    plain(dataRoot, false);
    if (codeDigest() !== pinned) throw new Error("BRIDGE_CONFIG_CHANGED");
    new McpReadClient(config).checkDisclosure();
    authorized();
    const root = mkdtempSync(join(dataRoot, "owned-bridge-")),
      configPath = join(root, "bridge.json"),
      reportPath = join(root, "report.json");
    let bridge: ReturnType<typeof own> | undefined,
      relay: ReturnType<typeof own> | undefined,
      endpoint: Awaited<ReturnType<typeof openRelayEndpoint>> | undefined;
    let externalExit: HostExit | null = null;
    let fault: string | null = null,
      state = "starting",
      credentialsCleared = false,
      stopping: Promise<void> | undefined,
      aborting: Promise<void> | undefined;
    const clean = () => {
      try {
        plain(root, false);
        plain(configPath, true);
        unlinkSync(configPath);
        credentialsCleared = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          credentialsCleared = true;
          return;
        }
        throw new Error("BRIDGE_CREDENTIAL_CLEANUP");
      }
    };
    const abort = () => {
      if (aborting) return aborting;
      aborting = (async () => {
        if (state !== "closed") {
          fault ??= "BRIDGE_ABORTED";
          state = "failed";
        }
        const errors = [];
        try {
          await endpoint?.dispose();
        } catch (error) {
          errors.push(error);
        }
        for (const process of [relay, bridge])
          try {
            await process?.terminate();
          } catch (error) {
            errors.push(error);
          }
        try {
          clean();
        } catch (error) {
          errors.push(error);
        }
        if (errors.length) {
          fault = safeReason(errors[0]);
          state = "failed";
          throw new Error(fault);
        }
      })();
      return aborting;
    };
    try {
      writeFileSync(configPath, JSON.stringify(config), { flag: "wx" });
      authorized();
      const env = {
        ...(process.env.SystemRoot
          ? { SystemRoot: process.env.SystemRoot }
          : {}),
        TEMP: root,
        TMP: root,
        HOME: root,
        USERPROFILE: root,
        NO_COLOR: "1",
      };
      bridge = own(
        spawn(
          process.execPath,
          [bridgeEntry, "--config", configPath, "--report", reportPath],
          {
            cwd: root,
            env,
            windowsHide: true,
            shell: false,
            stdio: ["pipe", "pipe", "pipe"],
          },
        ),
      );
      const supervisor = new BridgeSupervisor(bridge.child, {
        reportPath,
        deadlineMs: 15000,
      });
      endpoint = await openRelayEndpoint(supervisor, {
        deadlineMs: 5000,
        ttlMs: 30000,
      });
      authorized();
      if (!external)
        relay = own(
          spawn(process.execPath, [relayEntry], {
            cwd: root,
            env: { ...env, TEAM_RELAY: JSON.stringify(endpoint.descriptor) },
            windowsHide: true,
            shell: false,
            stdio: ["pipe", "pipe", "pipe"],
          }),
        );
      if (relay) relay.child.stderr.resume();
      if (!external) {
        let readyTimer: NodeJS.Timeout | undefined;
        try {
          await Promise.race([
            endpoint.ready,
            relay!.closed.then(() => {
              throw new Error("RELAY_EARLY_EXIT");
            }),
            new Promise<never>((_, reject) => {
              readyTimer = setTimeout(
                () => reject(new Error("RELAY_AUTH_TIMEOUT")),
                5000,
              );
            }),
          ]);
        } finally {
          clearTimeout(readyTimer);
        }
      }
      authorized();
      state = "open";
      const ownedRelay = relay,
        ownedBridge = bridge,
        transport = endpoint;
      return {
        ...(ownedRelay
          ? { input: ownedRelay.child.stdin, output: ownedRelay.child.stdout }
          : {
              launch: {
                command: process.execPath,
                args: [relayEntry],
                env: { TEAM_RELAY: JSON.stringify(transport.descriptor) },
              },
              ready: transport.ready,
            }),
        snapshot: () => ({
          state:
            state === "open" && transport.snapshot().state === "failed"
              ? "failed"
              : state === "open" &&
                  external &&
                  transport.snapshot().state === "waiting"
                ? "waiting"
                : state,
          fault: fault ?? transport.snapshot().fault,
          credentials_cleared: credentialsCleared,
          bridge_exit: ownedBridge.snapshot(),
          relay_exit:
            ownedRelay?.snapshot() ??
            (externalExit ? { ...externalExit } : null),
        }),
        stop(
          first: () => Promise<HostExit>,
          second?: () => Promise<HostExit>,
        ): Promise<void> {
          const closeHost = external ? second : first;
          if (!closeHost)
            return Promise.reject(new Error("BRIDGE_HOST_REQUIRED"));
          if (stopping) return stopping;
          if (state !== "open")
            return Promise.reject(new Error(fault ?? "BRIDGE_NOT_OPEN"));
          state = "draining";
          stopping = (async () => {
            try {
              await transport.stop(
                ownedRelay
                  ? () => ownedRelay.closed
                  : async () => {
                      externalExit = { ...(await first()) };
                      return externalExit;
                    },
                closeHost,
              );
              await transport.dispose();
              clean();
              if (fault) throw new Error(fault);
              state = "closed";
            } catch (error) {
              fault ??= safeReason(error);
              state = "failed";
              await abort();
              throw new Error(fault!);
            }
          })();
          return stopping;
        },
        abort,
      };
    } catch (error) {
      fault = safeReason(error);
      await abort();
      throw new Error(fault);
    }
  }
  return Object.freeze({
    fingerprint,
    launch: (authorized: () => boolean) => create(authorized, false),
    prepareClient: (authorized: () => boolean) => create(authorized, true),
  });
}
