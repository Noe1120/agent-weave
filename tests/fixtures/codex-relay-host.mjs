// Synthetic protocol host which really owns the relay child; no model or vendor.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import {
  readFrames,
  writeFrame,
} from "../../packages/service/src/bridge-relay-io.ts";
let relay, frames;
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
    frames = readFrames(relay.stdout, 131072, 1048576);
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
  }
  if (frame.method === "turn/start") {
    const id = "fixture-turn",
      threadId = frame.params.threadId;
    await writeFrame(
      relay.stdin,
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "task_get",
          arguments: { task_id: frame.params.input[0].text },
        },
      },
      3000,
    );
    const response = (await frames.next()).value;
    if (response.id !== 3 || response.result.isError)
      throw new Error("FIXTURE_TASK_READ");
    const task = JSON.parse(response.result.content[0].text);
    answer(frame.id, { turn: { id } });
    for (const notification of [
      {
        method: "item/completed",
        params: {
          threadId,
          turnId: id,
          item: {
            type: "agentMessage",
            text: `${task.ref.id}: ${task.data.status}`,
          },
        },
      },
      {
        method: "turn/completed",
        params: { threadId, turn: { id, status: "completed" } },
      },
    ])
      process.stdout.write(JSON.stringify(notification) + "\n");
  }
}
relay?.stdin.end();
