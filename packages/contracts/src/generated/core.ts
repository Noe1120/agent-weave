/* Generated from plan/contracts. Do not edit. */

/**
 * Design contract only. Authentication context is supplied by the trusted channel, not these payloads. Schema validation does not establish semantic authorization or runtime correctness.
 */
export type CoreWire =
  | ApplyPlan
  | ControlPlan
  | ConsumeWait
  | ContinuationReply
  | ReadAction
  | RegisterWait
  | ReadWait
  | GetPlanProgress
  | ServiceResult
  | ServiceError
  | VisibleEvent;
export type Uuid = string;
export type Revision = string;
export type Opaque = string;
export type Epoch = string;
export type Timestamp = string;
export type ServiceResult =
  | {
      contract_version: "core/1.0";
      kind: "service_result";
      request_id: Uuid;
      project_id: Uuid;
      operation: "apply_plan";
      data: Receipt;
    }
  | {
      contract_version: "core/1.0";
      kind: "service_result";
      request_id: Uuid;
      project_id: Uuid;
      operation: "control_plan";
      data: Receipt;
    }
  | {
      contract_version: "core/1.0";
      kind: "service_result";
      request_id: Uuid;
      project_id: Uuid;
      operation: "consume_wait";
      data: Receipt;
    }
  | {
      contract_version: "core/1.0";
      kind: "service_result";
      request_id: Uuid;
      project_id: Uuid;
      operation: "continuation_reply";
      data: Receipt;
    }
  | {
      contract_version: "core/1.0";
      kind: "service_result";
      request_id: Uuid;
      project_id: Uuid;
      operation: "read_action";
      data: Receipt;
    }
  | {
      contract_version: "core/1.0";
      kind: "service_result";
      request_id: Uuid;
      project_id: Uuid;
      operation: "register_wait";
      data: WaitRecord;
    }
  | {
      contract_version: "core/1.0";
      kind: "service_result";
      request_id: Uuid;
      project_id: Uuid;
      operation: "read_wait";
      data: WaitRecord;
    }
  | {
      contract_version: "core/1.0";
      kind: "service_result";
      request_id: Uuid;
      project_id: Uuid;
      operation: "get_plan_progress";
      data: PlanProgress;
    };
export type WaitRecord = {
  wait_id: Uuid;
  workflow_id: Uuid;
  run_id: Uuid;
  run_epoch: Epoch;
  target_task_id: Uuid;
  revision: Revision;
  state: "registered" | "resolved" | "consumed" | "cancelled" | "expired" | "invalidated";
  resolution_id: Uuid | null;
  result_ref: Ref | null;
  deadline: Timestamp;
};
export type PlanProgress = {
  plan_execution_id: Uuid;
  revision: Revision;
  scope_ref: Ref;
  view_scope: "full_authorized_scope";
  lifecycle: "active" | "stopping" | "closed";
  dispatch_gate: "open" | "paused" | "closed";
  health: "healthy" | "partial_failure" | "blocked" | "unknown";
  outcome: ("succeeded" | "partial" | "failed" | "cancelled") | null;
  /**
   * @minItems 0
   */
  task_refs: Ref[];
  /**
   * @minItems 0
   */
  evidence_refs: Ref[];
  budget_state: "reserved" | "reconciling" | "settled" | "bounded_pending_charge";
  observed_at: Timestamp;
};
export type VisibleEvent = {
  contract_version: "core/1.0";
  kind: "visible_event";
  event_id: Uuid;
  event_type:
    "wait_resolved" | "task_state_changed" | "plan_state_changed" | "control_outcome_changed" | "wait_state_changed";
  project_id: Uuid;
  entity_ref: Ref;
  stream_cursor: Opaque;
  resolution_id: Uuid | null;
  occurred_at: Timestamp;
};

