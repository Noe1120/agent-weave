import test from "node:test";
import assert from "node:assert/strict";
import { fixture, id, ref, success, error } from "./helpers.ts";
import type {
  TaskData,
  ExecutionData,
} from "../packages/service/src/domain.ts";
import type { WaitRecord } from "../packages/contracts/src/index.ts";
test("referenced candidate ACL is rechecked even if omitted from explicit dependency array", () => {
  const f = fixture();
  try {
    const t = f.s.getResource<TaskData>(f.ids.task)!;
    t.data.status = "in_review";
    t.data.candidate_ref = ref(f.ids.candidate);
    f.s.putResource(t);
    const q = { ...f.register(), predicate: "task_review_ready" } as ReturnType<
      typeof f.register
    >;
    const w = success(f.service.execute(f.token, q)).data as WaitRecord;
    const candidate = f.s.getResource(f.ids.candidate)!;
    candidate.acl = [];
    f.s.putResource(candidate);
    error(
      f.service.execute(f.token, f.req("read_wait", { wait_id: w.wait_id })),
      "NOT_FOUND_OR_DENIED",
    );
  } finally {
    f.close();
  }
});
test("resource projection cannot leak a referenced criterion outside current grant", () => {
  const f = fixture();
  try {
    const r = f.s.getResource(f.ids.acceptance)!;
    r.data.criteria_refs = [ref(id())];
    f.s.putResource(r);
    assert.throws(
      () => f.service.readResource(f.token, f.ids.project, "acceptance", r.id),
      /NOT_FOUND_OR_DENIED/,
    );
  } finally {
    f.close();
  }
});
test("private scope contents cannot be widened by reusing a scope revision", () => {
  const f = fixture();
  try {
    success(f.service.execute(f.token, f.apply()));
    const scope = f.s.getResource(f.ids.scope)!;
    scope.data.task_ids = [f.ids.task, id()];
    f.s.putResource(scope);
    error(
      f.service.execute(
        f.token,
        f.req("get_plan_progress", { plan_execution_id: f.ids.execution }),
      ),
      "PLAN_STALE",
    );
  } finally {
    f.close();
  }
});
test("different project, missing grant, expired grant, narrowed grant and unknown run fail closed", () => {
  for (const mode of ["project", "missing", "expired", "narrowed", "unknown"]) {
    const f = fixture();
    try {
      let q = f.apply(),
        token = f.token;
      if (mode === "project") q = { ...q, project_id: id() };
      if (mode === "missing") token = "missing";
      if (mode === "expired")
        f.s.updateGrant({ ...f.g, expires_at: "2026-11-14T08:00:00Z" });
      if (mode === "narrowed") f.s.updateGrant({ ...f.g, resource_ids: [] });
      if (mode === "unknown")
        f.s.putRun({ ...f.s.getRun(f.ids.run)!, state: "unknown" });
      if (mode === "missing")
        assert.throws(() => f.service.execute(token, q), /UNAUTHENTICATED/);
      else assert.equal(f.service.execute(token, q).kind, "service_error");
      assert.equal(
        f.s.db.prepare("SELECT count(*) n FROM actions").get()!.n,
        0,
      );
    } finally {
      f.close();
    }
  }
});
