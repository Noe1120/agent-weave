import assert from "node:assert/strict";
import { test } from "node:test";
import { dependencyFixture, provision } from "./dependency-helpers.ts";
import { brokerFixture } from "./broker-helpers.ts";
import { id, ref } from "./helpers.ts";
import { authenticate } from "../packages/service/src/auth.ts";
import { assertTaskInputsCurrent } from "../packages/service/src/dependencies.ts";
test("input snapshot captures complete versioned closure, retries atomically", () => {
  const f = dependencyFixture();
  try {
    const q = f.request();
    const result = f.dependencies.capture(f.token, q);
    assert.equal(result.revision, "1");
    assert.deepEqual(f.dependencies.capture(f.token, q), result);
    const view = f.dependencies.read(f.token, f.ids.project, f.snapshot);
    assert.equal(view.validity, "valid");
    assert.equal(view.entries.length, 2);
    assert.deepEqual(
      new Set(view.entries.map((e) => e.ref.id)),
      new Set([f.base, f.upstream]),
    );
    assert.equal(f.s.getResource(f.ids.task)!.revision, "2");
    assert.throws(
      () => f.dependencies.capture(f.token, { ...q, inputs: [ref(f.base)] }),
      /ACTION_CONFLICT/,
    );
  } finally {
    f.close();
  }
});
for (const kind of [
  "cycle",
  "stale",
  "unapproved",
  "missing_commit",
  "hidden",
  "wrong_project",
  "scope",
  "extra",
  "active",
] as const)
  test("capture rejects " + kind, () => {
    const f = dependencyFixture();
    try {
      const q = f.request();
      const r = f.s.getResource(f.base)!;
      if (kind === "cycle") {
        r.data.upstream_refs = [ref(f.upstream)];
        r.dependencies = [f.upstream];
      }
      if (kind === "stale") r.revision = "2";
      if (kind === "unapproved") r.data.review_state = "pending";
      if (kind === "missing_commit") delete r.data.source_commit;
      if (kind === "hidden") r.acl = [];
      if (kind === "wrong_project") q.project_id = id();
      if (kind === "scope") q.snapshot_id = id();
      if (kind === "extra") Object.assign(q, { approved: true });
      if (kind === "active") {
        const t = f.s.getResource(f.ids.task)!;
        t.data.status = "running";
        f.s.putResource(t);
      }
      f.s.putResource(r);
      assert.throws(
        () => f.dependencies.capture(f.token, q),
        /DEPENDENCY_|NOT_FOUND_OR_DENIED|PLAN_STALE/,
      );
      assert.equal(f.s.getResource(f.snapshot), undefined);
      assert.equal(f.s.getResource(f.ids.task)!.revision, "1");
    } finally {
      f.close();
    }
  });
test("upstream invalidation propagates read-only; stale never silently revalidates", () => {
  const f = dependencyFixture();
  try {
    f.dependencies.capture(f.token, f.request());
    const r = f.s.getResource(f.base)!;
    r.revision = "2";
    r.data.validity = "rejected";
    f.s.putResource(r);
    const before = f.s.db.prepare("SELECT total_changes() n").get()!.n;
    for (let i = 0; i < 100; i++)
      assert.equal(
        f.dependencies.read(f.token, f.ids.project, f.snapshot).validity,
        "stale",
      );
    assert.equal(f.s.db.prepare("SELECT total_changes() n").get()!.n, before);
    const ctx = authenticate(
      f.s,
      f.token,
      f.ids.project,
      "dependency_read",
      f.now(),
    );
    assert.throws(
      () => assertTaskInputsCurrent(f.s, ctx, f.ids.task),
      /PLAN_STALE/,
    );
    f.g.state = "revoked";
    f.s.updateGrant(f.g);
    assert.throws(
      () => f.dependencies.read(f.token, f.ids.project, f.snapshot),
      /GRANT_REVOKED/,
    );
  } finally {
    f.close();
  }
});
test("source task self-dependency and duplicate inputs fail", () => {
  const f = dependencyFixture();
  try {
    const r = f.s.getResource(f.upstream)!;
    r.data.producer_task_id = f.ids.task;
    f.s.putResource(r);
    assert.throws(
      () => f.dependencies.capture(f.token, f.request()),
      /DEPENDENCY_CYCLE/,
    );
    assert.throws(
      () =>
        f.dependencies.capture(f.token, {
          ...f.request(),
          inputs: [ref(f.base), ref(f.base)],
        }),
      /DEPENDENCY_CONTRACT/,
    );
  } finally {
    f.close();
  }
});
test("Broker rechecks snapshot before patch and finish, retains quarantined locks", () => {
  const b = brokerFixture();
  const f = dependencyFixture(b);
  try {
    f.dependencies.capture(f.token, f.request());
    const claim = b.broker.claim(f.token, {
      ...b.request,
      expected_task_revision: "2",
    });
    const upstream = f.s.getResource(f.base)!;
    upstream.revision = "2";
    f.s.putResource(upstream);
    assert.throws(
      () =>
        b.broker.write(f.token, {
          project_id: f.ids.project,
          claim_id: claim.id,
          action_id: id(),
          edits: [
            {
              path: "src/main.txt",
              before_digest: null,
              text: "must not write",
            },
          ],
        }),
      /PLAN_STALE/,
    );
    assert.throws(
      () => b.broker.finish(f.token, f.ids.project, claim.id),
      /PLAN_STALE/,
    );
    b.broker.reconcileLiveness();
    assert.equal(
      f.s.db
        .prepare("SELECT state FROM broker_claims WHERE id=?")
        .get(claim.id)!.state,
      "quarantined",
    );
    assert.notEqual(
      f.s.db.prepare("SELECT COUNT(*) n FROM broker_locks").get()!.n,
      0,
    );
    assert.equal(f.s.getResource(f.ids.task)!.data.status, "running");
  } finally {
    b.dispose();
  }
});
test("snapshot revision mismatch fails even when upstream unchanged", () => {
  const f = dependencyFixture();
  try {
    f.dependencies.capture(f.token, f.request());
    const snapshot = f.s.getResource(f.snapshot)!;
    snapshot.revision = "2";
    f.s.putResource(snapshot);
    const ctx = authenticate(
      f.s,
      f.token,
      f.ids.project,
      "dependency_read",
      f.now(),
    );
    assert.throws(
      () => assertTaskInputsCurrent(f.s, ctx, f.ids.task),
      /PLAN_STALE/,
    );
  } finally {
    f.close();
  }
});

