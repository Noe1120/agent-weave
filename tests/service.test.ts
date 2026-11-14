import test from "node:test";
import assert from "node:assert/strict";
import { fixture, success, error, id, ref } from "./helpers.ts";
import type {
  ExecutionData,
  TaskData,
  PlanData,
  InputData,
} from "../packages/service/src/domain.ts";
import { validateCore } from "../packages/contracts/src/index.ts";
test("apply commits one action, budget reservation, queued task and outbox, not native execution", () => {
  const f = fixture();
  try {
    const req = f.apply();
    const result = success(f.service.execute(f.token, req));
    assert.equal(validateCore(result), true);
    assert.equal(f.s.getResource<TaskData>(f.ids.task)!.data.status, "queued");
    assert.equal(f.s.getResource(f.ids.root)!.data.budget_reserved, "10");
    assert.equal(f.s.db.prepare("SELECT COUNT(*) n FROM actions").get()!.n, 1);
    assert.equal(f.s.db.prepare("SELECT COUNT(*) n FROM outbox").get()!.n, 1);
    const retry = success(
      f.service.execute(f.token, { ...req, request_id: id() }),
    );
    assert.deepEqual(retry.data, result.data);
    assert.equal(f.s.db.prepare("SELECT COUNT(*) n FROM actions").get()!.n, 1);
  } finally {
    f.close();
  }
});
test("action payload conflict and stale plan do not make new effects", () => {
  const f = fixture();
  try {
    const a = f.apply();
    success(f.service.execute(f.token, a));
    error(
      f.service.execute(f.token, {
        ...a,
        expected_plan_token: "a-different-plan-token",
      } as typeof a),
      "ACTION_PAYLOAD_CONFLICT",
    );
    error(f.service.execute(f.token, f.apply()), "PLAN_STALE");
    assert.equal(f.s.db.prepare("SELECT COUNT(*) n FROM actions").get()!.n, 1);
  } finally {
    f.close();
  }
});
for (const [name, change, code] of [
  [
    "no approval",
    (f: ReturnType<typeof fixture>) => ({ ...f.apply(), approval_refs: [] }),
    "PLAN_CONFLICT",
  ],
  [
    "unknown budget",
    (f: ReturnType<typeof fixture>) => {
      const p = f.s.getResource<PlanData>(f.ids.plan)!;
      p.data.cost_ceiling = null;
      f.s.putResource(p);
      return f.apply();
    },
    "BUDGET_UNAVAILABLE",
  ],
  [
    "stale resource",
    (f: ReturnType<typeof fixture>) => {
      const t = f.s.getResource(f.ids.task)!;
      t.revision = "2";
      f.s.putResource(t);
      return f.apply();
    },
    "PLAN_STALE",
  ],
  [
    "delegation unsupported",
    (f: ReturnType<typeof fixture>) => ({
      ...f.apply(),
      delegation_ref: ref(id()),
    }),
    "DELEGATION_EXPIRED",
  ],
] as const)
  test("apply rejects " + name + " atomically", () => {
    const f = fixture();
    try {
      error(f.service.execute(f.token, change(f)), code);
      assert.equal(
        f.s.db.prepare("SELECT COUNT(*) n FROM actions").get()!.n,
        0,
      );
      assert.equal(f.s.getResource(f.ids.root)!.data.budget_reserved, "0");
    } finally {
      f.close();
    }
  });
