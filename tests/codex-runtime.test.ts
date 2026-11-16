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
import { WorkspaceService } from "../packages/service/src/workspace-service.ts";
import { ConnectionRegistry } from "../packages/service/src/connection-registry.ts";
import { ConnectionTaskAccess } from "../packages/service/src/connection-task-access.ts";
import type { Grant } from "../packages/service/src/domain.ts";
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
test("owned controller observation gates real task reads and closing cannot mutate the platform task", async (t) => {
  const f = setup(t);
  await f.c.start(f.token, f.start());
  const w = new WorkspaceService(f.s, f.now),
    registry = new ConnectionRegistry(w);
  f.s.db
    .prepare("INSERT INTO workspace_projects VALUES(?,?,?,?,?,?)")
    .run(
      f.ids.project,
      "Synthetic",
      "",
      id(),
      "1",
      new Date(f.now()).toISOString(),
    );
  f.s.db
    .prepare("INSERT INTO workspace_members VALUES(?,?,?,?,?,?,?,?)")
    .run(
      f.ids.member,
      f.ids.project,
      "codex",
      "Codex",
      "read",
      "active",
      "1",
      new Date(f.now()).toISOString(),
    );
  const owner = w.auth.pair(w.auth.newPairing().code);
  const invite = registry.invite(owner.token, owner.csrf, {
    project_id: f.ids.project,
    member_id: f.ids.member,
    action_id: id(),
    expected_member_revision: "1",
    configuration_fingerprint: f.launcher.fingerprint,
  });
  const connection = registry.redeem(invite.invitation_token, {
    connection_id: invite.connection_id,
    action_id: id(),
    configuration_fingerprint: f.launcher.fingerprint,
  });
  const observer = f.c.connectionObserver(
    f.token,
    f.ids.project,
    f.binding,
    connection.connection_id,
  );
  const manager = new ConnectionTaskAccess(w, observer);
  const grant: Grant = {
    ...f.g,
    id: id(),
    actions: ["read_resource"],
    resource_ids: [f.ids.task, f.ids.acceptance],
    expires_at: new Date(f.now() + 300000).toISOString(),
  };
  for (const rid of grant.resource_ids) {
    const r = f.s.getResource(rid)!;
    r.acl.push(grant.id);
    f.s.putResource(r);
  }
  const token = manager.issue(
    connection.connection_token,
    connection.connection_id,
    grant,
    f.ids.task,
  ).token;
  const task = f.s.getResource(f.ids.task),
    run = f.s.getRun(f.ids.run);
  const before = f.s.db.prepare("SELECT total_changes() n").get()!.n;
  for (let i = 0; i < 100; i++)
    assert.equal(
      (f.service.readResource(token, f.ids.project, "task", f.ids.task) as any)
        .data.status,
      "draft",
    );
  assert.equal(f.s.db.prepare("SELECT total_changes() n").get()!.n, before);
  assert.equal(f.view().turn, null);
  await f.close();
  assert.throws(
    () => f.service.readResource(token, f.ids.project, "task", f.ids.task),
    /NOT_FOUND_OR_DENIED/,
  );
  assert.deepEqual(f.s.getResource(f.ids.task), task);
  assert.deepEqual(f.s.getRun(f.ids.run), run);
  assert.equal(f.launched(), 1);
});

test("observation factory refuses official sources and unstarted runtimes without launching", async (t) => {
  const f = setup(t);
  assert.throws(() =>
    f.c.connectionObserver(f.token, f.ids.project, f.binding, id()),
  );
  assert.equal(f.launched(), 0);
  await f.c.start(f.token, f.start());
  Object.assign(f.launcher, { source: "official_codex" });
  assert.throws(
    () => f.c.connectionObserver(f.token, f.ids.project, f.binding, id()),
    /NOT_FOUND_OR_DENIED/,
  );
  assert.equal(f.launched(), 1);
});
test("controller connection observer checks owned native thread without starting turns or writing", async (t) => {
  const f = setup(t);
  await f.c.start(f.token, f.start());
  assert.equal(typeof (f.c as any).connectionObserver, "function");
  const connection = id();
  const observe = f.c.connectionObserver(
    f.token,
    f.ids.project,
    f.binding,
    connection,
  );
  const changes = f.s.db.prepare("SELECT total_changes() n").get()!.n;
  for (let i = 0; i < 100; i++) {
    const o = observe(connection)!;
    assert.equal(o.state, "active");
    assert.equal(o.member_id, f.ids.member);
    assert.equal(o.native_binding, f.g.native_binding);
    assert.equal(o.mode, "owned_process");
    assert.equal(o.data_class, "synthetic_only");
    assert.ok(!JSON.stringify(o).includes("synthetic-thread"));
  }
  assert.equal(observe(id()), undefined);
  assert.equal(f.s.db.prepare("SELECT total_changes() n").get()!.n, changes);
  assert.equal(f.view().turn, null);
  assert.equal(f.launched(), 1);
  await f.close();
  assert.equal(observe(connection), undefined);
});