export interface ApplyPlan {
  contract_version: "core/1.0";
  kind: "apply_plan";
  request_id: Uuid;
  project_id: Uuid;
  action_id: Uuid;
  plan_ref: Ref;
  expected_plan_token: Opaque;
  /**
   * @minItems 0
   */
  approval_refs: Ref[];
  /**
   * @minItems 0
   */
  disclosure_refs: Ref[];
  delegation_ref: Ref | null;
  /**
   * @minItems 1
   */
  expected_resource_versions: [VersionAssertion, ...VersionAssertion[]];
}
export interface Ref {
  id: Uuid;
  revision: Revision;
}
export interface VersionAssertion {
  entity_type:
    "task" | "acceptance" | "requirements" | "capability" | "policy" | "changeset" | "environment" | "plan_execution";
  ref: Ref;
}
export interface ControlPlan {
  contract_version: "core/1.0";
  kind: "control_plan";
  request_id: Uuid;
  project_id: Uuid;
  action_id: Uuid;
  plan_execution_id: Uuid;
  expected_execution_revision: Revision;
  mode: "pause_dispatch" | "resume_dispatch" | "stop_plan";
  impact_scope_ref: Ref;
}
export interface ConsumeWait {
  contract_version: "core/1.0";
  kind: "consume_wait";
  request_id: Uuid;
  project_id: Uuid;
  action_id: Uuid;
  wait_id: Uuid;
  workflow_id: Uuid;
  run_id: Uuid;
  run_epoch: Epoch;
  resolution_id: Uuid;
  expected_wait_revision: Revision;
}
export interface ContinuationReply {
  contract_version: "core/1.0";
  kind: "continuation_reply";
  request_id: Uuid;
  project_id: Uuid;
  action_id: Uuid;
  input_request_id: Uuid;
  run_id: Uuid;
  run_epoch: Epoch;
  expected_input_revision: Revision;
  answer_ref: Ref;
}
export interface ReadAction {
  contract_version: "core/1.0";
  kind: "read_action";
  request_id: Uuid;
  project_id: Uuid;
  action_id: Uuid;
}
export interface RegisterWait {
  contract_version: "core/1.0";
  kind: "register_wait";
  request_id: Uuid;
  project_id: Uuid;
  wait_id: Uuid;
  workflow_id: Uuid;
  step_key: Uuid;
  run_id: Uuid;
  run_epoch: Epoch;
  target_task_id: Uuid;
  minimum_target_revision: Revision;
  predicate: "task_terminal" | "task_review_ready";
  deadline: Timestamp;
}
export interface ReadWait {
  contract_version: "core/1.0";
  kind: "read_wait";
  request_id: Uuid;
  project_id: Uuid;
  wait_id: Uuid;
}
export interface GetPlanProgress {
  contract_version: "core/1.0";
  kind: "get_plan_progress";
  request_id: Uuid;
  project_id: Uuid;
  plan_execution_id: Uuid;
}
export interface Receipt {
  action_id: Uuid;
  receipt_ref: Ref;
  effect_state: "committed" | "pending_reconcile" | "rejected";
  observed_at: Timestamp;
}
export interface ServiceError {
  contract_version: "core/1.0";
  kind: "service_error";
  request_id: Uuid;
  project_id: Uuid;
  operation:
    | "apply_plan"
    | "control_plan"
    | "consume_wait"
    | "continuation_reply"
    | "read_action"
    | "register_wait"
    | "read_wait"
    | "get_plan_progress";
  code:
    | "UNSUPPORTED_CONTRACT"
    | "INVALID_REQUEST"
    | "NOT_FOUND_OR_DENIED"
    | "GRANT_REVOKED"
    | "PLAN_STALE"
    | "PLAN_CONFLICT"
    | "ACTION_PAYLOAD_CONFLICT"
    | "WAIT_CONFLICT"
    | "WAIT_STALE"
    | "CURSOR_EXPIRED"
    | "INPUT_REQUEST_STALE"
    | "EXECUTION_UNKNOWN"
    | "DISCLOSURE_APPROVAL_REQUIRED"
    | "BUDGET_UNAVAILABLE"
    | "DISCLOSURE_STALE"
    | "DELEGATION_EXPIRED"
    | "REASSIGNMENT_REQUIRES_HANDOFF"
    | "MODEL_CAPABILITY_UNAVAILABLE"
    | "MODEL_OUTPUT_INVALID"
    | "RETRIEVAL_INCOMPLETE"
    | "INDEX_STALE";
  retry_class: "never" | "after_refresh" | "after_reconcile";
  safe_message_key: string;
  evidence_ref: Ref | null;
}
