import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store } from "../packages/service/src/store.ts";
import { WorkspaceService } from "../packages/service/src/workspace-service.ts";
function setup() {
  const store = new Store();
  const w = new WorkspaceService(store);
  const p = w.auth.newPairing();
  const session = w.auth.pair(p.code);
  const call = (kind: string, extra: Record<string, unknown> = {}) =>
    w.command(session.token, session.csrf, {
      kind,
      action_id: randomUUID(),
      ...extra,
    }) as any;
  return { store, w, session, call };
}
test("owner creates persistent project, offline members, public/direct ordinary messages and task drafts", () => {
  const f = setup();
  try {
    const p = f.call("create_project", {
      name: "试验项目",
      description: "纯本地",
    });
    assert.equal(f.w.projects(f.session.token).length, 1);
    const m = f.call("add_member", {
      project_id: p.id,
      client: "claude_desktop",
      name: "Claude Desktop",
      role: "评审",
    });
    assert.equal(m.connection, "not_connected");
    const message = f.call("send_message", {
      project_id: p.id,
      body: "<script>alert(1)</script>",
      audience: "direct",
      recipient_id: m.id,
    });
    assert.equal(message.body, "<script>alert(1)</script>");
    assert.equal(message.delivery_state, "stored_not_dispatched");
    const task = f.call("create_draft", {
      project_id: p.id,
      title: "设计任务",
      description: "先列提案",
      acceptance: "检查输出",
      assignee_id: m.id,
    });
    assert.equal(task.state, "draft");
    const view = f.w.project(f.session.token, p.id);
    assert.equal(view.progress.connected_members, 0);
    assert.equal(view.progress.draft_tasks, 1);
    assert.equal(view.tasks[0]!.revision, "1");
    assert.equal(
      f.store.db.prepare("SELECT count(*) n FROM continuation_inbox").get()!.n,
      0,
    );
  } finally {
    f.store.close();
  }
});
test("all writes require owner session and csrf; payload actor fields are rejected", () => {
  const f = setup();
  try {
    const command = {
      kind: "create_project",
      action_id: randomUUID(),
      name: "A",
      description: "",
    };
    assert.throws(
      () => f.w.command("", f.session.csrf, command),
      /SESSION_REQUIRED/,
    );
    assert.throws(
      () => f.w.command(f.session.token, "", command),
      /CSRF_REJECTED/,
    );
    assert.throws(
      () =>
        f.w.command(f.session.token, f.session.csrf, {
          ...command,
          actor_id: randomUUID(),
        }),
      /INVALID_REQUEST/,
    );
    assert.equal(f.w.projects(f.session.token).length, 0);
  } finally {
    f.store.close();
  }
});
test("command retries are idempotent, different payload conflicts and DB fault rolls back all effects", () => {
  const f = setup();
  try {
    const c = {
      kind: "create_project",
      action_id: randomUUID(),
      name: "A",
      description: "",
    };
    const first = f.w.command(f.session.token, f.session.csrf, c);
    assert.deepEqual(f.w.command(f.session.token, f.session.csrf, c), first);
    assert.throws(
      () => f.w.command(f.session.token, f.session.csrf, { ...c, name: "B" }),
      /ACTION_PAYLOAD_CONFLICT/,
    );
    f.store.db.exec(
      "CREATE TRIGGER reject_workspace_action BEFORE INSERT ON workspace_commands BEGIN SELECT RAISE(ABORT,'synthetic ledger failure'); END;",
    );
    assert.throws(
      () => f.call("create_project", { name: "C", description: "" }),
      /ledger failure/,
    );
    assert.equal(f.w.projects(f.session.token).length, 1);
  } finally {
    f.store.close();
  }
});
test("cross-project recipients/tasks and disabled recipients fail closed, query is read only", () => {
  const f = setup();
  try {
    const p = f.call("create_project", { name: "A", description: "" }),
      other = f.call("create_project", { name: "B", description: "" });
    const m = f.call("add_member", {
      project_id: p.id,
      client: "codex",
      name: "Codex",
      role: "",
    });
    assert.throws(
      () =>
        f.call("send_message", {
          project_id: other.id,
          body: "secret",
          audience: "direct",
          recipient_id: m.id,
        }),
      /NOT_FOUND_OR_DENIED/,
    );
    f.call("set_member_state", {
      project_id: p.id,
      member_id: m.id,
      expected_revision: "1",
      state: "inactive",
    });
    assert.throws(
      () =>
        f.call("send_message", {
          project_id: p.id,
          body: "secret",
          audience: "direct",
          recipient_id: m.id,
        }),
      /MEMBER_INACTIVE/,
    );
    const before = f.store.db.prepare("SELECT total_changes() n").get()!.n;
    f.w.project(f.session.token, p.id);
    f.w.messages(f.session.token, p.id);
    f.w.search(f.session.token, p.id, "secret");
    assert.equal(
      f.store.db.prepare("SELECT total_changes() n").get()!.n,
      before,
    );
    assert.equal(f.w.messages(f.session.token, other.id).items.length, 0);
  } finally {
    f.store.close();
  }
});
test("draft edit is CAS protected, cannot pretend it ran or passed acceptance, archive does not destroy history", () => {
  const f = setup();
  try {
    const p = f.call("create_project", { name: "A", description: "" });
    const t = f.call("create_draft", {
      project_id: p.id,
      title: "任务",
      description: "",
      acceptance: "",
      assignee_id: null,
    });
    const updated = f.call("update_draft", {
      project_id: p.id,
      task_id: t.id,
      expected_revision: "1",
      title: "修改后",
      description: "描述",
      acceptance: "人工检查",
      assignee_id: null,
    });
    assert.equal(updated.revision, "2");
    assert.throws(
      () =>
        f.call("archive_draft", {
          project_id: p.id,
          task_id: t.id,
          expected_revision: "1",
        }),
      /REVISION_CONFLICT/,
    );
    const archived = f.call("archive_draft", {
      project_id: p.id,
      task_id: t.id,
      expected_revision: "2",
    });
    assert.equal(archived.state, "archived");
    assert.equal(f.w.project(f.session.token, p.id).tasks.length, 1);
  } finally {
    f.store.close();
  }
});
test("message history uses stable pages and search treats wildcard symbols literally", () => {
  const f = setup();
  try {
    const p = f.call("create_project", { name: "A", description: "" });
    for (let i = 0; i < 55; i++)
      f.call("send_message", {
        project_id: p.id,
        body: "第" + i + "条" + (i === 0 ? " 100% _" : ""),
        audience: "public",
        recipient_id: null,
      });
    const page = f.w.messages(f.session.token, p.id);
    assert.equal(page.items.length, 50);
    assert.ok(page.before);
    const older = f.w.messages(f.session.token, p.id, page.before);
    assert.equal(older.items.length, 5);
    assert.equal(older.before, null);
    assert.equal(
      new Set([...page.items, ...older.items].map((m: any) => m.id)).size,
      55,
    );
    assert.equal(f.w.search(f.session.token, p.id, "%").items.length, 1);
  } finally {
    f.store.close();
  }
});

test("owner can correct member role and restore archived draft without inventing execution", () => {
  const f = setup();
  try {
    const p = f.call("create_project", { name: "可修正流程", description: "" });
    const m = f.call("add_member", {
      project_id: p.id,
      client: "codex",
      name: "Codex",
      role: "旧职责",
    });
    const edit = f.call("update_member", {
      project_id: p.id,
      member_id: m.id,
      expected_revision: "1",
      name: "Codex 主程",
      role: "新职责",
    });
    assert.equal(edit.role, "新职责");
    const t = f.call("create_draft", {
      project_id: p.id,
      title: "可恢复",
      description: "",
      acceptance: "",
      assignee_id: m.id,
    });
    f.call("archive_draft", {
      project_id: p.id,
      task_id: t.id,
      expected_revision: "1",
    });
    const restored = f.call("restore_draft", {
      project_id: p.id,
      task_id: t.id,
      expected_revision: "2",
    });
    assert.equal(restored.state, "draft");
    assert.equal(restored.revision, "3");
  } finally {
    f.store.close();
  }
});