for (const scenario of [
  "grant",
  "policy",
  "run",
  "epoch",
  "instance",
  "thread",
  "config",
  "source",
  "new_controller",
])
  test(`controller connection observation rejects ${scenario} changes`, async (t) => {
    const f = setup(t);
    await f.c.start(f.token, f.start());
    const connection = id(),
      observe = f.c.connectionObserver(
        f.token,
        f.ids.project,
        f.binding,
        connection,
      );
    if (scenario === "grant") f.s.updateGrant({ ...f.g, state: "revoked" });
    if (scenario === "policy") f.s.putPolicy({ ...f.p, active: false });
    if (scenario === "run")
      f.s.putRun({ ...f.s.getRun(f.ids.run)!, state: "unknown" });
    if (scenario === "epoch")
      f.s.putRun({ ...f.s.getRun(f.ids.run)!, epoch: "2" });
    const r = f.s.getResource<any>(f.binding)!;
    if (scenario === "instance") r.data.instance_id = id();
    if (scenario === "thread") r.data.thread_sha256 = "b".repeat(64);
    if (scenario === "config")
      r.data.configuration_fingerprint = "b".repeat(64);
    if (scenario === "source") r.data.source = "official_codex";
    if (["instance", "thread", "config", "source"].includes(scenario))
      f.s.putResource(r);
    if (scenario === "new_controller") {
      const other = new CodexRuntimeController(f.s, f.launcher, {
        now: f.now,
        monitorMs: 0,
      });
      try {
        assert.throws(() =>
          other.connectionObserver(
            f.token,
            f.ids.project,
            f.binding,
            connection,
          ),
        );
      } finally {
        await other.dispose();
      }
    } else {
      const before = f.s.db.prepare("SELECT total_changes() n").get()!.n;
      if (["grant", "policy", "epoch"].includes(scenario))
        assert.throws(() => observe(connection));
      else assert.equal(observe(connection), undefined);
      assert.equal(f.s.db.prepare("SELECT total_changes() n").get()!.n, before);
    }
  });
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
  assert.equal(view.initialize_schema, "codex-app-server/v1");
  assert.equal(view.platform_os, "windows");
  assert.equal(view.platform_family, "windows");
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

// ---- multi-turn state isolation and the unknown re-dispatch boundary ----