test("a ready wait cannot resolve from a stale input snapshot", () => {
  const f = dependencyFixture();
  try {
    f.dependencies.capture(f.token, f.request());
    const r = f.s.getResource(f.base)!;
    r.revision = "2";
    f.s.putResource(r);
    const t = f.s.getResource(f.ids.task)!;
    t.data.status = "in_review";
    t.data.candidate_ref = ref(f.ids.candidate);
    f.s.putResource(t);
    const result = f.service.execute(f.token, {
      ...f.register(),
      predicate: "task_review_ready",
    });
    assert.equal(result.kind, "service_result", JSON.stringify(result));
    if (result.kind === "service_result")
      assert.equal((result.data as { state: string }).state, "registered");
  } finally {
    f.close();
  }
});

test("omitted upstream metadata cannot bypass a changeset dependency", () => {
  const f = dependencyFixture();
  try {
    const r = f.s.getResource(f.upstream)!;
    delete r.data.upstream_refs;
    f.s.putResource(r);
    assert.throws(
      () => f.dependencies.capture(f.token, f.request()),
      /DEPENDENCY_CONTRACT/,
    );
  } finally {
    f.close();
  }
});

test("task prerequisites are acyclic, scoped and CAS/idempotent", () => {
  const f = dependencyFixture();
  try {
    const other = id();
    provision(f, [other], []);
    f.s.putResource({ ...f.s.getResource(f.ids.task)!, id: other });
    const q = {
      project_id: f.ids.project,
      action_id: id(),
      task_ref: ref(f.ids.task),
      prerequisite_ids: [other],
    };
    const receipt = f.dependencies.setPrerequisites(f.token, q);
    assert.deepEqual(f.dependencies.setPrerequisites(f.token, q), receipt);
    assert.throws(
      () => f.dependencies.setPrerequisites(f.token, { ...q, action_id: id() }),
      /DEPENDENCY_TASK_STALE/,
    );
    assert.throws(
      () =>
        f.dependencies.setPrerequisites(f.token, {
          ...q,
          action_id: id(),
          task_ref: ref(other),
          prerequisite_ids: [f.ids.task],
        }),
      /DEPENDENCY_CYCLE/,
    );
    assert.throws(
      () =>
        f.dependencies.setPrerequisites(f.token, {
          ...q,
          action_id: id(),
          task_ref: ref(other),
          prerequisite_ids: [id()],
        }),
      /NOT_FOUND_OR_DENIED/,
    );
    assert.equal(f.s.getResource(other)!.revision, "1");
  } finally {
    f.close();
  }
});
test("task readiness follows current prerequisite state and upstream validity", () => {
  const f = dependencyFixture();
  try {
    const other = id();
    provision(f, [other], []);
    f.s.putResource({ ...f.s.getResource(f.ids.task)!, id: other });
    f.dependencies.setPrerequisites(f.token, {
      project_id: f.ids.project,
      action_id: id(),
      task_ref: ref(f.ids.task),
      prerequisite_ids: [other],
    });
    const ctx = authenticate(
      f.s,
      f.token,
      f.ids.project,
      "dependency_read",
      f.now(),
    );
    assert.throws(
      () => assertTaskInputsCurrent(f.s, ctx, f.ids.task),
      /PLAN_STALE/,
    );
    const parent = f.s.getResource(other)!;
    parent.revision = "2";
    parent.data.status = "completed";
    f.s.putResource(parent);
    assert.doesNotThrow(() => assertTaskInputsCurrent(f.s, ctx, f.ids.task));
    parent.data.inputs_valid = false;
    f.s.putResource(parent);
    assert.throws(
      () => assertTaskInputsCurrent(f.s, ctx, f.ids.task),
      /PLAN_STALE/,
    );
  } finally {
    f.close();
  }
});

test("snapshot read retains its originating task authorization", () => {
  const f = dependencyFixture();
  try {
    f.dependencies.capture(f.token, f.request());
    f.g.resource_ids = f.g.resource_ids.filter((id) => id !== f.ids.task);
    f.s.updateGrant(f.g);
    assert.throws(
      () => f.dependencies.read(f.token, f.ids.project, f.snapshot),
      /NOT_FOUND_OR_DENIED/,
    );
  } finally {
    f.close();
  }
});
test("upstream provenance change without a revision cannot remain valid", () => {
  const f = dependencyFixture();
  try {
    f.dependencies.capture(f.token, f.request());
    const r = f.s.getResource(f.base)!;
    r.dependencies = [f.ids.acceptance];
    f.s.putResource(r);
    assert.equal(
      f.dependencies.read(f.token, f.ids.project, f.snapshot).validity,
      "stale",
    );
  } finally {
    f.close();
  }
});
