import test from "node:test";
import assert from "node:assert/strict";
import { fixture, id, ref, success, error } from "./helpers.ts";
import type { TaskData, WaitData } from "../packages/service/src/domain.ts";
import type {
  WaitRecord,
  CoreRequest,
} from "../packages/contracts/src/index.ts";
const read = (f: ReturnType<typeof fixture>, wait: string) =>
  success(f.service.execute(f.token, f.req("read_wait", { wait_id: wait })))
    .data as WaitRecord;
function complete(f: ReturnType<typeof fixture>) {
  const t = f.s.getResource<TaskData>(f.ids.task)!;
  t.revision = (BigInt(t.revision) + 1n).toString();
  t.data.status = "completed";
  f.service.updateTask(t);
}
function consume(f: ReturnType<typeof fixture>, w: WaitRecord): CoreRequest {
  return f.req("consume_wait", {
    action_id: id(),
    wait_id: w.wait_id,
    workflow_id: w.workflow_id,
    run_id: w.run_id,
    run_epoch: w.run_epoch,
    resolution_id: w.resolution_id,
    expected_wait_revision: w.revision,
  });
}
test("register before completion resolves atomically with target mutation and unique consumption", () => {
  const f = fixture();
  try {
    const q = f.register();
    const registered = success(f.service.execute(f.token, q))
      .data as WaitRecord;
    assert.equal(registered.state, "registered");
    complete(f);
    const resolved = read(f, registered.wait_id);
    assert.equal(resolved.state, "resolved");
    assert.equal(resolved.revision, "2");
    const c = consume(f, resolved);
    const receipt = success(f.service.execute(f.token, c)).data;
    assert.deepEqual(
      success(f.service.execute(f.token, { ...c, request_id: id() })).data,
      receipt,
    );
    assert.equal(read(f, registered.wait_id).state, "consumed");
    assert.equal(
      f.s.db.prepare("SELECT COUNT(*) n FROM continuation_inbox").get()!.n,
      1,
    );
    error(
      f.service.execute(f.token, { ...c, action_id: id() } as CoreRequest),
      "WAIT_STALE",
    );
  } finally {
    f.close();
  }
});
test("register after completion resolves immediately; repeat registration stable; conflicting step rejected", () => {
  const f = fixture();
  try {
    complete(f);
    const q = f.register();
    const r = success(f.service.execute(f.token, q)).data as WaitRecord;
    assert.equal(r.state, "resolved");
    assert.deepEqual(
      success(f.service.execute(f.token, { ...q, request_id: id() })).data,
      r,
    );
    error(
      f.service.execute(f.token, {
        ...q,
        deadline: "2026-11-14T10:01:00Z",
      } as CoreRequest),
      "WAIT_CONFLICT",
    );
    error(
      f.service.execute(f.token, { ...q, wait_id: id() } as CoreRequest),
      "WAIT_CONFLICT",
    );
    assert.equal(f.s.db.prepare("SELECT COUNT(*) n FROM outbox").get()!.n, 1);
  } finally {
    f.close();
  }
});
test("elapsed deadline fails registration without creating rows", () => {
  const f = fixture();
  try {
    f.advance(3600001);
    error(f.service.execute(f.token, f.register()), "WAIT_STALE");
    assert.equal(f.s.db.prepare("SELECT COUNT(*) n FROM waits").get()!.n, 0);
  } finally {
    f.close();
  }
});
for (const change of [
  "deadline",
  "target-revision",
  "acceptance-revision",
  "candidate-invalid",
  "run",
  "resolution",
  "grant",
  "acl",
])
  test("consume rejects stale or inaccessible " + change, () => {
    const f = fixture();
    try {
      complete(f);
      const w = success(f.service.execute(f.token, f.register()))
        .data as WaitRecord;
      let q = consume(f, w);
      if (change === "deadline") f.advance(3600001);
      if (change === "target-revision") {
        const t = f.s.getResource(f.ids.task)!;
        t.revision = "3";
        f.s.putResource(t);
      }
      if (change === "acceptance-revision") {
        const a = f.s.getResource(f.ids.acceptance)!;
        a.revision = "2";
        f.s.putResource(a);
      }
      if (change === "candidate-invalid") {
        const t = f.s.getResource<TaskData>(f.ids.task)!;
        t.data.status = "running";
        f.s.putResource(t);
      }
      if (change === "run") q = { ...q, run_id: id() } as CoreRequest;
      if (change === "resolution")
        q = { ...q, resolution_id: id() } as CoreRequest;
      if (change === "grant") f.s.updateGrant({ ...f.g, state: "revoked" });
      if (change === "acl") {
        const t = f.s.getResource(f.ids.task)!;
        t.acl = [];
        f.s.putResource(t);
      }
      assert.equal(f.service.execute(f.token, q).kind, "service_error");
      assert.equal(
        f.s.db.prepare("SELECT COUNT(*) n FROM continuation_inbox").get()!.n,
        0,
      );
    } finally {
      f.close();
    }
  });
test("same member with different grant cannot read old wait even with all resource ACLs", () => {
  const f = fixture();
  try {
    const w = success(f.service.execute(f.token, f.register()))
      .data as WaitRecord;
    const g = { ...f.g, id: id() };
    const token = f.s.issueGrant(g);
    for (const key of ["task", "workflow", "acceptance"] as const) {
      const r = f.s.getResource(f.ids[key])!;
      r.acl.push(g.id);
      f.s.putResource(r);
    }
    error(
      f.service.execute(token, f.req("read_wait", { wait_id: w.wait_id })),
      "NOT_FOUND_OR_DENIED",
    );
  } finally {
    f.close();
  }
});
test("review-ready predicate requires current valid candidate and acceptance/input closure", () => {
  const f = fixture();
  try {
    const t = f.s.getResource<TaskData>(f.ids.task)!;
    t.data.status = "in_review";
    f.s.putResource(t);
    const q = {
      ...f.register(),
      predicate: "task_review_ready",
    } as CoreRequest;
    const w = success(f.service.execute(f.token, q)).data as WaitRecord;
    assert.equal(w.state, "registered");
    t.revision = "2";
    t.data.candidate_ref = ref(f.ids.candidate);
    t.dependencies.push(f.ids.candidate);
    f.service.updateTask(t);
    assert.equal(read(f, w.wait_id).state, "resolved");
  } finally {
    f.close();
  }
});
test("missed wakeup can be deterministically reconciled, never by progress read", () => {
  const f = fixture();
  try {
    const w = success(f.service.execute(f.token, f.register()))
      .data as WaitRecord;
    const t = f.s.getResource<TaskData>(f.ids.task)!;
    t.revision = "2";
    t.data.status = "cancelled";
    f.s.putResource(t);
    assert.equal(read(f, w.wait_id).state, "registered");
    f.service.reconcileWaits(f.ids.task);
    assert.equal(read(f, w.wait_id).state, "resolved");
  } finally {
    f.close();
  }
});
