import { assertTaskInputsCurrent } from "./dependencies.ts";
import { randomUUID } from "node:crypto";
import type { Store } from "./store.ts";
import type { Context, Resource, TaskData, WaitData } from "./domain.ts";
import { canonical, businessPayload, nextRevision } from "./domain.ts";
import {
  authorizeGrant,
  requireResource,
  requireRun,
  requireActive,
} from "./auth.ts";
import { ServiceFault, fail } from "./errors.ts";
import type { CoreRequest, WaitRecord } from "../../contracts/src/index.ts";
import type { Effect } from "./plans.ts";
export function boundWait(s: Store, c: Context, id: string): WaitData {
  const w = s.getWait(id);
  if (
    !w ||
    w.grant_id !== c.grant.id ||
    w.registration.project_id !== c.grant.project_id
  )
    fail("NOT_FOUND_OR_DENIED");
  requireRun(c, w.record.run_id, w.record.run_epoch);
  requireResource(s, c, w.record.workflow_id, "workflow");
  requireResource(s, c, w.record.target_task_id, "task");
  return w;
}
function workflow(s: Store, c: Context, id: string) {
  const w = requireResource<{ run_id: string; run_epoch: string }>(
    s,
    c,
    id,
    "workflow",
  );
  requireRun(c, w.data.run_id, w.data.run_epoch);
}
function predicate(s: Store, c: Context, w: WaitData): boolean {
  const t = requireResource<TaskData>(s, c, w.record.target_task_id, "task");
  if (BigInt(t.revision) < BigInt(w.registration.minimum_target_revision))
    return false;
  if (w.registration.predicate === "task_terminal")
    return ["completed", "cancelled"].includes(t.data.status);
  if (
    !["in_review", "ready_to_merge", "completed"].includes(t.data.status) ||
    !t.data.inputs_valid ||
    !t.data.candidate_ref
  )
    return false;
  try {
    assertTaskInputsCurrent(s, c, t.id);
  } catch (e) {
    if (e instanceof ServiceFault && e.code === "PLAN_STALE") return false;
    throw e;
  }
  const a = requireResource(s, c, t.data.acceptance_ref.id, "acceptance");
  const candidate = requireResource(s, c, t.data.candidate_ref.id, "changeset");
  return (
    a.revision === t.data.acceptance_ref.revision &&
    a.data.state === "confirmed" &&
    candidate.revision === t.data.candidate_ref.revision &&
    candidate.data.validity === "valid" &&
    candidate.data.readiness === "ready"
  );
}
function snapshot(s: Store, c: Context, target: string): string {
  const all = new Map<string, unknown>();
  function visit(id: string) {
    if (all.has(id)) return;
    const r = requireResource(s, c, id);
    all.set(id, {
      revision: r.revision,
      data: r.data,
      dependencies: r.dependencies,
    });
    for (const dep of r.dependencies) visit(dep);
    if (r.kind === "task") {
      const t = r.data as unknown as TaskData;
      visit(t.acceptance_ref.id);
      if (t.candidate_ref) visit(t.candidate_ref.id);
    }
  }
  visit(target);
  return canonical(Object.fromEntries(all));
}
function resolve(s: Store, c: Context, w: WaitData, now: number) {
  if (w.record.state !== "registered") return;
  if (Date.parse(w.record.deadline) <= now) {
    w.record.state = "expired";
    w.record.revision = nextRevision(w.record.revision);
    s.saveWait(w);
    return;
  }
  if (!predicate(s, c, w)) return;
  const t = requireResource(s, c, w.record.target_task_id, "task");
  w.record.state = "resolved";
  w.record.revision = nextRevision(w.record.revision);
  w.record.resolution_id = randomUUID();
  w.record.result_ref = { id: t.id, revision: t.revision };
  w.target_snapshot = snapshot(s, c, t.id);
  s.saveWait(w);
  s.outbox(
    w.registration.project_id,
    c.grant.id,
    "wait_resolved",
    w.record.wait_id,
    {
      wait_id: w.record.wait_id,
      resolution_id: w.record.resolution_id,
      result_ref: w.record.result_ref,
    },
  );
}
export function registerWait(
  s: Store,
  c: Context,
  q: Extract<CoreRequest, { kind: "register_wait" }>,
  now: number,
): WaitRecord {
  requireActive(c);
  requireRun(c, q.run_id, q.run_epoch);
  workflow(s, c, q.workflow_id);
  requireResource(s, c, q.target_task_id, "task");
  const prior = s.getWait(q.wait_id);
  if (prior) {
    boundWait(s, c, q.wait_id);
    if (prior.fingerprint !== businessPayload(q)) fail("WAIT_CONFLICT");
    return prior.record;
  }
  if (Date.parse(q.deadline) <= now) fail("WAIT_STALE");
  if (s.activeWait(q.workflow_id, q.run_id, q.run_epoch, q.step_key))
    fail("WAIT_CONFLICT");
  const w: WaitData = {
    registration: q,
    fingerprint: businessPayload(q),
    grant_id: c.grant.id,
    target_snapshot: null,
    record: {
      wait_id: q.wait_id,
      workflow_id: q.workflow_id,
      run_id: q.run_id,
      run_epoch: q.run_epoch,
      target_task_id: q.target_task_id,
      revision: "1",
      state: "registered",
      resolution_id: null,
      result_ref: null,
      deadline: q.deadline,
    },
  };
  s.saveWait(w);
  resolve(s, c, w, now);
  return w.record;
}
export function consumeWait(
  s: Store,
  c: Context,
  q: Extract<CoreRequest, { kind: "consume_wait" }>,
  now: number,
): Effect {
  requireActive(c);
  requireRun(c, q.run_id, q.run_epoch);
  const w = boundWait(s, c, q.wait_id);
  workflow(s, c, q.workflow_id);
  if (
    w.record.workflow_id !== q.workflow_id ||
    w.record.state !== "resolved" ||
    w.record.revision !== q.expected_wait_revision ||
    w.record.resolution_id !== q.resolution_id ||
    Date.parse(w.record.deadline) <= now ||
    !predicate(s, c, w) ||
    snapshot(s, c, w.record.target_task_id) !== w.target_snapshot
  )
    fail("WAIT_STALE");
  w.record.state = "consumed";
  w.record.revision = nextRevision(w.record.revision);
  s.saveWait(w);
  s.inbox(q.project_id, c.grant.id, q.workflow_id, q.wait_id, q.resolution_id, {
    wait_id: q.wait_id,
    resolution_id: q.resolution_id,
    result_ref: w.record.result_ref,
  });
  return {
    resources: [w.record.target_task_id, w.record.workflow_id],
    state: "committed",
  };
}
// Call inside the same transaction as a trusted target mutation. A revoked waiter must not prevent another task's commit.
export function reconcile(s: Store, taskId: string, now: number) {
  for (const w of s.waitsForTask(taskId)) {
    const grant = s.getGrant(w.grant_id);
    if (!grant) {
      w.record.state = "invalidated";
      w.record.revision = nextRevision(w.record.revision);
      s.saveWait(w);
      continue;
    }
    try {
      const c = authorizeGrant(
        s,
        grant,
        w.registration.project_id,
        "register_wait",
        now,
      );
      workflow(s, c, w.record.workflow_id);
      resolve(s, c, w, now);
    } catch (e) {
      if (!(e instanceof ServiceFault)) throw e;
      w.record.state = "invalidated";
      w.record.revision = nextRevision(w.record.revision);
      s.saveWait(w);
    }
  }
}
