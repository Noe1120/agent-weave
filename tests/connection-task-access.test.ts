import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.ts";
import { authenticate } from "../packages/service/src/auth.ts";
import { randomUUID } from "node:crypto";
import { WorkspaceService } from "../packages/service/src/workspace-service.ts";
import { ConnectionRegistry } from "../packages/service/src/connection-registry.ts";
import type { Grant } from "../packages/service/src/domain.ts";
import { tempWorkspace } from "./temp.ts";
import { Store } from "../packages/service/src/store.ts";

test("time advancing during a synchronous observation is not mistaken for a future timestamp", async () => {
  const f = await setup();
  try {
    const { ConnectionTaskAccess } =
      await import("../packages/service/src/connection-task-access.ts");
    const manager = new ConnectionTaskAccess(f.w, () => {
      f.advance(1);
      return { ...f.observe(), observed_at: f.now() };
    });
    const result = manager.issue(
      f.connection.connection_token,
      f.connection.connection_id,
      f.grant,
      f.ids.task,
    );
    assert.equal(
      (
        f.service.readResource(
          result.token,
          f.ids.project,
          "task",
          f.ids.task,
        ) as any
      ).data.status,
      "draft",
    );
  } finally {
    f.close();
  }
});

test("owner reinvite fences the old task grant without starting or granting a new task", async () => {
  const f = await setup();
  try {
    const old = f.issue(),
      task = f.s.getResource(f.ids.task),
      run = f.s.getRun(f.ids.run);
    const replacement = f.registry.reinvite(f.owner.token, f.owner.csrf, {
      project_id: f.ids.project,
      connection_id: f.connection.connection_id,
      expected_revision: "2",
      expected_member_revision: "1",
      configuration_fingerprint: "a".repeat(64),
      action_id: randomUUID(),
    });
    assert.throws(
      () =>
        f.service.readResource(old.token, f.ids.project, "task", f.ids.task),
      /NOT_FOUND_OR_DENIED/,
    );
    const next = f.registry.redeem(replacement.invitation_token, {
      connection_id: replacement.connection_id,
      action_id: randomUUID(),
      configuration_fingerprint: "a".repeat(64),
    });
    assert.throws(
      () =>
        f.service.readResource(
          next.connection_token,
          f.ids.project,
          "task",
          f.ids.task,
        ),
      /UNAUTHENTICATED/,
    );
    assert.deepEqual(f.s.getResource(f.ids.task), task);
    assert.deepEqual(f.s.getRun(f.ids.run), run);
  } finally {
    f.close();
  }
});

test("removing connection metadata cannot downgrade an already guarded grant", async () => {
  const f = await setup();
  try {
    const result = f.issue();
    const { connection_constraint, ...unbound } = f.s.getGrant(f.grant.id)!;
    assert.ok(connection_constraint);
    f.s.updateGrant(unbound);
    assert.throws(
      () =>
        authenticate(
          f.s,
          result.token,
          f.ids.project,
          "read_resource",
          f.now(),
        ),
      /GRANT_REVOKED/,
    );
    assert.throws(
      () =>
        authenticate(
          f.s,
          result.token,
          f.ids.project,
          "read_resource",
          f.now(),
        ),
      /GRANT_REVOKED/,
    );
  } finally {
    f.close();
  }
});

test("observer faults remain visible and permanently fence the grant", async () => {
  const f = await setup();
  try {
    const { ConnectionTaskAccess } =
      await import("../packages/service/src/connection-task-access.ts");
    let broken = false;
    const manager = new ConnectionTaskAccess(f.w, () => {
      if (broken) throw new Error("SYNTHETIC_OBSERVER_FAULT");
      return f.observe();
    });
    const result = manager.issue(
      f.connection.connection_token,
      f.connection.connection_id,
      f.grant,
      f.ids.task,
    );
    broken = true;
    assert.throws(
      () =>
        authenticate(
          f.s,
          result.token,
          f.ids.project,
          "read_resource",
          f.now(),
        ),
      /SYNTHETIC_OBSERVER_FAULT/,
    );
    broken = false;
    assert.throws(
      () =>
        authenticate(
          f.s,
          result.token,
          f.ids.project,
          "read_resource",
          f.now(),
        ),
      /GRANT_REVOKED/,
    );
  } finally {
    f.close();
  }
});

