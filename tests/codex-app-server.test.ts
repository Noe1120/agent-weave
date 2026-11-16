import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CodexAppServer } from "../packages/service/src/codex-app-server.ts";
import { AdapterFault } from "../packages/service/src/adapter-contract.ts";

// Every case below runs the synthetic fixture, never the installed Codex client.
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
test("candidate initialization, native thread, one turn and owned close", async () => {
  const { handle } = start("success");
  const hello = await handle.ready;
  assert.equal(hello.schema, "candidate/1");
  assert.equal(hello.protocol_version, "0.135.0");
  assert.equal(hello.user_agent, "codex_cli_rs/0.135.0 (synthetic fixture)");
  assert.deepEqual(hello.declared, {
    approvals: true,
    request_user_input: true,
    interrupt: true,
  });
  assert.equal(hello.unrecognized_fields, 0);
  assert.equal(handle.status.state, "ready");
  const thread = await handle.startThread(resolve("tests/fixtures"));
  assert.equal(thread, "11111111-1111-4111-8111-111111111111");
  const turn = await handle.startTurn(
    thread,
    "synthetic acceptance instruction",
  );
  assert.equal(turn, "22222222-2222-4222-8222-222222222222");
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(handle.statistics.turn_state, "completed");
  assert.ok(handle.statistics.notifications >= 3);
  assert.deepEqual(handle.statistics.unknown_notifications, [
    "turn/started",
    "item/completed",
  ]);
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
test("a documented frame without the jsonrpc member is accepted", async () => {
  const { handle } = start("no-jsonrpc");
  const hello = await handle.ready;
  assert.equal(hello.protocol_version, "0.135.0");
  handle.close();
  const exit = await handle.closed;
  assert.equal(exit.fault, null);
  assert.equal(exit.exit_observed, true);
});
test("duplicate, unsolicited, malformed and under-encoded frames fail closed", async () => {
  const malformed: [string, string][] = [
    ["duplicate", "CODEX_PROTOCOL"],
    ["unsolicited", "CODEX_PROTOCOL"],
    ["wrong-id", "CODEX_PROTOCOL"],
    ["bad-utf8", "CODEX_PROTOCOL"],
    ["garbage", "CODEX_PROTOCOL"],
  ];
  for (const [mode, expected] of malformed) {
    const { handle } = start(mode);
    // A wrong-id reply replaces the expected one, so readiness itself may reject.
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
  const bounded: [string, string][] = [
    ["oversized", "CODEX_FRAME_LIMIT"],
    ["stderr-flood", "CODEX_STDERR_LIMIT"],
  ];
  for (const [mode, expected] of bounded) {
    const { handle } = start(mode);
    // The offending frame arrives after a valid initialize reply, so the
    // terminated transport, not the ready promise, carries the fault.
    await handle.ready;
    const exit = await handle.closed;
    assert.equal(exit.fault, expected, mode);
    assert.equal(handle.status.state, "closed");
  }
});
test("a server-initiated approval request is refused and never granted", async () => {
  const { handle } = start("server-request");
  await handle.ready;
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(handle.statistics.refused_server_requests, 1);
  assert.equal(handle.statistics.turn_state, "none");
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
  // The turn request is acknowledged; a missing turn/completed must stay "none"
  // instead of being promoted to a completed turn.
  await turnHang.handle.startTurn(accepted, "synthetic");
  assert.equal(turnHang.handle.statistics.turn_state, "none");
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
test("an unacknowledged turn stays unknown and is never reported complete", async () => {
  const { handle } = start("silent-close", { requestMs: 400 });
  await handle.ready;
  const thread = await handle.startThread(resolve("tests/fixtures"));
  assert.equal(
    await code(handle.startTurn(thread, "synthetic")),
    "CODEX_TURN_TIMEOUT",
  );
  assert.equal(handle.statistics.turn_state, "none");
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
      ...source.matchAll(/(?:method:\s*"|request\(")([a-z]+(?:\/[a-z]+)?)/g),
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
});
