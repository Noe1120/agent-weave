// Synthetic stand-in for the official `codex app-server` stdio JSONL entry.
// It is a development fixture only: nothing here is the official Codex client,
// and a PASS against it is not a real handshake or a model task.
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";

const mode = process.argv[2] ?? "success";
const threadId = "11111111-1111-4111-8111-111111111111";
const turnId = "22222222-2222-4222-8222-222222222222";
const bad = new Set([
  "success",
  "no-jsonrpc",
  "duplicate",
  "unsolicited",
  "wrong-id",
  "error",
  "auth-error",
  "oversized",
  "stderr-flood",
  "server-request",
  "hang",
  "exit-early",
  "bad-utf8",
  "garbage",
  "turn-fail",
  "turn-hang",
  "interrupt-hang",
  "thread-error",
  "too-many-frames",
  "silent-close",
]);
if (!bad.has(mode)) {
  process.stderr.write("fixture: unknown mode\n");
  process.exit(64);
}

const line = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const answer = (id, result) =>
  line({ jsonrpc: "2.0", id, result: result ?? {} });
const refuse = (id, code, message) =>
  line({ jsonrpc: "2.0", id, error: { code, message } });
const notify = (method, params) =>
  line({ jsonrpc: "2.0", method, params: params ?? {} });
const noJsonrpc = (id, result) => line({ id, result: result ?? {} });

if (mode === "exit-early") {
  process.exit(3);
}

let initialize = null;
let threadStarted = false;
let turnStarted = false;
let frames = 0;
const timers = new Set();
const later = (fn, ms) => {
  const timer = setTimeout(() => {
    timers.delete(timer);
    fn();
  }, ms);
  timers.add(timer);
  return timer;
};

function onInitialize(id) {
  if (mode === "hang") return;
  if (mode === "error") return refuse(id, -32602, "invalid request");
  if (mode === "auth-error")
    return refuse(id, -32000, "unauthorized: login required");
  const result = {
    protocolVersion: "0.135.0",
    userAgent: "codex_cli_rs/0.135.0 (synthetic fixture)",
    capabilities: {
      approvals: true,
      requestUserInput: true,
      interrupt: true,
    },
  };
  if (mode === "wrong-id") return answer(id + 1, result);
  if (mode === "no-jsonrpc") noJsonrpc(id, result);
  else answer(id, result);
  if (mode === "duplicate") {
    later(() => answer(id, result), 5);
  }
  if (mode === "unsolicited") {
    later(() => answer(id + 100, { unexpected: true }), 5);
  }
  if (mode === "oversized") {
    later(() => {
      process.stdout.write(
        JSON.stringify({ jsonrpc: "2.0", method: "x", params: {} }) +
          " ".repeat(300000) +
          "\n",
      );
    }, 5);
  }
  if (mode === "stderr-flood") {
    later(() => {
      process.stderr.write("d".repeat(70000));
    }, 5);
  }
  if (mode === "bad-utf8") {
    later(() => {
      process.stdout.write(Buffer.from([0x7b, 0xff, 0xfe, 0x7d, 0x0a]));
    }, 5);
  }
  if (mode === "garbage") {
    later(() => {
      process.stdout.write("not-json\n");
    }, 5);
  }
  if (mode === "server-request") {
    later(() => {
      line({
        jsonrpc: "2.0",
        id: 900,
        method: "item/approval/request",
        params: { kind: "command", command: ["cmd.exe", "/c", "whoami"] },
      });
    }, 5);
  }
}

function onThreadStart(id) {
  if (mode === "thread-error") return refuse(id, -32602, "invalid params");
  threadStarted = true;
  answer(id, { thread: { id: threadId, preview: "", status: "idle" } });
}

function onTurnStart(id) {
  turnStarted = true;
  answer(id, { turn: { id: turnId, status: "inProgress" } });
  if (mode === "turn-hang") return;
  later(() => notify("turn/started", { threadId, turnId }), 5);
  later(
    () =>
      notify("item/completed", {
        threadId,
        turnId,
        item: { type: "message", role: "assistant", text: "synthetic" },
      }),
    10,
  );
  later(
    () =>
      notify("turn/completed", {
        threadId,
        turn: {
          id: turnId,
          status: mode === "turn-fail" ? "failed" : "completed",
        },
      }),
    15,
  );
}

function onInterrupt(id) {
  if (mode === "interrupt-hang") return;
  answer(id, {});
  notify("turn/completed", {
    threadId,
    turn: { id: turnId, status: "interrupted" },
  });
}

createInterface({ input: process.stdin }).on("line", (text) => {
  frames++;
  if (frames > 50 && mode === "too-many-frames") {
    process.stderr.write("fixture: frame flood\n");
    process.exit(70);
  }
  let frame;
  try {
    frame = JSON.parse(text);
  } catch {
    process.stderr.write("fixture: malformed\n");
    return;
  }
  if (frame.method === undefined) {
    // Client answers a server-initiated request: record refusal text for the harness.
    process.stderr.write(
      "client-response:" +
        createHash("sha256")
          .update(JSON.stringify(frame))
          .digest("hex")
          .slice(0, 16) +
        "\n",
    );
    return;
  }
  if (frame.method === "initialize") {
    initialize = frame.id;
    return onInitialize(frame.id);
  }
  if (frame.method === "initialized") return;
  if (frame.method === "thread/start") {
    if (initialize === null) return refuse(frame.id, -32000, "not initialized");
    return onThreadStart(frame.id);
  }
  if (frame.method === "turn/start") {
    if (!threadStarted) return refuse(frame.id, -32000, "no thread");
    if (mode === "silent-close") return;
    return onTurnStart(frame.id);
  }
  if (frame.method === "turn/interrupt") return onInterrupt(frame.id);
  refuse(frame.id, -32601, "method not found");
});

process.stdin.on("end", () => {
  for (const timer of timers) clearTimeout(timer);
  process.exit(turnStarted && mode === "turn-hang" ? 0 : 0);
});
