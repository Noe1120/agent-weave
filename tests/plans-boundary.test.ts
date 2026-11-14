import test from "node:test";
import assert from "node:assert/strict";
import { fixture, success, error, id, ref } from "./helpers.ts";
import type {
  TaskData,
  PlanData,
  ApprovalData,
  RootData,
  ExecutionData,
} from "../packages/service/src/domain.ts";
for (const mutation of [
  "inputs",
  "acceptance-state",
  "acceptance-revision",
  "missing-acceptance-version",
])
  test(
    "plan cannot queue unverified acceptance/input closure: " + mutation,
    () => {
      const f = fixture();
      try {
        if (mutation === "inputs") {
          const t = f.s.getResource<TaskData>(f.ids.task)!;
          t.data.inputs_valid = false;
          f.s.putResource(t);
        } else if (mutation === "missing-acceptance-version") {
          const p = f.s.getResource<PlanData>(f.ids.plan)!;
          p.data.expected_resource_versions = [
            p.data.expected_resource_versions.find(
              (v) => v.entity_type === "task",
            )!,
          ];
          f.s.putResource(p);
        } else {
          const a = f.s.getResource(f.ids.acceptance)!;
          if (mutation === "acceptance-state") a.data.state = "draft";
          else {
            a.revision = "2";
            const p = f.s.getResource<PlanData>(f.ids.plan)!;
            p.data.expected_resource_versions.find(
              (v) => v.entity_type === "acceptance",
            )!.ref.revision = "2";
            f.s.putResource(p);
          }
          f.s.putResource(a);
        }
        error(f.service.execute(f.token, f.apply()), "PLAN_STALE");
        assert.equal(f.s.getResource(f.ids.root)!.data.budget_reserved, "0");
        assert.equal(f.s.getResource(f.ids.execution), undefined);
      } finally {
        f.close();
      }
    },
  );
for (const mode of ["expired", "wrong-plan", "wrong-scope", "denied"])
  test("plan approval is verified: " + mode, () => {
    const f = fixture();
    try {
      const a = f.s.getResource<ApprovalData>(f.ids.approval)!;
      if (mode === "expired") a.data.expires_at = "2026-11-14T08:00:00Z";
      if (mode === "wrong-plan") a.data.plan_ref = ref(f.ids.root);
      if (mode === "wrong-scope") a.data.scope_ref = ref(f.ids.root);
      if (mode === "denied") a.data.approved = false;
      f.s.putResource(a);
      error(f.service.execute(f.token, f.apply()), "PLAN_CONFLICT");
    } finally {
      f.close();
    }
  });
test("insufficient budget never becomes a zero-cost dispatch", () => {
  const f = fixture();
  try {
    const r = f.s.getResource<RootData>(f.ids.root)!;
    r.data.budget_limit = "9";
    f.s.putResource(r);
    error(f.service.execute(f.token, f.apply()), "BUDGET_UNAVAILABLE");
    assert.equal(f.s.db.prepare("SELECT count(*) n FROM outbox").get()!.n, 0);
  } finally {
    f.close();
  }
});
test("pause and resume change dispatch gate without delivering native commands", () => {
  const f = fixture();
  try {
    success(f.service.execute(f.token, f.apply()));
    for (const [mode, revision, gate] of [
      ["pause_dispatch", "1", "paused"],
      ["resume_dispatch", "2", "open"],
    ] as const) {
      success(
        f.service.execute(
          f.token,
          f.req("control_plan", {
            action_id: id(),
            plan_execution_id: f.ids.execution,
            expected_execution_revision: revision,
            mode,
            impact_scope_ref: ref(f.ids.scope),
          }),
        ),
      );
      assert.equal(
        f.s.getResource<ExecutionData>(f.ids.execution)!.data.dispatch_gate,
        gate,
      );
    }
    assert.equal(f.s.db.prepare("SELECT count(*) n FROM outbox").get()!.n, 3);
  } finally {
    f.close();
  }
});
test("scope evidence refs are retained and authorized in complete progress view", () => {
  const f = fixture();
  try {
    const scope = f.s.getResource(f.ids.scope)!;
    scope.data.evidence_ids = [f.ids.environment];
    f.s.putResource(scope);
    success(f.service.execute(f.token, f.apply()));
    const r = success(
      f.service.execute(
        f.token,
        f.req("get_plan_progress", { plan_execution_id: f.ids.execution }),
      ),
    );
    assert.deepEqual((r.data as any).evidence_refs, [ref(f.ids.environment)]);
  } finally {
    f.close();
  }
});
