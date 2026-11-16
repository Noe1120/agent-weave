// Synthetic stand-in for the official `codex app-server` stdio JSONL entry.
// It is a development fixture only: nothing here is the official Codex client,
// and a PASS against it is not a real handshake or a model task.
//
// Envelopes follow the JSON Schema the fixed CLI generates: no `jsonrpc` member,
// requests are {id, method, params}, responses {id, result} or {id, error}, and
// notifications {method, params}.
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";

const mode = process.argv[2] ?? "success";
const threadId = "01930000-0000-7000-8000-00000000aaaa";
const turnId = "01930000-0000-7000-8000-00000000bbbb";
const modes = new Set([
  "success",
  "no-jsonrpc",
  "with-jsonrpc",
  "bad-jsonrpc",
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
  "turn-inprogress",
  "turn-hang",
  "interrupt-hang",
  "thread-error",
  "silent-close",
]);
if (!modes.has(mode)) {
  process.stderr.write("fixture: unknown mode\n");
  process.exit(64);
}
const wired = (value) =>
  mode === "with-jsonrpc" || mode === "bad-jsonrpc"
    ? { jsonrpc: mode === "with-jsonrpc" ? "2.0" : "1.0", ...value }
    : value;
const line = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const answer = (id, result) => line(wired({ id, result: result ?? {} }));
const refuse = (id, code, message) =>
  line(wired({ id, error: { code, message } }));
const notify = (method, params) =>
  line(wired({ method, params: params ?? {} }));

if (mode === "exit-early") process.exit(3);

let initialize = null;
let threadStarted = false;
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
  // v1 InitializeResponse requires these four members.
  const result = {
    codexHome: "C:\\Users\\synthetic\\.codex",
    platformFamily: "windows",
    platformOs: "windows",
    userAgent: "codex_cli_rs/0.167.0-alpha.3.2 (synthetic fixture)",
  };
  if (mode === "wrong-id") return answer(id + 1, result);
  answer(id, result);
  if (mode === "duplicate") later(() => answer(id, result), 5);
  if (mode === "unsolicited") later(() => answer(id + 100, { x: 1 }), 5);
  if (mode === "oversized")
    later(
      () =>
        process.stdout.write(
          JSON.stringify({ method: "x", params: {} }) +
            " ".repeat(300000) +
            "\n",
        ),
      5,
    );
  if (mode === "stderr-flood")
    later(() => process.stderr.write("d".repeat(70000)), 5);
  if (mode === "bad-utf8")
    later(
      () => process.stdout.write(Buffer.from([0x7b, 0xff, 0xfe, 0x7d, 0x0a])),
      5,
    );
  if (mode === "garbage") later(() => process.stdout.write("not-json\n"), 5);
  if (mode === "server-request")
    later(
      () =>
        line({
          id: 900,
          method: "item/commandExecution/requestApproval",
          params: { threadId, turnId, command: ["cmd.exe", "/c", "whoami"] },
        }),
      5,
    );
}

function onThreadStart(id) {
  if (mode === "thread-error") return refuse(id, -32602, "invalid params");
  threadStarted = true;
  // v2 ThreadStartResponse requires the thread object; only `id` is read.
  answer(id, {
    approvalPolicy: "never",
    approvalsReviewer: "user",
    cwd: "C:\\work",
    model: "synthetic",
    modelProvider: "synthetic",
    sandbox: { type: "readOnly" },
    thread: { id: threadId, status: { type: "idle" } },
  });
}

function onTurnStart(id) {
  // No reply at all: the client must time out and leave the turn unknown.
  if (mode === "silent-close") return;
  answer(id, { turn: { id: turnId, items: [], status: "inProgress" } });
  // Acknowledged but never terminal: only an explicit interrupt may end it.
  if (mode === "turn-hang") return;
  later(() => notify("turn/started", { threadId, turn: { id: turnId } }), 5);
  later(
    () =>
      notify("item/completed", {
        threadId,
        item: { type: "agentMessage", text: "synthetic reply" },
      }),
    10,
  );
  if (mode === "turn-inprogress")
    return later(
      () =>
        notify("turn/completed", {
          threadId,
          turn: { id: turnId, items: [], status: "inProgress" },
        }),
      15,
    );
  later(
    () =>
      notify("turn/completed", {
        threadId,
        turn: {
          id: turnId,
          items: [],
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
    turn: { id: turnId, items: [], status: "interrupted" },
  });
}

createInterface({ input: process.stdin }).on("line", (text) => {
  let frame;
  try {
    frame = JSON.parse(text);
  } catch {
    process.stderr.write("fixture: malformed\n");
    return;
  }
  if (frame.method === undefined) {
    // Client answers a server-initiated request: record the refusal digest.
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
    return onTurnStart(frame.id);
  }
  if (frame.method === "turn/interrupt") return onInterrupt(frame.id);
  refuse(frame.id, -32601, "method not found");
});

process.stdin.on("end", () => {
  for (const timer of timers) clearTimeout(timer);
  process.exit(0);
});