test("a second turn without its own terminal is never shown as completed", async (t) => {
  const f = setup(t, "second-turn-silent", { turnMs: 350 });
  await f.c.start(f.token, f.start());
  await f.c.turn(f.token, f.turn());
  await until(() => f.view().turn?.state === "completed");
  const first = f.view();
  assert.equal(first.turn?.state, "completed");
  assert.ok(first.last_agent_message);

  await f.c.turn(f.token, f.turn());
  // Its own terminal event never arrives, so it must time out into unknown.
  f.advance(400);
  await until(() => f.view().turn?.state === "unknown");
  const second = f.view();
  assert.equal(second.fault, "CODEX_TURN_UNKNOWN");
  assert.notEqual(second.turn?.state, "completed");
  assert.equal(second.last_agent_message, null);
  assert.equal(second.token_usage, null);
  assert.ok((second.turn?.generation ?? 0) > (first.turn?.generation ?? 0));
});
test("a late terminal from the previous turn cannot complete the new one", async (t) => {
  const f = setup(t, "late-first-terminal", { turnMs: 400 });
  await f.c.start(f.token, f.start());
  await f.c.turn(f.token, f.turn());
  await until(() => f.view().turn?.state === "completed");
  await f.c.turn(f.token, f.turn());
  f.advance(500);
  await until(() => f.view().turn?.state === "unknown");
  // The stale terminal event arrives just after the timeout; wait for it to be
  // counted instead of racing it.
  await until(() => (f.view().turn?.stale_terminal_notifications ?? 0) >= 1);
  const view = f.view();
  assert.equal(view.fault, "CODEX_TURN_UNKNOWN");
  assert.equal(view.last_agent_message, null);
  assert.ok(
    (view.turn?.stale_terminal_notifications ?? 0) >= 1,
    "the late terminal event was not recorded as stale",
  );
});
test("two turns keep separate generations, ids and evidence", async (t) => {
  const f = setup(t, "two-turns-ok", { turnMs: 2000 });
  await f.c.start(f.token, f.start());
  await f.c.turn(f.token, f.turn());
  await until(() => f.view().turn?.state === "completed");
  const first = f.view();
  await f.c.turn(f.token, f.turn());
  await until(() => f.view().turn?.state === "completed");
  const second = f.view();
  assert.equal(
    (second.turn?.generation ?? 0) > (first.turn?.generation ?? 0),
    true,
  );
  assert.notEqual(second.turn?.id_sha256, first.turn?.id_sha256);
  assert.notEqual(second.last_agent_message, first.last_agent_message);
  assert.match(second.last_agent_message ?? "", /cccc/);
});
test("an unknown turn blocks every new turn until the run is rebuilt", async (t) => {
  const f = setup(t, "turn-hang", { turnMs: 300 });
  await f.c.start(f.token, f.start());
  await f.c.turn(f.token, f.turn());
  f.advance(400);
  await until(() => f.view().turn?.state === "unknown");
  assert.equal(f.view().state, "ready");
  // A brand new action id, the current revision and the same runtime id are all
  // refused: the unknown native turn may still be running.
  assert.equal(
    await fault(f.c.turn(f.token, f.turn())),
    "CODEX_RECONCILIATION_REQUIRED",
  );
  assert.equal(
    await fault(f.c.turn(f.token, f.turn())),
    "CODEX_RECONCILIATION_REQUIRED",
  );
  // Reading progress is still allowed and still shows unknown, never completed.
  assert.equal(f.view().turn?.state, "unknown");
  assert.equal(f.view().state, "ready");
  // Closing is the reconciliation path: the owned process must exit for real.
  await f.close();
  const closed = f.view();
  assert.equal(closed.state, "closed");
  assert.equal(closed.exit?.exit_observed, true);
  assert.equal(closed.turn?.state, "unknown");
});
test("a rebuilt runtime after a reconciled close can run a new turn", async (t) => {
  const f = setup(t, "two-turns-ok", { requestMs: 2000, turnMs: 2000 });
  await f.c.start(f.token, f.start());
  await f.c.turn(f.token, f.turn());
  await until(() => f.view().turn?.state === "completed");
  await f.close();
  const closed = f.view();
  assert.equal(closed.state, "closed");
  assert.equal(closed.exit?.exit_observed, true);

  // A second runtime is a new owned process, not a reused unknown one.
  const second = id();
  f.p.resource_ids.push(second);
  f.g.resource_ids.push(second);
  f.s.putPolicy(f.p);
  f.s.updateGrant(f.g);
  const launcher = f.launcher;
  await f.c.start(f.token, {
    project_id: f.ids.project,
    runtime_id: second,
    scope_id: f.ids.scope,
    action_id: id(),
    expected_revision: "0",
    configuration_fingerprint: launcher.fingerprint,
  });
  const view = f.c.read(f.token, f.ids.project, second);
  assert.equal(view.state, "ready");
  assert.equal(view.turn, null);
  await f.c.turn(f.token, {
    project_id: f.ids.project,
    runtime_id: second,
    action_id: id(),
    expected_revision: view.revision,
    instruction_profile: "synthetic_task_get/1",
    task_id: f.ids.task,
  });
  await until(
    () => f.c.read(f.token, f.ids.project, second).turn?.state === "completed",
  );
  assert.equal(
    f.c.read(f.token, f.ids.project, second).turn?.state,
    "completed",
  );
});
test("a new controller instance cannot bypass an unknown turn", async (t) => {
  const f = setup(t, "turn-hang", { turnMs: 300 });
  await f.c.start(f.token, f.start());
  await f.c.turn(f.token, f.turn());
  f.advance(400);
  await until(() => f.view().turn?.state === "unknown");
  const other = new CodexRuntimeController(f.s, f.launcher, { now: f.now });
  t.after(async () => other.dispose());
  const view = other.read(f.token, f.ids.project, f.binding);
  assert.equal(view.state, "unknown");
  assert.equal(view.turn?.state, "unknown");
  // It does not own the process, so it may not dispatch either.
  assert.equal(
    await fault(
      other.turn(f.token, {
        project_id: f.ids.project,
        runtime_id: f.binding,
        action_id: id(),
        expected_revision: view.revision,
        instruction_profile: "synthetic_task_get/1",
        task_id: f.ids.task,
      }),
    ),
    "CODEX_OWNER_UNKNOWN",
  );
});