test("current revocation denies cached action and same-member new execution cannot inherit", () => {
  const f = fixture();
  try {
    const a = f.apply();
    success(f.service.execute(f.token, a));
    const other = { ...f.g, id: id(), domain: "public-B" };
    const otherToken = f.s.issueGrant(other);
    error(
      f.service.execute(
        otherToken,
        f.req("read_action", { action_id: (a as any).action_id }),
      ),
      "NOT_FOUND_OR_DENIED",
    );
    f.s.updateGrant({ ...f.g, state: "revoked" });
    error(f.service.execute(f.token, a), "GRANT_REVOKED");
  } finally {
    f.close();
  }
});
test("policy, ACL, run epoch and native binding are checked on every retry", () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => f.s.putPolicy({ ...f.p, actions: [] }),
    (f: ReturnType<typeof fixture>) => {
      const t = f.s.getResource(f.ids.task)!;
      t.acl = [];
      f.s.putResource(t);
    },
    (f: ReturnType<typeof fixture>) =>
      f.s.putRun({ ...f.s.getRun(f.ids.run)!, epoch: "2" }),
    (f: ReturnType<typeof fixture>) =>
      f.s.putRun({
        ...f.s.getRun(f.ids.run)!,
        native_binding: "different/native",
      }),
  ]) {
    const f = fixture();
    try {
      const a = f.apply();
      success(f.service.execute(f.token, a));
      change(f);
      assert.equal(f.service.execute(f.token, a).kind, "service_error");
    } finally {
      f.close();
    }
  }
});
test("stop closes dispatch only; unknown execution is not stopped, closed or rolled back", () => {
  const f = fixture();
  try {
    success(f.service.execute(f.token, f.apply()));
    const e = f.s.getResource<ExecutionData>(f.ids.execution)!;
    e.data.health = "unknown";
    f.s.putResource(e);
    const c = f.req("control_plan", {
      action_id: id(),
      plan_execution_id: f.ids.execution,
      expected_execution_revision: "1",
      mode: "stop_plan",
      impact_scope_ref: ref(f.ids.scope),
    });
    const result = success(f.service.execute(f.token, c));
    assert.equal((result.data as any).effect_state, "pending_reconcile");
    const stored = f.s.getResource<ExecutionData>(f.ids.execution)!;
    assert.equal(stored.data.lifecycle, "stopping");
    assert.equal(stored.data.dispatch_gate, "closed");
    assert.equal(stored.data.outcome, null);
    assert.equal(stored.data.health, "unknown");
    error(
      f.service.execute(f.token, {
        ...c,
        action_id: id(),
        expected_execution_revision: "2",
        mode: "resume_dispatch",
      } as typeof c),
      "PLAN_CONFLICT",
    );
    assert.equal(f.s.getResource<TaskData>(f.ids.task)!.data.status, "queued");
  } finally {
    f.close();
  }
});
test("progress is read-only and rejects incomplete visible scope without partial counts", () => {
  const f = fixture();
  try {
    success(f.service.execute(f.token, f.apply()));
    const changes = () => f.s.db.prepare("SELECT total_changes() n").get()!.n;
    const before = changes();
    for (let i = 0; i < 5; i++) {
      const r = success(
        f.service.execute(
          f.token,
          f.req("get_plan_progress", { plan_execution_id: f.ids.execution }),
        ),
      );
      assert.equal(validateCore(r), true);
    }
    assert.equal(changes(), before);
    const t = f.s.getResource(f.ids.task)!;
    t.acl = [];
    f.s.putResource(t);
    error(
      f.service.execute(
        f.token,
        f.req("get_plan_progress", { plan_execution_id: f.ids.execution }),
      ),
      "NOT_FOUND_OR_DENIED",
    );
  } finally {
    f.close();
  }
});
test("reply binds clarification, native wait, responder, answer audience; queues once", () => {
  const f = fixture();
  try {
    const q = f.req("continuation_reply", {
      action_id: id(),
      input_request_id: f.ids.input,
      run_id: f.ids.run,
      run_epoch: "1",
      expected_input_revision: "1",
      answer_ref: ref(f.ids.answer),
    });
    const r = success(f.service.execute(f.token, q));
    assert.equal(
      f.s.getResource<InputData>(f.ids.input)!.data.state,
      "answered",
    );
    success(f.service.execute(f.token, q));
    assert.equal(
      f.s.db.prepare("SELECT COUNT(*) n FROM continuation_inbox").get()!.n,
      1,
    );
    assert.equal((r.data as any).effect_state, "committed");
  } finally {
    f.close();
  }
});
for (const change of [
  "approval",
  "unverified",
  "responder",
  "audience",
  "expired",
  "other-run",
])
  test("reply rejects " + change, () => {
    const f = fixture();
    try {
      const input = f.s.getResource<InputData>(f.ids.input)!;
      if (change === "approval") input.data.kind = "approval";
      if (change === "unverified") input.data.native_wait_verified = false;
      if (change === "responder") input.data.expected_responders = [];
      if (change === "audience") {
        const a = f.s.getResource(f.ids.answer)!;
        a.acl.push(id());
        f.s.putResource(a);
      }
      if (change === "expired") input.data.expires_at = "2026-11-14T08:00:00Z";
      if (change === "other-run") input.data.run_id = id();
      f.s.putResource(input);
      const r = f.service.execute(
        f.token,
        f.req("continuation_reply", {
          action_id: id(),
          input_request_id: f.ids.input,
          run_id: f.ids.run,
          run_epoch: "1",
          expected_input_revision: "1",
          answer_ref: ref(f.ids.answer),
        }),
      );
      assert.equal(r.kind, "service_error");
      assert.equal(
        f.s.db.prepare("SELECT COUNT(*) n FROM continuation_inbox").get()!.n,
        0,
      );
    } finally {
      f.close();
    }
  });