test("a grant cannot outlive registration even with a fresh trusted observation", async () => {
  const f = await setup();
  try {
    f.advance(8 * 3600000 - 60000);
    f.observe().observed_at = f.now();
    f.grant.expires_at = new Date(f.now() + 60001).toISOString();
    assert.throws(f.issue, /NOT_FOUND_OR_DENIED/);
    f.grant.expires_at = new Date(f.now() + 60000).toISOString();
    const result = f.issue();
    f.advance(60000);
    f.observe().observed_at = f.now();
    assert.throws(
      () =>
        authenticate(
          f.s,
          result.token,
          f.ids.project,
          "read_resource",
          f.now(),
        ),
      /GRANT_REVOKED/,
    );
  } finally {
    f.close();
  }
});

test("task reference changes recheck dependency visibility and never silently widen the grant", async () => {
  const f = await setup();
  try {
    const result = f.issue();
    const task = f.s.getResource<any>(f.ids.task)!;
    task.data.candidate_ref = { id: f.ids.candidate, revision: "1" };
    f.s.putResource(task);
    assert.throws(
      () =>
        f.service.readResource(result.token, f.ids.project, "task", f.ids.task),
      /NOT_FOUND_OR_DENIED/,
    );
    assert.throws(f.issue, /NOT_FOUND_OR_DENIED/);
  } finally {
    f.close();
  }
});

