import { randomUUID } from "node:crypto";
import type { Store } from "./store.ts";
import { OwnerAuth, reject } from "./workspace-auth.ts";
import { validateCommand } from "./workspace-schema.ts";
import type { WorkspaceCommand } from "./workspace-schema.ts";
import { canonical, nextRevision } from "./domain.ts";
import { deliverMessage } from "./workspace-feed.ts";
export interface Project {
  id: string;
  name: string;
  description: string;
  public_channel_id: string;
  revision: string;
  created_at: string;
}
export interface Member {
  id: string;
  project_id: string;
  client: "codex" | "claude_desktop" | "deepseek_harness";
  name: string;
  role: string;
  state: "active" | "inactive";
  revision: string;
  created_at: string;
  connection: "not_connected";
}
export interface Message {
  id: string;
  project_id: string;
  channel_id: string;
  body: string;
  audience: "public" | "direct";
  recipient_id: string | null;
  created_at: string;
  recipient_name: string | null;
  delivery_state: "stored_not_dispatched";
}
export interface Draft {
  id: string;
  project_id: string;
  title: string;
  description: string;
  acceptance: string;
  assignee_id: string | null;
  state: "draft" | "archived";
  revision: string;
  created_at: string;
  updated_at: string;
}
export class WorkspaceService {
  readonly store: Store;
  readonly auth: OwnerAuth;
  readonly now: () => number;
  constructor(store: Store, now: () => number = Date.now) {
    this.store = store;
    this.now = now;
    this.auth = new OwnerAuth(store, now);
  }
  private timestamp() {
    return new Date(this.now()).toISOString();
  }
  private projectRow(id: string): Project {
    const r = this.store.db
      .prepare("SELECT * FROM workspace_projects WHERE id=?")
      .get(id);
    if (!r) reject(404, "NOT_FOUND_OR_DENIED");
    return r as unknown as Project;
  }
  private member(project: string, id: string, active = true): Member {
    const r = this.store.db
      .prepare("SELECT * FROM workspace_members WHERE id=? AND project_id=?")
      .get(id, project);
    if (!r) reject(404, "NOT_FOUND_OR_DENIED");
    if (active && r.state !== "active") reject(409, "MEMBER_INACTIVE");
    return { ...r, connection: "not_connected" } as unknown as Member;
  }
  private draft(project: string, id: string): Draft {
    const r = this.store.db
      .prepare("SELECT * FROM workspace_drafts WHERE id=? AND project_id=?")
      .get(id, project);
    if (!r) reject(404, "NOT_FOUND_OR_DENIED");
    return r as unknown as Draft;
  }
  private channel(
    project: string,
    audience: "public" | "direct",
    recipient: string | null,
  ): string {
    if (audience === "public")
      return this.projectRow(project).public_channel_id;
    const existing = this.store.db
      .prepare(
        "SELECT id FROM resources WHERE project_id=? AND kind='channel' AND json_extract(data,'$.recipient_id')=?",
      )
      .get(project, recipient);
    if (existing) return String(existing.id);
    const id = randomUUID();
    this.store.putResource({
      id,
      project_id: project,
      kind: "channel",
      revision: "1",
      domain: project + ":direct:" + recipient,
      acl: [],
      dependencies: [],
      data: { audience: "direct", recipient_id: recipient },
    });
    return id;
  }
  command(
    token: string,
    csrf: string,
    value: unknown,
  ): Project | Member | Message | Draft {
    this.auth.authorize(token, csrf);
    if (!validateCommand(value)) reject(400, "INVALID_REQUEST");
    return this.store.transaction(() => {
      this.auth.authorize(token, csrf);
      const fingerprint = canonical(value);
      const old = this.store.db
        .prepare("SELECT * FROM workspace_commands WHERE action_id=?")
        .get(value.action_id);
      if (old) {
        if (old.fingerprint !== fingerprint)
          reject(409, "ACTION_PAYLOAD_CONFLICT");
        return JSON.parse(String(old.result)) as
          Project | Member | Message | Draft;
      }
      if ("project_id" in value) this.projectRow(value.project_id);
      const result = this.apply(value);
      this.store.db
        .prepare("INSERT INTO workspace_commands VALUES(?,?,?)")
        .run(value.action_id, fingerprint, JSON.stringify(result));
      return result;
    });
  }
  private apply(q: WorkspaceCommand): Project | Member | Message | Draft {
    const now = this.timestamp();
    switch (q.kind) {
      case "create_project": {
        const p: Project = {
          id: randomUUID(),
          name: q.name.trim(),
          description: q.description.trim(),
          public_channel_id: randomUUID(),
          revision: "1",
          created_at: now,
        };
        this.store.db
          .prepare("INSERT INTO workspace_projects VALUES(?,?,?,?,?,?)")
          .run(
            p.id,
            p.name,
            p.description,
            p.public_channel_id,
            p.revision,
            p.created_at,
          );
        this.store.putResource({
          id: p.public_channel_id,
          project_id: p.id,
          kind: "channel",
          revision: "1",
          domain: p.id + ":public",
          acl: [],
          dependencies: [],
          data: { audience: "public", recipient_id: null },
        });
        return p;
      }
      case "add_member": {
        if (
          this.store.db
            .prepare(
              "SELECT 1 FROM workspace_members WHERE project_id=? AND name=?",
            )
            .get(q.project_id, q.name.trim())
        )
          reject(409, "MEMBER_NAME_EXISTS");
        const id = randomUUID();
        this.store.db
          .prepare("INSERT INTO workspace_members VALUES(?,?,?,?,?,?,?,?)")
          .run(
            id,
            q.project_id,
            q.client,
            q.name.trim(),
            q.role.trim(),
            "active",
            "1",
            now,
          );
        return this.member(q.project_id, id);
      }
      case "update_member": {
        const m = this.member(q.project_id, q.member_id, false);
        if (m.revision !== q.expected_revision)
          reject(409, "REVISION_CONFLICT");
        if (
          this.store.db
            .prepare(
              "SELECT 1 FROM workspace_members WHERE project_id=? AND name=? AND id<>?",
            )
            .get(q.project_id, q.name.trim(), m.id)
        )
          reject(409, "MEMBER_NAME_EXISTS");
        this.store.db
          .prepare(
            "UPDATE workspace_members SET name=?,role=?,revision=? WHERE id=?",
          )
          .run(q.name.trim(), q.role.trim(), nextRevision(m.revision), m.id);
        return this.member(q.project_id, m.id, false);
      }
      case "set_member_state": {
        const m = this.member(q.project_id, q.member_id, false);
        if (m.revision !== q.expected_revision)
          reject(409, "REVISION_CONFLICT");
        this.store.db
          .prepare("UPDATE workspace_members SET state=?,revision=? WHERE id=?")
          .run(q.state, nextRevision(m.revision), m.id);
        if (q.state === "inactive") {
          this.store.db
            .prepare(
              "UPDATE feed_bindings SET state='revoked' WHERE member_id=?",
            )
            .run(m.id);
          const grants = this.store.db
            .prepare(
              "SELECT id FROM grants WHERE project_id=? AND json_extract(data,'$.member_id')=?",
            )
            .all(q.project_id, m.id);
          for (const row of grants) {
            const g = this.store.getGrant(String(row.id))!;
            this.store.updateGrant({ ...g, state: "revoked" });
          }
        }
        return this.member(q.project_id, m.id, false);
      }
      case "send_message": {
        if (
          (q.audience === "public" && q.recipient_id !== null) ||
          (q.audience === "direct" && q.recipient_id === null)
        )
          reject(400, "INVALID_REQUEST");
        if (q.recipient_id) this.member(q.project_id, q.recipient_id);
        const id = randomUUID(),
          channel = this.channel(q.project_id, q.audience, q.recipient_id);
        this.store.db
          .prepare(
            "INSERT INTO workspace_messages(id,project_id,channel_id,body,audience,recipient_id,created_at) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            id,
            q.project_id,
            channel,
            q.body.trim(),
            q.audience,
            q.recipient_id,
            now,
          );
        this.store.db
          .prepare(
            "INSERT INTO workspace_outbox(id,project_id,kind,payload,created_at) VALUES(?,?,?,?,?)",
          )
          .run(
            randomUUID(),
            q.project_id,
            "ordinary_message_stored",
            JSON.stringify({ message_id: id, channel_id: channel }),
            now,
          );
        const message = this.messageById(id);
        deliverMessage(this.store, message, this.now());
        return message;
      }
      case "create_draft": {
        if (q.assignee_id) this.member(q.project_id, q.assignee_id);
        const id = randomUUID();
        this.store.db
          .prepare(
            "INSERT INTO workspace_drafts(id,project_id,title,description,acceptance,assignee_id,state,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            id,
            q.project_id,
            q.title.trim(),
            q.description.trim(),
            q.acceptance.trim(),
            q.assignee_id,
            "draft",
            "1",
            now,
            now,
          );
        return this.draft(q.project_id, id);
      }
      case "update_draft": {
        const t = this.draft(q.project_id, q.task_id);
        if (t.state !== "draft") reject(409, "DRAFT_ARCHIVED");
        if (t.revision !== q.expected_revision)
          reject(409, "REVISION_CONFLICT");
        if (q.assignee_id) this.member(q.project_id, q.assignee_id);
        this.store.db
          .prepare(
            "UPDATE workspace_drafts SET title=?,description=?,acceptance=?,assignee_id=?,revision=?,updated_at=? WHERE id=?",
          )
          .run(
            q.title.trim(),
            q.description.trim(),
            q.acceptance.trim(),
            q.assignee_id,
            nextRevision(t.revision),
            now,
            t.id,
          );
        return this.draft(q.project_id, t.id);
      }
      case "restore_draft": {
        const t = this.draft(q.project_id, q.task_id);
        if (t.state !== "archived") reject(409, "REVISION_CONFLICT");
        if (t.revision !== q.expected_revision)
          reject(409, "REVISION_CONFLICT");
        this.store.db
          .prepare(
            "UPDATE workspace_drafts SET state='draft',revision=?,updated_at=? WHERE id=?",
          )
          .run(nextRevision(t.revision), now, t.id);
        return this.draft(q.project_id, t.id);
      }
      case "archive_draft": {
        const t = this.draft(q.project_id, q.task_id);
        if (t.state !== "draft") reject(409, "DRAFT_ARCHIVED");
        if (t.revision !== q.expected_revision)
          reject(409, "REVISION_CONFLICT");
        this.store.db
          .prepare(
            "UPDATE workspace_drafts SET state='archived',revision=?,updated_at=? WHERE id=?",
          )
          .run(nextRevision(t.revision), now, t.id);
        return this.draft(q.project_id, t.id);
      }
    }
  }
  projects(token: string): Project[] {
    this.auth.authorize(token);
    return this.store.db
      .prepare(
        "SELECT * FROM workspace_projects ORDER BY created_at DESC,rowid DESC",
      )
      .all() as unknown as Project[];
  }
  project(token: string, id: string) {
    this.auth.authorize(token);
    const project = this.projectRow(id);
    const members = this.store.db
      .prepare(
        "SELECT * FROM workspace_members WHERE project_id=? ORDER BY created_at,rowid",
      )
      .all(id)
      .map((r) => ({
        ...r,
        connection: "not_connected",
      })) as unknown as Member[];
    const tasks = this.store.db
      .prepare(
        "SELECT * FROM workspace_drafts WHERE project_id=? ORDER BY created_at DESC,rowid DESC",
      )
      .all(id) as unknown as Draft[];
    const messages = this.messages(token, id);
    return {
      project,
      members,
      tasks,
      messages,
      progress: {
        registered_members: members.filter((m) => m.state === "active").length,
        connected_members: 0,
        draft_tasks: tasks.filter((t) => t.state === "draft").length,
        archived_tasks: tasks.filter((t) => t.state === "archived").length,
        execution_enabled: false,
        model_calls: 0,
        observed_at: this.timestamp(),
      },
    };
  }
  private messageById(id: string): Message {
    const r = this.store.db
      .prepare(
        "SELECT m.id,m.project_id,m.channel_id,m.body,m.audience,m.recipient_id,m.created_at,u.name recipient_name FROM workspace_messages m LEFT JOIN workspace_members u ON u.id=m.recipient_id WHERE m.id=?",
      )
      .get(id);
    if (!r) throw new Error("Message missing after insert");
    return {
      ...r,
      delivery_state: "stored_not_dispatched",
    } as unknown as Message;
  }
  messages(token: string, project: string, before?: string) {
    this.auth.authorize(token);
    this.projectRow(project);
    let position = Number.MAX_SAFE_INTEGER;
    if (before) {
      const row = this.store.db
        .prepare(
          "SELECT sequence FROM workspace_messages WHERE id=? AND project_id=?",
        )
        .get(before, project);
      if (!row) reject(404, "NOT_FOUND_OR_DENIED");
      position = Number(row.sequence);
    }
    const rows = this.store.db
      .prepare(
        "SELECT id FROM workspace_messages WHERE project_id=? AND sequence<? ORDER BY sequence DESC LIMIT 51",
      )
      .all(project, position);
    const visible = rows
      .slice(0, 50)
      .reverse()
      .map((r) => this.messageById(String(r.id)));
    return { items: visible, before: rows.length > 50 ? visible[0]!.id : null };
  }
  search(token: string, project: string, query: string) {
    this.auth.authorize(token);
    this.projectRow(project);
    if (!query.trim() || Array.from(query).length > 200)
      reject(400, "INVALID_REQUEST");
    const escaped = query.replace(/[!%_]/g, (c) => "!" + c);
    const rows = this.store.db
      .prepare(
        "SELECT id FROM workspace_messages WHERE project_id=? AND body LIKE ? ESCAPE '!' ORDER BY sequence DESC LIMIT 51",
      )
      .all(project, "%" + escaped + "%");
    return {
      items: rows
        .slice(0, 50)
        .reverse()
        .map((r) => this.messageById(String(r.id))),
      truncated: rows.length > 50,
    };
  }
}
