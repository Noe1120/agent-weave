/* Generated from plan/contracts. Do not edit. */

export type WorkspaceCommand =
  | CreateProject
  | AddMember
  | SetMemberState
  | SendMessage
  | CreateDraft
  | UpdateDraft
  | ArchiveDraft
  | UpdateMember
  | RestoreDraft;

export interface CreateProject {
  kind: "create_project";
  action_id: string;
  name: string;
  description: string;
}
export interface AddMember {
  kind: "add_member";
  action_id: string;
  project_id: string;
  client: "codex" | "claude_desktop" | "deepseek_harness";
  name: string;
  role: string;
}
export interface SetMemberState {
  kind: "set_member_state";
  action_id: string;
  project_id: string;
  member_id: string;
  expected_revision: string;
  state: "active" | "inactive";
}
export interface SendMessage {
  kind: "send_message";
  action_id: string;
  project_id: string;
  body: string;
  audience: "public" | "direct";
  recipient_id: string | null;
}
export interface CreateDraft {
  kind: "create_draft";
  action_id: string;
  project_id: string;
  title: string;
  description: string;
  acceptance: string;
  assignee_id: string | null;
}
export interface UpdateDraft {
  kind: "update_draft";
  action_id: string;
  project_id: string;
  task_id: string;
  expected_revision: string;
  title: string;
  description: string;
  acceptance: string;
  assignee_id: string | null;
}
export interface ArchiveDraft {
  kind: "archive_draft";
  action_id: string;
  project_id: string;
  task_id: string;
  expected_revision: string;
}
export interface UpdateMember {
  kind: "update_member";
  action_id: string;
  project_id: string;
  member_id: string;
  expected_revision: string;
  name: string;
  role: string;
}
export interface RestoreDraft {
  kind: "restore_draft";
  action_id: string;
  project_id: string;
  task_id: string;
  expected_revision: string;
}