async function setup(filename = ":memory:") {
  const f = fixture(filename),
    w = new WorkspaceService(f.s, f.now);
  f.s.db
    .prepare("INSERT INTO workspace_projects VALUES(?,?,?,?,?,?)")
    .run(
      f.ids.project,
      "Synthetic",
      "",
      randomUUID(),
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
  const owner = w.auth.pair(w.auth.newPairing().code),
    registry = new ConnectionRegistry(w);
  const invite = registry.invite(owner.token, owner.csrf, {
    project_id: f.ids.project,
    member_id: f.ids.member,
    action_id: randomUUID(),
    expected_member_revision: "1",
    configuration_fingerprint: "a".repeat(64),
  });
  const connection = registry.redeem(invite.invitation_token, {
    connection_id: invite.connection_id,
    action_id: randomUUID(),
    configuration_fingerprint: "a".repeat(64),
  });
  const grant: Grant = {
    ...f.g,
    id: randomUUID(),
    actions: ["read_resource"],
    resource_ids: [f.ids.task, f.ids.acceptance],
    expires_at: new Date(f.now() + 300000).toISOString(),
  };
  for (const id of grant.resource_ids) {
    const r = f.s.getResource(id)!;
    r.acl.push(grant.id);
    f.s.putResource(r);
  }
  let observation: any = {
    connection_id: connection.connection_id,
    project_id: f.ids.project,
    member_id: f.ids.member,
    target: "codex",
    configuration_fingerprint: "a".repeat(64),
    run_id: grant.run_id,
    run_epoch: "1",
    native_binding: grant.native_binding,
    mode: "owned_process",
    data_class: "synthetic_only",
    state: "active",
    observed_at: f.now(),
  };
  // Dynamic loading keeps the first red assertion about behavior, not a missing static import.
  const module =
    await import("../packages/service/src/connection-task-access.ts");
  const access = new module.ConnectionTaskAccess(w, () => observation);
  return {
    ...f,
    w,
    owner,
    registry,
    connection,
    grant,
    access,
    issue: () =>
      access.issue(
        connection.connection_token,
        connection.connection_id,
        grant,
        f.ids.task,
      ),
    observe: () => observation,
    setObservation: (v: any) => {
      observation = v;
    },
  };
}

test("a connection-constrained grant without a live verifier must fail closed", () => {
  const f = fixture();
  try {
    const g = f.s.getGrant(f.ids.grant)!;
    f.s.updateGrant({
      ...g,
      connection_constraint: { connection_id: f.ids.input },
    } as typeof g);
    assert.throws(
      () => authenticate(f.s, f.token, f.ids.project, "read_resource", f.now()),
      /GRANT_REVOKED/,
    );
  } finally {
    f.close();
  }
});

test("trusted issue reads only one task, retries without writes and keeps credentials separate", async () => {
  const f = await setup();
  try {
    const result = f.issue();
    const before = f.s.db.prepare("SELECT total_changes() n").get()!.n;
    assert.deepEqual(f.issue(), result);
    for (let i = 0; i < 100; i++) {
      const r = f.service.readResource(
        result.token,
        f.ids.project,
        "task",
        f.ids.task,
      ) as any;
      assert.equal(r.data.status, "draft");
      assert.equal(r.ref.id, f.ids.task);
    }
    assert.equal(f.s.db.prepare("SELECT total_changes() n").get()!.n, before);
    assert.throws(
      () =>
        f.service.readResource(
          result.token,
          f.ids.project,
          "task",
          f.ids.scope,
        ),
      /NOT_FOUND_OR_DENIED/,
    );
    assert.throws(
      () =>
        authenticate(
          f.s,
          result.token,
          f.ids.project,
          "runtime_control",
          f.now(),
        ),
      /NOT_FOUND_OR_DENIED/,
    );
    assert.throws(
      () => f.registry.read(result.token, f.connection.connection_id),
      /CONNECTION_CREDENTIAL_INVALID/,
    );
    assert.throws(
      () =>
        f.service.readResource(
          f.connection.connection_token,
          f.ids.project,
          "task",
          f.ids.task,
        ),
      /UNAUTHENTICATED/,
    );
    assert.ok(
      !JSON.stringify(f.s.db.prepare("SELECT * FROM grants").all()).includes(
        result.token,
      ),
    );
  } finally {
    f.close();
  }
});

for (const scenario of [
  "write",
  "extra_resource",
  "missing_dependency",
  "long_lifetime",
  "expired",
  "wrong_member",
  "unknown_run",
  "acl",
  "policy",
  "second_task",
  "private",
  "attached",
  "wrong_config",
  "missing_observation",
])
  test(`issue rejects ${scenario} without persisting a grant`, async () => {
    const f = await setup();
    try {
      if (scenario === "write") f.grant.actions.push("runtime_control");
      if (scenario === "extra_resource") f.grant.resource_ids.push(f.ids.scope);
      if (scenario === "missing_dependency") f.grant.resource_ids.pop();
      if (scenario === "long_lifetime")
        f.grant.expires_at = new Date(f.now() + 300001).toISOString();
      if (scenario === "expired")
        f.grant.expires_at = new Date(f.now()).toISOString();
      if (scenario === "wrong_member") f.grant.member_id = randomUUID();
      if (scenario === "unknown_run")
        f.s.putRun({ ...f.s.getRun(f.ids.run)!, state: "unknown" });
      if (scenario === "acl") {
        const r = f.s.getResource(f.ids.task)!;
        r.acl = [];
        f.s.putResource(r);
      }
      if (scenario === "policy") f.s.putPolicy({ ...f.p, active: false });
      if (scenario === "second_task") {
        const r = f.s.getResource(f.ids.task)!;
        const other = randomUUID();
        f.s.putResource({ ...r, id: other });
        r.dependencies.push(other);
        f.s.putResource(r);
        f.grant.resource_ids.push(other);
        f.s.putPolicy({ ...f.p, resource_ids: [...f.p.resource_ids, other] });
      }
      if (scenario === "private") f.observe().data_class = "private";
      if (scenario === "attached") f.observe().mode = "attached_session";
      if (scenario === "wrong_config")
        f.observe().configuration_fingerprint = "b".repeat(64);
      if (scenario === "missing_observation") f.setObservation(undefined);
      assert.throws(f.issue);
      assert.equal(f.s.getGrant(f.grant.id), undefined);
    } finally {
      f.close();
    }
  });

test("persisted grant cannot regain access after Store restart or new manager construction", async () => {
  const temp = tempWorkspace(),
    f = await setup(temp.db);
  let reopened: Store | undefined;
  try {
    const result = f.issue();
    f.close();
    reopened = new Store(temp.db);
    const { ConnectionTaskAccess } =
      await import("../packages/service/src/connection-task-access.ts");
    const manager = new ConnectionTaskAccess(
      new WorkspaceService(reopened, f.now),
      f.observe,
    );
    assert.throws(
      () =>
        authenticate(
          reopened!,
          result.token,
          f.ids.project,
          "read_resource",
          f.now(),
        ),
      /GRANT_REVOKED/,
    );
    assert.throws(() =>
      manager.issue(
        f.connection.connection_token,
        f.connection.connection_id,
        f.grant,
        f.ids.task,
      ),
    );
  } finally {
    reopened?.close();
    temp.dispose();
  }
});

test("observed disconnect fences the grant permanently even when the same session returns", async () => {
  const f = await setup();
  try {
    const result = f.issue(),
      original = f.observe();
    f.setObservation(undefined);
    assert.throws(
      () =>
        authenticate(
          f.s,
          result.token,
          f.ids.project,
          "read_resource",
          f.now(),
        ),
      /GRANT_REVOKED/,
    );
    f.setObservation(original);
    assert.throws(
      () =>
        authenticate(
          f.s,
          result.token,
          f.ids.project,
          "read_resource",
          f.now(),
        ),
      /GRANT_REVOKED/,
    );
    assert.throws(f.issue, /GRANT_REVOKED/);
  } finally {
    f.close();
  }
});

test("retry payload conflict and persisted grant tampering cannot expand or recreate access", async () => {
  const f = await setup();
  try {
    const result = f.issue();
    f.grant.native_binding = "changed";
    assert.throws(f.issue, /NOT_FOUND_OR_DENIED/);
    const original = f.s.getGrant(f.grant.id)!;
    f.s.updateGrant({
      ...original,
      actions: ["read_resource", "runtime_control"],
    });
    assert.throws(
      () =>
        authenticate(
          f.s,
          result.token,
          f.ids.project,
          "read_resource",
          f.now(),
        ),
      /GRANT_REVOKED/,
    );
    f.s.updateGrant(original);
    assert.throws(
      () =>
        authenticate(
          f.s,
          result.token,
          f.ids.project,
          "read_resource",
          f.now(),
        ),
      /GRANT_REVOKED/,
    );
  } finally {
    f.close();
  }
});

for (const scenario of [
  "revoked",
  "expiry",
  "member",
  "key",
  "offline",
  "stale",
  "future",
  "epoch",
  "native",
  "target",
  "project",
  "member_observation",
  "connection",
  "config",
  "run_unknown",
  "run_epoch",
  "policy",
  "acl",
])
  test(`existing task token is denied after ${scenario}; task and run remain unchanged by reads`, async () => {
    const f = await setup();
    try {
      const result = f.issue();
      if (scenario === "revoked")
        f.registry.revoke(f.owner.token, f.owner.csrf, {
          project_id: f.ids.project,
          connection_id: f.connection.connection_id,
          action_id: randomUUID(),
          expected_revision: "2",
        });
      if (scenario === "expiry") f.advance(300000);
      if (scenario === "member")
        f.s.db
          .prepare("UPDATE workspace_members SET revision='2' WHERE id=?")
          .run(f.ids.member);
      if (scenario === "key")
        f.s.db
          .prepare("UPDATE console_secrets SET value=?")
          .run("b".repeat(64));
      if (scenario === "offline") f.setObservation(undefined);
      if (scenario === "stale") f.advance(30001);
      if (scenario === "future") f.observe().observed_at = f.now() + 1;
      if (scenario === "epoch") f.observe().run_epoch = "2";
      if (scenario === "native") f.observe().native_binding = "other";
      if (scenario === "target") f.observe().target = "claude_desktop";
      if (scenario === "project") f.observe().project_id = randomUUID();
      if (scenario === "member_observation")
        f.observe().member_id = randomUUID();
      if (scenario === "connection") f.observe().connection_id = randomUUID();
      if (scenario === "config")
        f.observe().configuration_fingerprint = "b".repeat(64);
      if (scenario === "run_unknown")
        f.s.putRun({ ...f.s.getRun(f.ids.run)!, state: "unknown" });
      if (scenario === "run_epoch")
        f.s.putRun({ ...f.s.getRun(f.ids.run)!, epoch: "2" });
      if (scenario === "policy") f.s.putPolicy({ ...f.p, active: false });
      if (scenario === "acl") {
        const r = f.s.getResource(f.ids.acceptance)!;
        r.acl = [];
        f.s.putResource(r);
      }
      const changes = f.s.db.prepare("SELECT total_changes() n").get()!.n;
      const task = f.s.getResource(f.ids.task),
        run = f.s.getRun(f.ids.run);
      assert.throws(
        () =>
          f.service.readResource(
            result.token,
            f.ids.project,
            "task",
            f.ids.task,
          ),
        /NOT_FOUND_OR_DENIED/,
      );
      assert.equal(
        f.s.db.prepare("SELECT total_changes() n").get()!.n,
        changes,
      );
      assert.deepEqual(f.s.getResource(f.ids.task), task);
      assert.deepEqual(f.s.getRun(f.ids.run), run);
    } finally {
      f.close();
    }
  });
