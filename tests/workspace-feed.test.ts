import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store } from "../packages/service/src/store.ts";
import { WorkspaceService } from "../packages/service/src/workspace-service.ts";
import { ExecutionFeed } from "../packages/service/src/workspace-feed.ts";
import type { Grant, Policy } from "../packages/service/src/domain.ts";
function setup() {
  const s = new Store();
  let now = Date.now();
  const w = new WorkspaceService(s, () => now);
  const owner = w.auth.pair(w.auth.newPairing().code);
  const call = (kind: string, extra: object) =>
    w.command(owner.token, owner.csrf, {
      kind,
      action_id: randomUUID(),
      ...extra,
    }) as any;
  const p = call("create_project", { name: "scope", description: "" });
  const m = call("add_member", {
    project_id: p.id,
    client: "codex",
    name: "Codex",
    role: "",
  });
  const feed = new ExecutionFeed(s, () => now);
  const message = (body: string, audience = "public") =>
    call("send_message", {
      project_id: p.id,
      body,
      audience,
      recipient_id: audience === "direct" ? m.id : null,
    });
  const bind = (channel: string) => {
    const r = s.getResource(channel)!;
    const g: Grant = {
      id: randomUUID(),
      project_id: p.id,
      member_id: m.id,
      policy_id: randomUUID(),
      policy_revision: "1",
      run_id: randomUUID(),
      run_epoch: "1",
      native_binding: randomUUID(),
      domain: r.domain,
      actions: ["read_feed"],
      resource_ids: [channel],
      state: "active",
      expires_at: new Date(now + 86400000).toISOString(),
    };
    const policy: Policy = {
      id: g.policy_id,
      project_id: p.id,
      member_id: m.id,
      revision: "1",
      active: true,
      actions: ["read_feed"],
      resource_ids: [channel],
    };
    s.putPolicy(policy);
    s.putRun({
      id: g.run_id,
      project_id: p.id,
      epoch: "1",
      native_binding: g.native_binding,
      state: "active",
    });
    r.acl.push(g.id);
    s.putResource(r);
    const token = s.issueGrant(g);
    feed.bind(g.id, channel);
    return { g, token };
  };
  const read = (token: string, cursor: string | null = null, limit = 50) =>
    feed.read(token, { project_id: p.id, cursor, limit });
  return {
    s,
    w,
    owner,
    call,
    p,
    m,
    feed,
    message,
    bind,
    read,
    advance: (ms: number) => (now += ms),
  };
}
test("execution feed isolates same member private A/public B and never inherits pre-binding history", () => {
  const f = setup();
  try {
    const old = f.message("old private", "direct");
    const a = f.bind(old.channel_id),
      b = f.bind(f.p.public_channel_id);
    f.message("new private", "direct");
    f.message("public");
    assert.deepEqual(
      f.read(a.token).items.map((m: any) => m.body),
      ["new private"],
    );
    assert.deepEqual(
      f.read(b.token).items.map((m: any) => m.body),
      ["public"],
    );
    const c = f.bind(old.channel_id);
    assert.equal(f.read(c.token).items.length, 0);
    assert.equal(
      f.s.db.prepare("SELECT count(*) n FROM continuation_inbox").get()!.n,
      0,
    );
  } finally {
    f.s.close();
  }
});
test("feed cursor is bound to grant/channel, stable paging has no hidden activity counts", () => {
  const f = setup();
  try {
    const a = f.bind(f.p.public_channel_id),
      b = f.bind(f.p.public_channel_id);
    f.message("one");
    f.message("two");
    const first = f.read(a.token, null, 1);
    assert.equal(first.items.length, 1);
    assert.deepEqual(
      f.read(a.token, first.next_cursor, 1).items.map((m: any) => m.body),
      ["two"],
    );
    assert.throws(() => f.read(b.token, first.next_cursor), /CURSOR_INVALID/);
    assert.throws(
      () => f.read(a.token, first.next_cursor + "x"),
      /CURSOR_INVALID/,
    );
    f.advance(86400001);
    assert.throws(
      () => f.read(a.token, first.next_cursor),
      /GRANT_REVOKED|CURSOR_EXPIRED/,
    );
  } finally {
    f.s.close();
  }
});
test("every replay enforces current ACL, native binding, policy, grant and member revocation", () => {
  for (const mutation of ["acl", "native", "policy", "grant", "member"]) {
    const f = setup();
    try {
      const a = f.bind(f.p.public_channel_id);
      f.message("visible");
      const page = f.read(a.token);
      assert.equal(page.items.length, 1);
      if (mutation === "acl") {
        const r = f.s.getResource(f.p.public_channel_id)!;
        r.acl = [];
        f.s.putResource(r);
      }
      if (mutation === "native")
        f.s.putRun({ ...f.s.getRun(a.g.run_id)!, native_binding: "changed" });
      if (mutation === "policy")
        f.s.putPolicy({ ...f.s.getPolicy(a.g.policy_id)!, actions: [] });
      if (mutation === "grant") f.s.updateGrant({ ...a.g, state: "revoked" });
      if (mutation === "member")
        f.call("set_member_state", {
          project_id: f.p.id,
          member_id: f.m.id,
          expected_revision: "1",
          state: "inactive",
        });
      assert.throws(() => f.read(a.token), /NOT_FOUND_OR_DENIED|GRANT_REVOKED/);
    } finally {
      f.s.close();
    }
  }
});
test("delivery insert fault rolls back message, outbox and action together", () => {
  const f = setup();
  try {
    f.bind(f.p.public_channel_id);
    f.s.db.exec(
      "CREATE TRIGGER fail_delivery BEFORE INSERT ON message_deliveries BEGIN SELECT RAISE(ABORT,'synthetic delivery failure'); END;",
    );
    assert.throws(() => f.message("must rollback"), /delivery failure/);
    assert.equal(
      f.s.db.prepare("SELECT count(*) n FROM workspace_messages").get()!.n,
      0,
    );
    assert.equal(
      f.s.db.prepare("SELECT count(*) n FROM workspace_outbox").get()!.n,
      0,
    );
  } finally {
    f.s.close();
  }
});

test("feed rejects malformed envelopes and expired cursors independently of grant expiry", () => {
  const f = setup();
  try {
    const a = f.bind(f.p.public_channel_id);
    f.s.updateGrant({
      ...a.g,
      expires_at: new Date(Date.parse(a.g.expires_at) + 86400000).toISOString(),
    });
    for (const value of [
      null,
      {},
      { project_id: f.p.id, cursor: null, limit: 0 },
      { project_id: f.p.id, cursor: null, limit: 101 },
      { project_id: f.p.id, cursor: null, limit: 1, member_id: f.m.id },
    ])
      assert.throws(() => f.feed.read(a.token, value), /INVALID_REQUEST/);
    const cursor = f.read(a.token).next_cursor;
    f.advance(86400001);
    assert.throws(() => f.read(a.token, cursor), /CURSOR_EXPIRED/);
    assert.equal(f.read(a.token).items.length, 0);
  } finally {
    f.s.close();
  }
});

test("non-ASCII cursor signature rejects as invalid instead of crashing constant-time comparison", () => {
  const f = setup();
  try {
    const a = f.bind(f.p.public_channel_id);
    const cursor = f.read(a.token).next_cursor;
    const [payload, signature] = cursor.split(".");
    assert.throws(
      () => f.read(a.token, payload + "." + "é".repeat(signature!.length)),
      /CURSOR_INVALID/,
    );
  } finally {
    f.s.close();
  }
});
