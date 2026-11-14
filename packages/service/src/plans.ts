import { randomBytes } from "node:crypto";
import type { Store } from "./store.ts";
import type {
  CoreRequest,
  PlanProgress,
  Ref,
} from "../../contracts/src/index.ts";
import type {
  Context,
  PlanData,
  RootData,
  ApprovalData,
  ExecutionData,
  TaskData,
  Resource,
} from "./domain.ts";
import { canonical, nextRevision } from "./domain.ts";
import { requireActive, requireResource } from "./auth.ts";
import { fail } from "./errors.ts";
export interface Effect {
  resources: string[];
  state: "committed" | "pending_reconcile";
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
function checkedRef<T>(
  s: Store,
  c: Context,
  ref: Ref,
  kind: string,
): Resource<T> {
  const r = requireResource<T>(s, c, ref.id, kind);
  if (r.revision !== ref.revision) fail("PLAN_STALE");
  return r;
}
export function applyPlan(
  s: Store,
  c: Context,
  q: Extract<CoreRequest, { kind: "apply_plan" }>,
  now: number,
): Effect {
  requireActive(c);
  const plan = checkedRef<PlanData>(s, c, q.plan_ref, "plan"),
    p = plan.data;
  // Delegation needs a separate validated implementation; never treat a ref as authority.
  if (q.delegation_ref !== null) fail("DELEGATION_EXPIRED");
  if (
    p.state !== "proposed" ||
    s.head(q.project_id) !== q.expected_plan_token ||
    p.expected_plan_token !== q.expected_plan_token
  )
    fail("PLAN_STALE");
  if (
    !same(q.expected_resource_versions, p.expected_resource_versions) ||
    !same(q.approval_refs, p.approval_refs) ||
    !p.approval_refs.length
  )
    fail("PLAN_CONFLICT");
  if (!same(q.disclosure_refs, p.disclosure_refs))
    fail("DISCLOSURE_APPROVAL_REQUIRED");
  const scope = checkedRef<{ task_ids: string[]; evidence_ids: string[] }>(
    s,
    c,
    p.scope_ref,
    "scope",
  );
  const root = checkedRef<RootData>(s, c, p.root_ref, "root");
  const touched = [plan.id, scope.id, root.id];
  const seen = new Set<string>();
  for (const assertion of q.expected_resource_versions) {
    if (seen.has(assertion.ref.id)) fail("PLAN_CONFLICT");
    seen.add(assertion.ref.id);
    checkedRef(s, c, assertion.ref, assertion.entity_type);
    touched.push(assertion.ref.id);
  }
  for (const [refs, kind] of [
    [p.approval_refs, "plan"],
    [p.disclosure_refs, "disclosure"],
  ] as const) {
    for (const ref of refs) {
      const a = checkedRef<ApprovalData>(s, c, ref, "approval");
      if (
        a.data.approval_kind !== kind ||
        !a.data.approved ||
        !same(a.data.plan_ref, q.plan_ref) ||
        !same(a.data.scope_ref, p.scope_ref) ||
        !Number.isFinite(Date.parse(a.data.expires_at)) ||
        Date.parse(a.data.expires_at) <= now
      )
        fail(kind === "plan" ? "PLAN_CONFLICT" : "DISCLOSURE_STALE");
      touched.push(a.id);
    }
  }
  if (
    !same(
      [...scope.data.task_ids].sort(),
      p.task_refs.map((r) => r.id).sort(),
    ) ||
    new Set(p.task_refs.map((r) => r.id)).size !== p.task_refs.length ||
    p.task_refs.length === 0
  )
    fail("PLAN_CONFLICT");
  const tasks = p.task_refs.map((ref) => {
    const t = checkedRef<TaskData>(s, c, ref, "task");
    if (t.data.status !== "draft") fail("REASSIGNMENT_REQUIRES_HANDOFF");
    if (!seen.has(t.id)) fail("PLAN_CONFLICT");
    const acceptance = checkedRef<{ state: string }>(
      s,
      c,
      t.data.acceptance_ref,
      "acceptance",
    );
    if (
      !t.data.inputs_valid ||
      acceptance.data.state !== "confirmed" ||
      !seen.has(acceptance.id)
    )
      fail("PLAN_STALE");
    return t;
  });
  const evidence = scope.data.evidence_ids.map((id) => {
    const r = requireResource(s, c, id);
    touched.push(r.id);
    return { id: r.id, revision: r.revision };
  });
  if (
    root.data.state !== "active" ||
    p.cost_ceiling === null ||
    !/^([0-9]+)$/.test(p.cost_ceiling) ||
    !/^([0-9]+)$/.test(root.data.budget_limit) ||
    !/^([0-9]+)$/.test(root.data.budget_reserved)
  )
    fail("BUDGET_UNAVAILABLE");
  const reserved = BigInt(root.data.budget_reserved) + BigInt(p.cost_ceiling);
  if (reserved > BigInt(root.data.budget_limit)) fail("BUDGET_UNAVAILABLE");
  if (s.getResource(p.execution_id)) fail("PLAN_CONFLICT");
  if (
    !c.grant.resource_ids.includes(p.execution_id) ||
    !c.policy.resource_ids.includes(p.execution_id)
  )
    fail("NOT_FOUND_OR_DENIED");
  for (const task of tasks) {
    task.data.status = "queued";
    task.revision = nextRevision(task.revision);
    s.putResource(task);
    touched.push(task.id);
  }
  root.data.budget_reserved = reserved.toString();
  root.revision = nextRevision(root.revision);
  s.putResource(root);
  plan.data.state = "applied";
  plan.revision = nextRevision(plan.revision);
  s.putResource(plan);
  const execution: Resource<ExecutionData> = {
    id: p.execution_id,
    project_id: q.project_id,
    kind: "plan_execution",
    revision: "1",
    domain: plan.domain,
    acl: [...plan.acl],
    dependencies: [...new Set(touched)],
    data: {
      scope_ref: p.scope_ref,
      lifecycle: "active",
      dispatch_gate: "open",
      health: "healthy",
      outcome: null,
      task_refs: tasks.map((t) => ({ id: t.id, revision: t.revision })),
      evidence_refs: evidence,
      budget_state: "reserved",
    },
  };
  s.putResource(execution);
  touched.push(execution.id);
  s.setHead(q.project_id, randomBytes(24).toString("base64url"));
  s.outbox(q.project_id, c.grant.id, "plan_applied", execution.id, {
    execution_ref: { id: execution.id, revision: "1" },
  });
  return { resources: [...new Set(touched)], state: "committed" };
}
export function progress(
  s: Store,
  c: Context,
  id: string,
  now: number,
): PlanProgress {
  const e = requireResource<ExecutionData>(s, c, id, "plan_execution");
  const scope = requireResource<{ task_ids: string[]; evidence_ids: string[] }>(
    s,
    c,
    e.data.scope_ref.id,
    "scope",
  );
  if (
    scope.revision !== e.data.scope_ref.revision ||
    !same(
      [...scope.data.task_ids].sort(),
      e.data.task_refs.map((r) => r.id).sort(),
    ) ||
    !same(
      [...scope.data.evidence_ids].sort(),
      e.data.evidence_refs.map((r) => r.id).sort(),
    )
  )
    fail("PLAN_STALE");
  for (const r of [
    e.data.scope_ref,
    ...e.data.task_refs,
    ...e.data.evidence_refs,
  ])
    requireResource(s, c, r.id);
  return {
    ...e.data,
    task_refs: e.data.task_refs.map((ref) => {
      const t = requireResource(s, c, ref.id, "task");
      return { id: t.id, revision: t.revision };
    }),
    plan_execution_id: e.id,
    revision: e.revision,
    view_scope: "full_authorized_scope",
    observed_at: new Date(now).toISOString(),
  };
}
export function controlPlan(
  s: Store,
  c: Context,
  q: Extract<CoreRequest, { kind: "control_plan" }>,
  now: number,
): Effect {
  const view = progress(s, c, q.plan_execution_id, now);
  const e = requireResource<ExecutionData>(
    s,
    c,
    q.plan_execution_id,
    "plan_execution",
  );
  if (
    view.revision !== q.expected_execution_revision ||
    !same(view.scope_ref, q.impact_scope_ref)
  )
    fail("PLAN_STALE");
  if (e.data.lifecycle !== "active") fail("PLAN_CONFLICT");
  if (q.mode === "resume_dispatch") {
    requireActive(c);
    if (e.data.health === "unknown") fail("EXECUTION_UNKNOWN");
    e.data.dispatch_gate = "open";
  }
  if (q.mode === "pause_dispatch") e.data.dispatch_gate = "paused";
  if (q.mode === "stop_plan") {
    e.data.dispatch_gate = "closed";
    e.data.lifecycle = "stopping";
    e.data.outcome = null;
    e.data.budget_state = "reconciling";
  }
  e.revision = nextRevision(e.revision);
  s.putResource(e);
  s.outbox(q.project_id, c.grant.id, "plan_control_intent", e.id, {
    mode: q.mode,
    execution_ref: { id: e.id, revision: e.revision },
  });
  return {
    resources: [e.id, ...e.dependencies],
    state: q.mode === "stop_plan" ? "pending_reconcile" : "committed",
  };
}
