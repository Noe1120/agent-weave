import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolve } from "node:path";
import { adapterFixture } from "./adapter-helpers.ts";
import { id } from "./helpers.ts";
import {
  CodexAppServer,
  type CodexHandle,
  type CodexLauncher,
} from "../packages/service/src/codex-app-server.ts";
import { CodexRuntimeController } from "../packages/service/src/codex-runtime.ts";
import { ServiceFault } from "../packages/service/src/errors.ts";
import { AdapterFault } from "../packages/service/src/adapter-contract.ts";
const workDir = resolve("tests/fixtures");
function setup(
  t: TestContext,
  mode = "success",
  options: { monitorMs?: number; turnMs?: number; requestMs?: number } = {},
) {
  const f = adapterFixture();
  let launched = 0;
  const handles: CodexHandle[] = [];
  const children: ChildProcessWithoutNullStreams[] = [];
  const launcher: CodexLauncher = {
    fingerprint: "a".repeat(64),
    clientVersion: "fixture-1",
    source: "development_fixture",
    async launch(allowed) {
      if (!allowed()) throw new Error("unauthorized");
      launched++;
      const child = spawn(
        process.execPath,
        [resolve("tests/fixtures/codex-app-server-fixture.mjs"), mode],
        { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
      );
      children.push(child);
      const h = new CodexAppServer(child, {
        requestMs: options.requestMs ?? 5000,
        closeMs: 1500,
        workDirectory: workDir,
      });
      handles.push(h);
      return h;
    },
  };
  const c = new CodexRuntimeController(f.s, launcher, {
    now: f.now,
    monitorMs: options.monitorMs ?? 0,
    turnMs: options.turnMs ?? 1000,
  });
  t.after(async () => {
    await c.dispose();
    for (const child of children) if (!child.killed) child.kill();
    f.s.db.close();
  });
  const start = (patch = {}) => ({
    project_id: f.ids.project,
    runtime_id: f.binding,
    scope_id: f.ids.scope,
    action_id: id(),
    expected_revision: "0",
    configuration_fingerprint: launcher.fingerprint,
    ...patch,
  });
  const revision = () => c.read(f.token, f.ids.project, f.binding).revision;
  const view = () => c.read(f.token, f.ids.project, f.binding);
  const turn = (patch = {}) => ({
    project_id: f.ids.project,
    runtime_id: f.binding,
    action_id: id(),
    expected_revision: revision(),
    instruction_profile: "synthetic_task_get/1",
    task_id: f.ids.task,
    ...patch,
  });
  const close = () =>
    c.close(f.token, {
      project_id: f.ids.project,
      runtime_id: f.binding,
      action_id: id(),
      expected_revision: revision(),
    });
  const interrupt = () =>
    c.interrupt(f.token, {
      project_id: f.ids.project,
      runtime_id: f.binding,
      action_id: id(),
      expected_revision: revision(),
    });
  return {
    ...f,
    c,
    launcher,
    start,
    turn,
    close,
    interrupt,
    view,
    revision,
    handles,
    children,
    launched: () => launched,
  };
}
async function fault(promise: Promise<unknown>) {
  try {
    await promise;
    return "resolved";
  } catch (error) {
    assert.ok(
      error instanceof AdapterFault || error instanceof ServiceFault,
      String(error),
    );
    return (error as AdapterFault).code;
  }
}
async function until(condition: () => boolean, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}
/** A turn is only addressable once its native identifier has been acknowledged. */
const untilAcked = (
  view: () => { turn: { id_sha256: string | null } | null },
) => until(() => view().turn?.id_sha256 != null);
test("an authorized runtime binds a native thread without a platform session", async (t) => {
  const f = setup(t);
  const run = f.s.getRun(f.ids.run);
  const request = f.start();
  const first = await f.c.start(f.token, request);
  assert.equal(first.operation_status, "accepted");
  assert.equal(f.launched(), 1);
  const view = f.view();
  assert.equal(view.state, "ready");
  assert.equal(view.session_id, null);
  assert.equal(view.qualification, "UNVERIFIED");
  assert.equal(view.binding_mode, "owned_process");
  assert.equal(view.observation_source, "development_fixture");
  assert.equal(view.initialize_schema, "candidate/1");
  assert.equal(view.protocol_version, "0.135.0");
  assert.equal(view.native_thread_sha256?.length, 64);
  assert.equal(view.turn, null);
  assert.ok(Object.values(view.capabilities).every((v) => !v.enabled));
  const changes = f.s.db.prepare("SELECT total_changes() AS n").get()!.n;
  for (let i = 0; i < 100; i++) f.view();
  assert.equal(f.s.db.prepare("SELECT total_changes() AS n").get()!.n, changes);
  assert.equal(f.launched(), 1);
  assert.deepEqual(await f.c.start(f.token, request), first);
  assert.equal(f.launched(), 1);
  await f.close();
  assert.equal(f.view().state, "closed");
  assert.deepEqual(await f.c.start(f.token, request), first);
  assert.equal(f.launched(), 1);
  assert.deepEqual(f.s.getRun(f.ids.run), run);
});
for (const bad of [
  "revoked",
  "policy",
  "scope",
  "runtime",
  "fingerprint",
  "extra",
] as const)
  test("no process starts when " + bad, async (t) => {
    const f = setup(t);
    const request = f.start();
    if (bad === "revoked") {
      f.g.state = "revoked";
      f.s.updateGrant(f.g);
    }
    if (bad === "policy") {
      f.p.active = false;
      f.s.putPolicy(f.p);
    }
    if (bad === "scope") {
      f.g.resource_ids = f.g.resource_ids.filter((r) => r !== f.ids.scope);
      f.s.updateGrant(f.g);
    }
    if (bad === "runtime") {
      f.g.resource_ids = f.g.resource_ids.filter((r) => r !== f.binding);
      f.s.updateGrant(f.g);
    }
    if (bad === "fingerprint")
      request.configuration_fingerprint = "b".repeat(64);
    if (bad === "extra")
      (request as unknown as Record<string, unknown>).command = "cmd.exe /c id";
    await assert.rejects(async () => f.c.start(f.token, request));
    assert.equal(f.launched(), 0);
  });
test("revision conflict, duplicate action and payload conflict are separated", async (t) => {
  const f = setup(t);
  const request = f.start();
  await f.c.start(f.token, request);
  const other = f.start({ expected_revision: "0" });
  await assert.rejects(async () => f.c.start(f.token, other));
  assert.equal(f.launched(), 1);
  await assert.rejects(async () => {
    const replay = f.start();
    await f.c.start(f.token, replay);
    await f.c.start(f.token, { ...replay, scope_id: id() });
  });
});
test("one synthetic turn is bound to the grant task and completes from native events", async (t) => {
  const f = setup(t);
  await f.c.start(f.token, f.start());
  const request = f.turn();
  const receipt = await f.c.turn(f.token, request);
  assert.equal(receipt.operation_status, "accepted");
  await until(() => f.view().turn?.state === "completed");
  const view = f.view();
  assert.equal(view.state, "ready");
  assert.equal(view.instruction_profile, "synthetic_task_get/1");
  assert.equal(view.turn?.id_sha256?.length, 64);
  assert.equal(view.turn?.state, "completed");
  assert.ok((view.statistics?.notifications ?? 0) >= 3);
  assert.equal(view.statistics?.refused_server_requests, 0);
  const requests = view.statistics?.requests;
  // A replayed action returns the same receipt and starts no second turn.
  assert.deepEqual(await f.c.turn(f.token, request), receipt);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(f.view().statistics?.requests, requests);
});
test("a turn that is not bound by the grant is refused before any native request", async (t) => {
  const f = setup(t);
  await f.c.start(f.token, f.start());
  const requests = f.view().statistics?.requests;
  assert.equal(
    await fault(f.c.turn(f.token, f.turn({ task_id: id() }))),
    "NOT_FOUND_OR_DENIED",
  );
  assert.equal(f.view().statistics?.requests, requests);
  assert.equal(f.view().turn, null);
});
test("a second turn while one is requested is refused as busy", async (t) => {
  const f = setup(t, "turn-hang");
  await f.c.start(f.token, f.start());
  await f.c.turn(f.token, f.turn());
  await untilAcked(f.view);
  assert.equal(await fault(f.c.turn(f.token, f.turn())), "CODEX_BUSY");
});
test("an unacknowledged native turn stays unknown and is not retried", async (t) => {
  const f = setup(t, "silent-close", { requestMs: 400 });
  await f.c.start(f.token, f.start());
  await f.c.turn(f.token, f.turn({}));
  await until(() => f.view().turn?.state === "unknown");
  const view = f.view();
  assert.equal(view.fault, "CODEX_TURN_TIMEOUT");
  assert.notEqual(view.turn?.state, "completed");
  const requests = view.statistics?.requests;
  await new Promise((r) => setTimeout(r, 80));
  assert.notEqual(f.view().turn?.state, "completed");
  assert.ok((f.view().statistics?.requests ?? 0) >= (requests ?? 0));
});
test("interrupt is acknowledged and never invents a completed turn", async (t) => {
  const f = setup(t, "turn-hang");
  await f.c.start(f.token, f.start());
  await f.c.turn(f.token, f.turn());
  await untilAcked(f.view);
  await f.interrupt();
  await until(() => f.view().turn?.state === "interrupted");
  assert.equal(f.view().turn?.state, "interrupted");
});
test("a revoked grant stops the owned process and refuses further reads", async (t) => {
  const f = setup(t, "success", { monitorMs: 25 });
  await f.c.start(f.token, f.start());
  assert.equal(f.view().state, "ready");
  f.g.state = "revoked";
  f.s.updateGrant(f.g);
  f.c.reconcileAuthorization();
  await new Promise((r) => setTimeout(r, 150));
  assert.throws(
    () => f.c.read(f.token, f.ids.project, f.binding),
    (error: unknown) => (error as ServiceFault).code === "GRANT_REVOKED",
  );
});
test("a runtime owned by another controller reads as unknown, not ready", async (t) => {
  const f = setup(t);
  await f.c.start(f.token, f.start());
  const other = new CodexRuntimeController(f.s, f.launcher, { now: f.now });
  t.after(async () => other.dispose());
  const view = other.read(f.token, f.ids.project, f.binding);
  assert.equal(view.state, "unknown");
  assert.equal(view.fault, "CODEX_OWNER_UNKNOWN");
  assert.equal(view.qualification, "UNVERIFIED");
});
test("only the fixed controller methods exist, with no generic RPC passthrough", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("packages/service/src/codex-runtime.ts", "utf8");
  for (const banned of [
    "thread/resume",
    "thread/read",
    "turn/steer",
    "command/exec",
    "shell: true",
  ])
    assert.equal(source.includes(banned), false, banned);
  for (const required of [
    "startTurn(",
    "interruptTurn(",
    "synthetic_task_get/1",
  ])
    assert.equal(source.includes(required), true, required);
});
