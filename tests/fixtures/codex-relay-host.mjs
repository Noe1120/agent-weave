// Synthetic protocol host which really owns the relay child; no model or vendor.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import {
  readFrames,
  writeFrame,
} from "../../packages/service/src/bridge-relay-io.ts";
let relay;
const answer = (id, result) =>
  process.stdout.write(JSON.stringify({ id, result }) + "\n");
for await (const text of createInterface({ input: process.stdin })) {
  const frame = JSON.parse(text);
  if (frame.method === "initialize")
    answer(frame.id, {
      codexHome: process.env.CODEX_HOME,
      platformFamily: "windows",
      platformOs: "windows",
      userAgent: "synthetic",
    });
  if (frame.method === "thread/start") {
    relay = spawn(process.execPath, [process.argv[2]], {
      env: process.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    relay.stderr.resume();
    const frames = readFrames(relay.stdout, 131072, 1048576);
    await writeFrame(
      relay.stdin,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "w29", version: "1" },
        },
      },
      3000,
    );
    await frames.next();
    await writeFrame(
      relay.stdin,
      { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
      3000,
    );
    await writeFrame(
      relay.stdin,
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      3000,
    );
    await frames.next();
    answer(frame.id, { thread: { id: "synthetic-owned-thread" } });
    void (async () => {
      for await (const _ of frames) {
        /* drain owned relay */
      }
    })();
  }
}
relay?.stdin.end();
