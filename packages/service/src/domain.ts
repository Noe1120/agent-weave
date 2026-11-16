import type {
  CoreRequest,
  Operation,
  PlanProgress,
  Receipt,
  Ref,
  WaitRecord,
} from "../../contracts/src/index.ts";
export type Action =
  | Operation
  | "read_resource"
  | "read_feed"
  | "broker_read"
  | "broker_write"
  | "runner_start"
  | "runner_read"
  | "runner_stop"
  | "adapter_configure"
  | "adapter_read"
  | "runtime_control"
  | "dependency_capture"
  | "dependency_read"
  | "knowledge_read";
export interface Policy {
  id: string;
  project_id: string;
  member_id: string;
  revision: string;
  active: boolean;
  actions: Action[];
  resource_ids: string[];
}
export interface Run {
  id: string;
  project_id: string;
  epoch: string;
  native_binding: string;
  state: "active" | "unknown" | "closed";
}
export interface Grant {
  connection_constraint?: {
    connection_id: string;
    connection_revision: string;
    task_id: string;
    data_class: "synthetic_only";
  };
  id: string;
  project_id: string;
  member_id: string;
  policy_id: string;
  policy_revision: string;
  run_id: string;
  run_epoch: string;
  native_binding: string;
  domain: string;
  actions: Action[];
  resource_ids: string[];
  state: "active" | "revoked";
  expires_at: string;
}
export interface Resource<T = Record<string, unknown>> {
  id: string;
  project_id: string;
  kind: string;
  revision: string;
  domain: string;
  acl: string[];
  dependencies: string[];
  data: T;
}
export interface Context {
  grant: Grant;
  policy: Policy;
  run: Run;
}
export interface TaskData {
  status:
    | "draft"
    | "queued"
    | "running"
    | "in_review"
    | "ready_to_merge"
    | "completed"
    | "cancelled";
  candidate_ref: Ref | null;
  inputs_valid: boolean;
  input_snapshot_ref?: Ref;
  prerequisite_ids?: string[];
  acceptance_ref: Ref;
}
export interface RootData {
  state:
    | "active"
    | "suspected_stall"
    | "expansion_paused"
    | "draining"
    | "completed"
    | "cancelled";
  budget_limit: string;
  budget_reserved: string;
}
export interface PlanData {
  state: "proposed" | "applied";
  expected_plan_token: string;
  expected_resource_versions: Extract<
    CoreRequest,
    { kind: "apply_plan" }
  >["expected_resource_versions"];
  approval_refs: Ref[];
  disclosure_refs: Ref[];
  root_ref: Ref;
  scope_ref: Ref;
  task_refs: Ref[];
  execution_id: string;
  cost_ceiling: string | null;
}
export interface ApprovalData {
  approved: boolean;
  plan_ref: Ref;
  scope_ref: Ref;
  expires_at: string;
  approval_kind: "plan" | "disclosure";
}
export interface InputData {
  run_id: string;
  run_epoch: string;
  grant_id: string;
  native_binding: string;
  native_wait_verified: boolean;
  kind: "clarification" | "approval";
  expected_responders: string[];
  audience: string[];
  state: "pending" | "answered" | "cancelled";
  expires_at: string;
  workflow_id: string;
  answer_ref?: Ref;
}
export interface WaitData {
  registration: Extract<CoreRequest, { kind: "register_wait" }>;
  fingerprint: string;
  grant_id: string;
  record: WaitRecord;
  target_snapshot: string | null;
}
export interface SavedAction {
  action_id: string;
  project_id: string;
  grant_id: string;
  operation: Operation;
  fingerprint: string;
  request: CoreRequest;
  receipt: Receipt;
  resource_ids: string[];
}
export type ExecutionData = Omit<
  PlanProgress,
  "observed_at" | "revision" | "plan_execution_id" | "view_scope"
>;
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b, "en"))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export function businessPayload(request: CoreRequest): string {
  const { request_id, ...rest } = request;
  return canonical(rest);
}
export function nextRevision(revision: string): string {
  return (BigInt(revision) + 1n).toString();
}
