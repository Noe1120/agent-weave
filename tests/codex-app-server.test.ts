import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CodexAppServer } from "../packages/service/src/codex-app-server.ts";
import { AdapterFault } from "../packages/service/src/adapter-contract.ts";

// Every case below runs the synthetic fixture, never the installed Codex client.
// Envelope shapes follow the JSON Schema the fixed CLI generates
// (`codex app-server generate-json-schema`): no `jsonrpc` member.
function start(
  mode: string,
  options: { requestMs?: number; closeMs?: number } = {},
) {
  const child = spawn(
    process.execPath,
    [resolve("tests/fixtures/codex-app-server-fixture.mjs"), mode],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  const handle = new CodexAppServer(child, {
    requestMs: options.requestMs ?? 5000,
    closeMs: options.closeMs ?? 1500,
  });
  return { child, handle };
}
async function code(promise: Promise<unknown>) {
  try {
    await promise;
    return "resolved";
  } catch (error) {
    assert.ok(error instanceof AdapterFault, String(error));
    return (error as AdapterFault).code;
  }
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function ready(mode: string, options = {}) {
  const started = start(mode, options);
  const hello = await started.handle.ready;
  const thread = await started.handle.startThread(resolve("tests/fixtures"));
  return { ...started, hello, thread };
}
test("real-shaped initialization, native thread, one turn and owned close", async () => {
  const { handle } = start("success");
  const hello = await handle.ready;
  assert.equal(hello.schema, "codex-app-server/v1");
  assert.equal(
    hello.user_agent,
    "codex_cli_rs/0.167.0-alpha.3.2 (synthetic fixture)",
  );
  assert.equal(hello.codex_home, "C:\\Users\\synthetic\\.codex");
  assert.equal(hello.platform_family, "windows");
  assert.equal(hello.platform_os, "windows");
  assert.equal(hello.unrecognized_fields, 0);
  assert.equal(handle.status.state, "ready");
  const thread = await handle.startThread(resolve("tests/fixtures"));
  assert.equal(thread, "01930000-0000-7000-8000-00000000aaaa");
  const turn = await handle.startTurn(
    thread,
    "synthetic acceptance instruction",
  );
  assert.equal(turn, "01930000-0000-7000-8000-00000000bbbb");
  await wait(120);
  const facts = handle.statistics.turn;
  assert.ok(facts, "no turn facts recorded");
  assert.equal(facts.generation, 1);
  assert.equal(facts.state, "completed");
  assert.equal(facts.turn_id, "01930000-0000-7000-8000-00000000bbbb");
  assert.match(facts.last_agent_message ?? "", /synthetic reply/);
  assert.deepEqual(facts.token_usage, { total: 120, input: 100, output: 20 });
  assert.equal(facts.stale_terminal_notifications, 0);
  assert.equal(handle.statistics.refused_server_requests, 0);
  assert.equal(handle.statistics.requests, 2);
  handle.close();
  const exit = await handle.closed;
  assert.equal(exit.code, 0);
  assert.equal(exit.exit_observed, true);
  assert.equal(exit.forced, false);
  assert.equal(exit.fault, null);
  assert.equal(exit.frames_out, 4);
  assert.equal(handle.status.state, "closed");
});
test("a tolerated jsonrpc member is accepted, a wrong one fails closed", async () => {
  const tolerated = start("with-jsonrpc");
  const hello = await tolerated.handle.ready;
  assert.equal(hello.platform_os, "windows");
  tolerated.handle.close();
  const exit = await tolerated.handle.closed;
  assert.equal(exit.fault, null);

  const rejected = start("bad-jsonrpc");
  assert.equal(await code(rejected.handle.ready), "CODEX_PROTOCOL");
  await rejected.handle.closed;
  assert.notEqual(rejected.handle.status.state, "ready");
});
test("duplicate, unsolicited, wrong id, malformed and under-encoded frames fail closed", async () => {
  const malformed: [string, string][] = [
    ["duplicate", "CODEX_PROTOCOL"],
    ["unsolicited", "CODEX_PROTOCOL"],
    ["wrong-id", "CODEX_PROTOCOL"],
    ["bad-utf8", "CODEX_PROTOCOL"],
    ["garbage", "CODEX_PROTOCOL"],
  ];
  for (const [mode, expected] of malformed) {
    const { handle } = start(mode);
    void handle.ready.catch(() => {});
    const exit = await handle.closed;
    assert.equal(exit.fault, expected, mode);
    assert.equal(exit.exit_observed, true);
    assert.notEqual(handle.status.state, "ready", mode);
  }
});
test("initialize rejection is reported as an adapter fault, not as ready", async () => {
  const rejected = start("error");
  assert.equal(await code(rejected.handle.ready), "CODEX_INITIALIZE_REJECTED");
  await rejected.handle.closed;
  assert.notEqual(rejected.handle.status.state, "ready");

  const unauthenticated = start("auth-error");
  assert.equal(await code(unauthenticated.handle.ready), "CODEX_AUTH_REQUIRED");
  await unauthenticated.handle.closed;
});
test("bounded stdout, frame and stderr limits terminate the transport", async () => {
  for (const [mode, expected] of [
    ["oversized", "CODEX_FRAME_LIMIT"],
    ["stderr-flood", "CODEX_STDERR_LIMIT"],
  ] as [string, string][]) {
    const { handle } = start(mode);
    await handle.ready;
    const exit = await handle.closed;
    assert.equal(exit.fault, expected, mode);
    assert.equal(handle.status.state, "closed");
  }
});
test("a server-initiated approval request is refused and never granted", async () => {
  const { handle } = start("server-request");
  await handle.ready;
  await wait(80);
  assert.equal(handle.statistics.refused_server_requests, 1);
  assert.equal(handle.statistics.turn, null);
  handle.close();
  const exit = await handle.closed;
  assert.equal(exit.fault, null);
});
test("timeouts, disconnection and thread/turn rejections stay distinct", async () => {
  const timedOut = start("hang", { requestMs: 300 });
  assert.equal(await code(timedOut.handle.ready), "CODEX_INITIALIZE_TIMEOUT");

  const early = start("exit-early");
  const exit = await early.handle.closed;
  assert.equal(exit.exit_observed, true);
  assert.equal(exit.code, 3);

  const thread = start("thread-error");
  await thread.handle.ready;
  assert.equal(
    await code(thread.handle.startThread(resolve("tests/fixtures"))),
    "CODEX_THREAD_REJECTED",
  );
  thread.handle.close();

  const turnHang = start("turn-hang", { requestMs: 400 });
  await turnHang.handle.ready;
  const accepted = await turnHang.handle.startThread(resolve("tests/fixtures"));
  await turnHang.handle.startTurn(accepted, "synthetic");
  // Acknowledged but no terminal event: the turn stays running, never completed.
  assert.equal(turnHang.handle.statistics.turn?.state, "running");
  turnHang.handle.close();

  const interruptHang = start("interrupt-hang", { requestMs: 300 });
  await interruptHang.handle.ready;
  const thread2 = await interruptHang.handle.startThread(
    resolve("tests/fixtures"),
  );
  await interruptHang.handle.startTurn(thread2, "synthetic");
  assert.equal(
    await code(interruptHang.handle.interruptTurn(thread2, "turn")),
    "CODEX_INTERRUPT_TIMEOUT",
  );
});
test("an unacknowledged turn stays running and is never reported complete", async () => {
  const { handle } = start("silent-close", { requestMs: 400 });
  await handle.ready;
  const thread = await handle.startThread(resolve("tests/fixtures"));
  assert.equal(
    await code(handle.startTurn(thread, "synthetic")),
    "CODEX_TURN_TIMEOUT",
  );
  assert.equal(handle.statistics.turn?.state, "running");
});
test("only the real terminal TurnStatus values are accepted for the current turn", async () => {
  const inProgress = await ready("turn-inprogress");
  await inProgress.handle.startTurn(inProgress.thread, "synthetic");
  await wait(120);
  assert.equal(inProgress.handle.statistics.turn?.state, "running");
  inProgress.handle.close();

  const failed = await ready("turn-fail");
  await failed.handle.startTurn(failed.thread, "synthetic");
  await wait(120);
  assert.equal(failed.handle.statistics.turn?.state, "failed");
  failed.handle.close();
});
test("each turn gets its own generation, message and token usage", async () => {
  const { handle, thread } = await ready("two-turns-ok");
  await handle.startTurn(thread, "first");
  await wait(120);
  const first = handle.statistics.turn;
  assert.equal(first?.generation, 1);
  assert.equal(first?.turn_id, "01930000-0000-7000-8000-00000000bbbb");
  assert.equal(first?.state, "completed");
  assert.match(first?.last_agent_message ?? "", /bbbb/);

  await handle.startTurn(thread, "second");
  await wait(120);
  const second = handle.statistics.turn;
  assert.equal(second?.generation, 2);
  assert.equal(second?.turn_id, "01930000-0000-7000-8000-00000000cccc");
  assert.equal(second?.state, "completed");
  assert.match(second?.last_agent_message ?? "", /cccc/);
  assert.notEqual(second?.last_agent_message, first?.last_agent_message);
  handle.close();
});
test("a second turn without its own terminal event never inherits completed", async () => {
  const { handle, thread } = await ready("second-turn-silent");
  await handle.startTurn(thread, "first");
  await wait(120);
  assert.equal(handle.statistics.turn?.state, "completed");

  await handle.startTurn(thread, "second");
  await wait(150);
  const facts = handle.statistics.turn;
  assert.equal(facts?.generation, 2);
  assert.equal(facts?.turn_id, "01930000-0000-7000-8000-00000000cccc");
  assert.equal(facts?.state, "running");
  assert.equal(facts?.completed_at, null);
  handle.close();
});
test("a late terminal event from the first turn is counted and ignored", async () => {
  const { handle, thread } = await ready("late-first-terminal");
  await handle.startTurn(thread, "first");
  await wait(120);
  assert.equal(handle.statistics.turn?.state, "completed");

  await handle.startTurn(thread, "second");
  await wait(200);
  const facts = handle.statistics.turn;
  assert.equal(facts?.generation, 2);
  assert.equal(facts?.state, "running");
  assert.ok(
    (facts?.stale_terminal_notifications ?? 0) >= 1,
    "the stale terminal event was not counted",
  );
  handle.close();
});
test("a concurrent turn is refused while the current one is running", async () => {
  const { handle, thread } = await ready("turn-hang");
  await handle.startTurn(thread, "first");
  assert.equal(await code(handle.startTurn(thread, "second")), "CODEX_BUSY");
  handle.close();
});
test("no turn, generic request or approval path exists before initialization", async () => {
  const { handle } = start("hang", { requestMs: 5000 });
  assert.equal(
    await code(handle.startThread(resolve("tests/fixtures"))),
    "CODEX_BUSY",
  );
  assert.equal(await code(handle.startTurn("x", "y")), "CODEX_BUSY");
  assert.equal(await code(handle.interruptTurn("x", "y")), "CODEX_BUSY");
  handle.close();
  await handle.closed;
});
test("only the four fixed client methods exist in the transport source", () => {
  const source = readFileSync(
    "packages/service/src/codex-app-server.ts",
    "utf8",
  );
  const sent = new Set(
    [
      ...source.matchAll(
        /(?:method:\s*"|this\.request\(")([a-z]+(?:\/[a-z]+)?)/g,
      ),
    ].map((m) => m[1]),
  );
  assert.deepEqual([...sent].sort(), [
    "initialize",
    "initialized",
    "thread/start",
    "turn/interrupt",
    "turn/start",
  ]);
  for (const banned of [
    "thread/resume",
    "thread/read",
    "turn/steer",
    "command/exec",
    "process/spawn",
  ])
    assert.equal(source.includes(banned), false, banned);
  assert.equal(source.includes('jsonrpc: "2.0"'), false);
});
