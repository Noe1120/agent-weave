import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { Store } from "./store.ts";
import { CoreService } from "./service.ts";
import { createServer } from "./http.ts";
import { WorkspaceService } from "./workspace-service.ts";
import { listenLoopback } from "./loopback-listener.ts";
const runtime = process.versions.node.split(".").map(Number);
if (runtime[0] !== 24 || runtime[1]! < 14)
  throw new Error(
    "Baseline requires Node 24.14+ within Node 24; other runtimes are not qualified.",
  );
const portText = process.env.PORT ?? "4317";
if (!/^\d+$/.test(portText) || Number(portText) > 65535)
  throw new Error("Invalid PORT");
const filename = resolve(process.env.CORE_DB ?? ".runtime/core.sqlite");
mkdirSync(dirname(filename), { recursive: true });
const store = new Store(filename);
const workspace = new WorkspaceService(store);
const pairing = workspace.auth.newPairing();
const server = createServer(new CoreService(store), workspace);
function startupFailure() {
  console.error("Local core server could not start.");
  store.close();
  process.exitCode = 1;
}
try {
  await listenLoopback(server, Number(portText));
  server.on("error", startupFailure);
  const address = server.address();
  if (address && typeof address !== "string") {
    console.log(
      JSON.stringify({
        service: "local-workspace",
        host: "127.0.0.1",
        port: address.port,
        qualification: "SYNTHETIC_REFERENCE_ONLY",
        native_dispatch: false,
      }),
    );
    console.log(
      "本地工作台：http://127.0.0.1:" +
        address.port +
        "\n一次性配对码（10分钟有效，请勿分享）：" +
        pairing.code,
    );
  }
} catch {
  startupFailure();
}
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  server.closeAllConnections();
  server.close(() => store.close());
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
