/* Generated from plan/contracts. Do not edit. */

export type ResourceResult =
  | {
      contract_version: "resource/0.1";
      kind: "resource_result";
      project_id: Uuid;
      resource_type: "grant";
      ref: Ref;
      data: Grant;
    }
  | {
      contract_version: "resource/0.1";
      kind: "resource_result";
      project_id: Uuid;
      resource_type: "input_request";
      ref: Ref;
      data: InputRequest;
    }
  | {
      contract_version: "resource/0.1";
      kind: "resource_result";
      project_id: Uuid;
      resource_type: "changeset";
      ref: Ref;
      data: Changeset;
    }
  | {
      contract_version: "resource/0.1";
      kind: "resource_result";
      project_id: Uuid;
      resource_type: "root";
      ref: Ref;
      data: Root;
    }
  | {
      contract_version: "resource/0.1";
      kind: "resource_result";
      project_id: Uuid;
      resource_type: "environment";
      ref: Ref;
      data: Environment;
    }
  | {
      contract_version: "resource/0.1";
      kind: "resource_result";
      project_id: Uuid;
      resource_type: "acceptance";
      ref: Ref;
      data: Acceptance;
    }
  | {
      contract_version: "resource/0.1";
      kind: "resource_result";
      project_id: Uuid;
      resource_type: "task";
      ref: Ref;
      data: Task;
    };
export type Uuid = string;
export type Revision = string;
export type Epoch = string;
export type Timestamp = string;

export interface Ref {
  id: Uuid;
  revision: Revision;
}
export interface Grant {
  member_id: Uuid;
  run_id: Uuid;
  run_epoch: Epoch;
  state: "active" | "revoked";
  expires_at: Timestamp;
}
export interface InputRequest {
  run_id: Uuid;
  run_epoch: Epoch;
  kind: "clarification" | "approval";
  state: "pending" | "answered" | "cancelled";
  expires_at: Timestamp;
}
export interface Changeset {
  producer_run_id: Uuid;
  base_commit: string;
  source_commit: string;
  tree_digest: string;
  readiness: "draft" | "ready";
  review_state: "pending" | "approved" | "rejected";
  validity: "valid" | "invalidated";
}
export interface Root {
  state: "active" | "suspected_stall" | "expansion_paused" | "draining" | "completed" | "cancelled";
  budget_limit: Revision;
  budget_reserved: Revision;
}
export interface Environment {
  state: "pending" | "verified" | "invalidated";
  digest: string;
}
export interface Acceptance {
  state: "draft" | "confirmed" | "superseded";
  criteria_refs: Ref[];
}
export interface Task {
  status: "draft" | "queued" | "running" | "in_review" | "ready_to_merge" | "completed" | "cancelled";
  candidate_ref: Ref | null;
  inputs_valid: boolean;
  acceptance_ref: Ref;
}
