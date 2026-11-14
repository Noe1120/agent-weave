// Private, pipe-owned desktop entry. No browser launch, public shutdown route or token file.
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { Server } from "node:http";
import { Store } from "./store.ts";
import { CoreService } from "./service.ts";
import { WorkspaceService } from "./workspace-service.ts";
import { createServer } from "./http.ts";
const runtime = process.versions.node.split(".").map(Number);
if (runtime[0] !== 24 || runtime[1]! < 14)
  throw new Error("Requires Node 24.14+ within Node 24");
if (!process.env.CORE_DB)
  throw new Error("Desktop requires an explicit database path");
const input = createInterface({ input: process.stdin });
let store: Store | undefined;
let server: Server | undefined;
let started = false;
let stopping = false;
const deadline = setTimeout(shutdown, 15000);
function shutdown() {
  if (stopping) return;
  stopping = true;
  clearTimeout(deadline);
  input.close();
  process.stdin.destroy();
  const close = () => {
    store?.close();
    store = undefined;
  };
  if (server) {
    server.closeAllConnections();
    server.close(close);
  } else close();
}
function startupFailure(error: unknown) {
  const detail = error as Error & { code?: string };
  console.error(
    JSON.stringify({
      event: "desktop_start_failed",
      error_type: detail?.name ?? "Unknown",
      error_code: detail?.code ?? "UNKNOWN",
    }),
  );
  process.exitCode = 1;
  shutdown();
}
input.on("line", (line) => {
  if (line === "stop") return shutdown();
  if (line !== "start" || started || stopping) return;
  started = true;
  clearTimeout(deadline);
  try {
    const filename = resolve(process.env.CORE_DB!);
    mkdirSync(dirname(filename), { recursive: true });
    store = new Store(filename);
    const workspace = new WorkspaceService(store);
    const pairing = workspace.auth.newPairing();
    server = createServer(new CoreService(store), workspace);
    server.on("error", startupFailure);
    server.listen(0, "127.0.0.1", () => {
      const address = server!.address();
      if (!stopping && address && typeof address !== "string") {
        process.stdout.write(
          JSON.stringify({
            protocol: "desktop/1",
            host: "127.0.0.1",
            port: address.port,
            code: pairing.code,
            native_dispatch: false,
          }) + "\n",
        );
      }
    });
  } catch (error) {
    startupFailure(error);
  }
});
input.on("close", shutdown);
process.stdin.on("error", shutdown);
process.stdout.on("error", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
