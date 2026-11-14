import { randomUUID } from "node:crypto";
import type {
  CoreRequest,
  CoreResult,
  Operation,
  Ref,
} from "../packages/contracts/src/index.ts";
import { operations } from "../packages/contracts/src/index.ts";
import { Store } from "../packages/service/src/store.ts";
import { CoreService } from "../packages/service/src/service.ts";
import type {
  Resource,
  Grant,
  Policy,
  TaskData,
  PlanData,
  RootData,
  InputData,
} from "../packages/service/src/domain.ts";
import assert from "node:assert/strict";
export const id = () => randomUUID();
export const ref = (id: string, revision = "1"): Ref => ({ id, revision });
export function fixture(filename = ":memory:") {
  const s = new Store(filename);
  let time = Date.parse("2026-11-14T09:00:00Z");
  const ids = Object.fromEntries(
    [
      "project",
      "member",
      "policy",
      "run",
      "grant",
      "task",
      "acceptance",
      "scope",
      "root",
      "plan",
      "approval",
      "execution",
      "workflow",
      "input",
      "answer",
      "candidate",
      "environment",
    ].map((k) => [k, id()]),
  ) as Record<
    | "project"
    | "member"
    | "policy"
    | "run"
    | "grant"
    | "task"
    | "acceptance"
    | "scope"
    | "root"
    | "plan"
    | "approval"
    | "execution"
    | "workflow"
    | "input"
    | "answer"
    | "candidate"
    | "environment",
    string
  >;
  const expires = "2026-11-15T09:00:00Z";
  const p: Policy = {
    id: ids.policy,
    project_id: ids.project,
    member_id: ids.member,
    revision: "1",
    active: true,
    actions: [...operations, "read_resource"],
    resource_ids: Object.values(ids),
  };
  const g: Grant = {
    id: ids.grant,
    project_id: ids.project,
    member_id: ids.member,
    policy_id: ids.policy,
    policy_revision: "1",
    run_id: ids.run,
    run_epoch: "1",
    native_binding: "synthetic/native/private",
    domain: "private-A",
    actions: [...p.actions],
    resource_ids: Object.values(ids),
    state: "active",
    expires_at: expires,
  };
  s.putPolicy(p);
  s.putRun({
    id: ids.run,
    project_id: ids.project,
    epoch: "1",
    native_binding: g.native_binding,
    state: "active",
  });
  const token = s.issueGrant(g);
  function resource<T>(
    key: keyof typeof ids,
    kind: string,
    data: T,
    dependencies: string[] = [],
  ): Resource<T> {
    const r = {
      id: ids[key],
      project_id: ids.project,
      kind,
      revision: "1",
      domain: g.domain,
      acl: [g.id],
      dependencies,
      data,
    };
    s.putResource(r);
    return r;
  }
  resource("acceptance", "acceptance", {
    state: "confirmed",
    criteria_refs: [],
  });
  resource("candidate", "changeset", {
    producer_run_id: ids.run,
    base_commit: "synthetic-base",
    source_commit: "synthetic-source",
    tree_digest: "synthetic-tree",
    readiness: "ready",
    review_state: "approved",
    validity: "valid",
  });
  resource<TaskData>(
    "task",
    "task",
    {
      status: "draft",
      candidate_ref: null,
      inputs_valid: true,
      acceptance_ref: ref(ids.acceptance),
    },
    [ids.acceptance],
  );
  resource("scope", "scope", { task_ids: [ids.task], evidence_ids: [] }, [
    ids.task,
    ids.acceptance,
  ]);
  resource<RootData>("root", "root", {
    state: "active",
    budget_limit: "1000",
    budget_reserved: "0",
  });
  resource("approval", "approval", {
    approved: true,
    plan_ref: ref(ids.plan),
    scope_ref: ref(ids.scope),
    expires_at: expires,
    approval_kind: "plan",
  });
  resource<PlanData>(
    "plan",
    "plan",
    {
      state: "proposed",
      expected_plan_token: "synthetic-plan-token-0001",
      expected_resource_versions: [
        { entity_type: "task", ref: ref(ids.task) },
        { entity_type: "acceptance", ref: ref(ids.acceptance) },
      ],
      approval_refs: [ref(ids.approval)],
      disclosure_refs: [],
      root_ref: ref(ids.root),
      scope_ref: ref(ids.scope),
      task_refs: [ref(ids.task)],
      execution_id: ids.execution,
      cost_ceiling: "10",
    },
    [ids.scope, ids.root, ids.approval],
  );
  resource("workflow", "workflow", { run_id: ids.run, run_epoch: "1" });
  resource<InputData>("input", "input_request", {
    run_id: ids.run,
    run_epoch: "1",
    grant_id: g.id,
    native_binding: g.native_binding,
    native_wait_verified: true,
    kind: "clarification",
    expected_responders: [ids.member],
    audience: [g.id],
    state: "pending",
    expires_at: expires,
    workflow_id: ids.workflow,
  });
  resource("answer", "answer", { text: "synthetic answer only" });
  resource("environment", "environment", {
    state: "verified",
    digest: "synthetic-environment",
  });
  resource("grant", "grant", {
    member_id: g.member_id,
    run_id: g.run_id,
    run_epoch: g.run_epoch,
    state: g.state,
    expires_at: g.expires_at,
  });
  s.setHead(ids.project, "synthetic-plan-token-0001");
  const service = new CoreService(s, () => time);
  const req = (kind: Operation, extra: Record<string, unknown> = {}) =>
    ({
      contract_version: "core/1.0",
      kind,
      request_id: id(),
      project_id: ids.project,
      ...extra,
    }) as CoreRequest;
  const apply = () =>
    req("apply_plan", {
      action_id: id(),
      plan_ref: ref(ids.plan),
      expected_plan_token: s.head(ids.project),
      expected_resource_versions: s.getResource<PlanData>(ids.plan)!.data
        .expected_resource_versions,
      approval_refs: [ref(ids.approval)],
      disclosure_refs: [],
      delegation_ref: null,
    });
  const register = () =>
    req("register_wait", {
      wait_id: id(),
      workflow_id: ids.workflow,
      step_key: id(),
      run_id: ids.run,
      run_epoch: "1",
      target_task_id: ids.task,
      minimum_target_revision: "1",
      predicate: "task_terminal",
      deadline: "2026-11-14T10:00:00Z",
    });
  return {
    s,
    service,
    ids,
    p,
    g,
    token,
    resource,
    req,
    apply,
    register,
    advance: (ms: number) => (time += ms),
    now: () => time,
    close: () => s.close(),
  };
}
export function success(value: ReturnType<CoreService["execute"]>): CoreResult {
  assert.equal(value.kind, "service_result", JSON.stringify(value));
  if (value.kind !== "service_result") throw new Error("not result");
  return value;
}
export function error(value: ReturnType<CoreService["execute"]>, code: string) {
  assert.equal(value.kind, "service_error");
  if (value.kind === "service_error") assert.equal(value.code, code);
}
