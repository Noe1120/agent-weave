import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { adapterFixture } from "./adapter-helpers.ts";
import { id } from "./helpers.ts";
import {
  InitializeOnlyAcp,
  type DshLauncher,
  type AcpHandle,
} from "../packages/service/src/dsh-acp.ts";
import { DshRuntimeController } from "../packages/service/src/dsh-runtime.ts";
function setup(t: TestContext, mode = "success", monitorMs = 0) {
  const f = adapterFixture();
  let launched = 0;
  const handles: AcpHandle[] = [];
  const children: ChildProcessWithoutNullStreams[] = [];
  const launcher: DshLauncher = {
    fingerprint: "a".repeat(64),
    clientVersion: "fixture-1",
    source: "development_fixture",
    async launch(allowed) {
      if (!allowed()) throw new Error("unauthorized");
      launched++;
      const child = spawn(
        process.execPath,
        [resolve("tests/fixtures/dsh-acp-fixture.mjs"), mode],
        { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
      );
      children.push(child);
      const h = new InitializeOnlyAcp(child, {
        initializeMs: 5000,
        closeMs: 1500,
      });
      handles.push(h);
      return h;
    },
  };
  const c = new DshRuntimeController(f.s, launcher, {
    now: f.now,
    monitorMs,
  });
  t.after(async () => {
    await c.dispose();
    f.s.db.close();
  });
  const request = (patch = {}) => ({
    project_id: f.ids.project,
    runtime_id: f.binding,
    scope_id: f.ids.scope,
    action_id: id(),
    expected_revision: "0",
    configuration_fingerprint: launcher.fingerprint,
    ...patch,
  });
  const close = () =>
    c.close(f.token, {
      project_id: f.ids.project,
      runtime_id: f.binding,
      action_id: id(),
      expected_revision: c.read(f.token, f.ids.project, f.binding).revision,
    });
  return {
    ...f,
    c,
    launcher,
    request,
    close,
    handles,
    children,
    launched: () => launched,
  };
}
test("authorized runtime initialized and projected without fake session or enabled execution", async (t) => {
  const f = setup(t);
  const run = f.s.getRun(f.ids.run);
  const r = f.request();
  const first = await f.c.start(f.token, r);
  assert.equal(first.operation_status, "accepted");
  assert.equal(f.launched(), 1);
  const view = f.c.read(f.token, f.ids.project, f.binding);
  assert.equal(view.state, "ready");
  assert.equal(view.session_id, null);
  assert.equal(view.qualification, "UNVERIFIED");
  assert.equal(view.binding_mode, "owned_process");
  assert.equal(view.observation_source, "development_fixture");
  assert.equal(view.advertised?.session_resume, true);
  assert.ok(Object.values(view.capabilities).every((v) => !v.enabled));
  const changes = f.s.db.prepare("SELECT total_changes() AS n").get()!.n;
  for (let i = 0; i < 100; i++) f.c.read(f.token, f.ids.project, f.binding);
  assert.equal(f.s.db.prepare("SELECT total_changes() AS n").get()!.n, changes);
  assert.equal(f.launched(), 1);
  assert.deepEqual(await f.c.start(f.token, r), first);
  assert.equal(f.launched(), 1);
  await f.close();
  assert.equal(f.c.read(f.token, f.ids.project, f.binding).state, "closed");
  assert.deepEqual(await f.c.start(f.token, r), first);
  assert.equal(f.launched(), 1);
  assert.deepEqual(f.s.getRun(f.ids.run), run);
});
for (const bad of [
  "revoked",
  "policy",
  "scope",
  "runtime",
  "fingerprint",
  "command",
  "unknown-run",
])
  test("no process starts when " + bad, async (t) => {
    const f = setup(t);
    const r = f.request();
    if (bad === "revoked") {
      f.g.state = "revoked";
      f.s.updateGrant(f.g);
    }
    if (bad === "policy") {
      f.p.active = false;
      f.s.putPolicy(f.p);
    }
    if (bad === "scope") {
      f.g.resource_ids = f.g.resource_ids.filter((x) => x !== f.ids.scope);
      f.s.updateGrant(f.g);
    }
    if (bad === "runtime") {
      f.p.resource_ids = f.p.resource_ids.filter((x) => x !== f.binding);
      f.s.putPolicy(f.p);
    }
    if (bad === "fingerprint") r.configuration_fingerprint = "b".repeat(64);
    if (bad === "command") Object.assign(r, { command: "cmd.exe" });
    if (bad === "unknown-run")
      f.s.putRun({ ...f.s.getRun(f.ids.run)!, state: "unknown" });
    await assert.rejects(f.c.start(f.token, r));
    assert.equal(f.launched(), 0);
    assert.equal(f.s.getResource(f.binding), undefined);
  });
test("action collision, reused runtime and stale close reject without lifecycle side effects", async (t) => {
  const f = setup(t);
  const r = f.request();
  await f.c.start(f.token, r);
  await assert.rejects(f.c.start(f.token, { ...r, expected_revision: "1" }));
  await assert.rejects(f.c.start(f.token, { ...r, action_id: id() }));
  await assert.rejects(
    f.c.close(f.token, {
      project_id: f.ids.project,
      runtime_id: f.binding,
      action_id: id(),
      expected_revision: "0",
    }),
  );
  assert.equal(f.c.read(f.token, f.ids.project, f.binding).state, "ready");
  assert.equal(f.launched(), 1);
});
test("crash after ready changes stored state and never restarts or finishes the platform run", async (t) => {
  const f = setup(t, "crash");
  const run = f.s.getRun(f.ids.run);
  await f.c.start(f.token, f.request());
  await f.handles[0]!.closed;
  await new Promise((r) => setImmediate(r));
  const view = f.c.read(f.token, f.ids.project, f.binding);
  assert.equal(view.state, "failed");
  assert.equal(view.fault, "DSH_EXIT");
  assert.equal(f.launched(), 1);
  assert.deepEqual(f.s.getRun(f.ids.run), run);
});
test("revocation closes only owned initialize transport; reads/replay denied", async (t) => {
  const f = setup(t);
  const r = f.request();
  await f.c.start(f.token, r);
  f.g.state = "revoked";
  f.s.updateGrant(f.g);
  f.c.reconcileAuthorization();
  await f.handles[0]!.closed;
  await new Promise((r) => setImmediate(r));
  assert.throws(() => f.c.read(f.token, f.ids.project, f.binding));
  await assert.rejects(f.c.start(f.token, r));
  assert.equal(f.s.getResource<any>(f.binding)!.data.state, "closed");
  assert.equal(f.launched(), 1);
});
test("revocation during handshake cannot promote a late initialize response", async (t) => {
  const f = setup(t, "delayed");
  const pending = f.c.start(f.token, f.request());
  await new Promise((r) => setTimeout(r, 20));
  f.g.state = "revoked";
  f.s.updateGrant(f.g);
  await pending;
  await f.handles[0]!.closed;
  await new Promise((r) => setImmediate(r));
  assert.notEqual(f.s.getResource<any>(f.binding)!.data.state, "ready");
  assert.equal(f.launched(), 1);
});
test("new controller marks an old active runtime unknown without DB writes or touching its process", async (t) => {
  const f = setup(t);
  await f.c.start(f.token, f.request());
  const other = new DshRuntimeController(f.s, f.launcher, {
    now: f.now,
    monitorMs: 0,
  });
  t.after(() => other.dispose());
  const changes = f.s.db.prepare("SELECT total_changes() AS n").get()!.n;
  assert.equal(other.read(f.token, f.ids.project, f.binding).state, "unknown");
  assert.equal(f.s.db.prepare("SELECT total_changes() AS n").get()!.n, changes);
  await assert.rejects(
    other.close(f.token, {
      project_id: f.ids.project,
      runtime_id: f.binding,
      action_id: id(),
      expected_revision: "2",
    }),
  );
  assert.equal(f.c.read(f.token, f.ids.project, f.binding).state, "ready");
});
test("runtime ACL hides both absence and protected records", async (t) => {
  const f = setup(t);
  await f.c.start(f.token, f.request());
  f.g.resource_ids = f.g.resource_ids.filter((x) => x !== f.binding);
  f.s.updateGrant(f.g);
  for (const target of [f.binding, id()])
    assert.throws(
      () => f.c.read(f.token, f.ids.project, target),
      (e) => (e as Error).message === "NOT_FOUND_OR_DENIED",
    );
});
test("closed runtime has no native session; unsupported operations cannot be called", async (t) => {
  const f = setup(t);
  await f.c.start(f.token, f.request());
  await f.close();
  assert.equal("prompt" in f.c, false);
  assert.equal("interrupt" in f.c, false);
  assert.equal("detach" in f.c, false);
  assert.equal(
    f.c.read(f.token, f.ids.project, f.binding).execution_stop_proven,
    false,
  );
});

test("close replay is inert and still rechecks authorization", async (t) => {
  const f = setup(t);
  await f.c.start(f.token, f.request());
  const r = {
    project_id: f.ids.project,
    runtime_id: f.binding,
    action_id: id(),
    expected_revision: f.c.read(f.token, f.ids.project, f.binding).revision,
  };
  const accepted = await f.c.close(f.token, r);
  const changes = f.s.db.prepare("SELECT total_changes() AS n").get()!.n;
  assert.deepEqual(await f.c.close(f.token, r), accepted);
  assert.equal(f.s.db.prepare("SELECT total_changes() AS n").get()!.n, changes);
  f.g.state = "revoked";
  f.s.updateGrant(f.g);
  await assert.rejects(f.c.close(f.token, r));
});
test("grant changes during async preparation prevent any process launch", async (t) => {
  const f = adapterFixture();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let spawned = 0;
  const launcher: DshLauncher = {
    fingerprint: "a".repeat(64),
    clientVersion: "fixture",
    source: "development_fixture",
    async launch(allowed) {
      await gate;
      if (!allowed()) throw new Error("authorization changed");
      spawned++;
      throw new Error("must not spawn");
    },
  };
  const c = new DshRuntimeController(f.s, launcher, {
    now: f.now,
    monitorMs: 0,
  });
  t.after(async () => {
    release();
    await c.dispose();
    f.s.db.close();
  });
  const pending = c.start(f.token, {
    project_id: f.ids.project,
    runtime_id: f.binding,
    scope_id: f.ids.scope,
    action_id: id(),
    expected_revision: "0",
    configuration_fingerprint: launcher.fingerprint,
  });
  f.g.state = "revoked";
  f.s.updateGrant(f.g);
  release();
  await pending;
  assert.equal(spawned, 0);
  assert.notEqual(f.s.getResource<any>(f.binding)!.data.state, "ready");
});
test("persistence failure closes transport and read cannot reuse stale ready/starting state", async (t) => {
  const f = setup(t);
  const put = f.s.putResource.bind(f.s);
  f.s.putResource = (r) => {
    if (r.kind === "adapter_runtime" && (r.data as any).state === "ready")
      throw new Error("disk failure");
    put(r);
  };
  await f.c.start(f.token, f.request());
  await f.handles[0]!.closed;
  await new Promise((r) => setImmediate(r));
  const view = f.c.read(f.token, f.ids.project, f.binding);
  assert.equal(view.state, "unknown");
  assert.equal(view.fault, "DSH_PERSISTENCE");
});
test("uncertain platform run is visible as unknown without read-side writes", async (t) => {
  const f = setup(t);
  await f.c.start(f.token, f.request());
  f.s.putRun({ ...f.s.getRun(f.ids.run)!, state: "unknown" });
  const changes = f.s.db.prepare("SELECT total_changes() AS n").get()!.n;
  assert.equal(f.c.read(f.token, f.ids.project, f.binding).state, "unknown");
  assert.equal(f.s.db.prepare("SELECT total_changes() AS n").get()!.n, changes);
});

test("invalid second frame must not publish ready while the child is still closing", async (t) => {
  const f = setup(t, "duplicate-hang");
  await f.c.start(f.token, f.request());
  const view = f.c.read(f.token, f.ids.project, f.binding);
  assert.notEqual(view.state, "ready");
  assert.equal(view.fault, "DSH_PROTOCOL");
  assert.equal(view.execution_stop_proven, false);
});

test("progress immediately reflects a later protocol fault without writing the database", async (t) => {
  const f = setup(t, "late-duplicate-hang");
  await f.c.start(f.token, f.request());
  assert.equal(f.c.read(f.token, f.ids.project, f.binding).state, "ready");
  const child = f.children[0];
  assert.ok(child);
  await once(child.stdout, "data", {
    signal: AbortSignal.timeout(5000),
  });
  const changes = f.s.db.prepare("SELECT total_changes() AS n").get()!.n;
  const view = f.c.read(f.token, f.ids.project, f.binding);
  assert.equal(view.state, "unknown");
  assert.equal(view.fault, "DSH_PROTOCOL");
  assert.equal(f.s.db.prepare("SELECT total_changes() AS n").get()!.n, changes);
});

test("closed response pipe is not ready even if the owned process has not exited", async (t) => {
  const f = setup(t, "hang");
  await f.c.start(f.token, f.request());
  assert.equal(f.c.read(f.token, f.ids.project, f.binding).state, "ready");
  // Inject the pipe EOF event; Windows Node stdio keeps duplicate OS handles.
  const child = f.children[0];
  assert.ok(child);
  child.stdout.emit("end");
  const view = f.c.read(f.token, f.ids.project, f.binding);
  assert.equal(view.state, "unknown");
  assert.equal(view.fault, "DSH_DISCONNECTED");
  assert.equal(view.execution_stop_proven, false);
});

test("authorization monitoring closes a revoked runtime without any progress read", async (t) => {
  const f = setup(t, "success", 10);
  await f.c.start(f.token, f.request());
  const child = f.children[0];
  assert.ok(child);
  f.g.state = "revoked";
  f.s.updateGrant(f.g);
  await once(child, "close", { signal: AbortSignal.timeout(5000) });
  const row = f.s.getResource<{ state: string; fault: string }>(f.binding);
  assert.equal(row?.data.state, "closed");
  assert.equal(row?.data.fault, "DSH_AUTHORIZATION_CHANGED");
  assert.equal(f.launched(), 1);
});
