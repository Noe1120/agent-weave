import { timingSafeEqual } from "node:crypto";
import workspaceSchema from "../../contracts/src/generated/workspace.schema.json" with { type: "json" };
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type { Store } from "./store.ts";
import type { Context } from "./domain.ts";
import { authenticate, authorizeGrant, requireResource } from "./auth.ts";
import { ServiceFault, fail } from "./errors.ts";
import { OwnerAuth, reject, WorkspaceFault } from "./workspace-auth.ts";
interface Binding {
  grant_id: string;
  project_id: string;
  member_id: string;
  channel_id: string;
  next_position: number;
  state: string;
}
const ajv = new Ajv2020({ strict: true });
(addFormatsModule as unknown as (a: Ajv2020) => void)(ajv);
const validate = ajv.compile(workspaceSchema.$defs.feed_request);
function memberAllowed(s: Store, c: Context, channel: string) {
  const member = s.db
    .prepare(
      "SELECT id FROM workspace_members WHERE id=? AND project_id=? AND state='active'",
    )
    .get(c.grant.member_id, c.grant.project_id);
  if (!member) fail("NOT_FOUND_OR_DENIED");
  const r = requireResource(s, c, channel, "channel");
  if (r.data.audience === "direct" && r.data.recipient_id !== c.grant.member_id)
    fail("NOT_FOUND_OR_DENIED");
  return r;
}
export function deliverMessage(
  s: Store,
  message: {
    id: string;
    project_id: string;
    channel_id: string;
    recipient_id: string | null;
  },
  now: number,
): void {
  const bindings = s.db
    .prepare(
      "SELECT * FROM feed_bindings WHERE project_id=? AND channel_id=? AND state='active'",
    )
    .all(message.project_id, message.channel_id) as unknown as Binding[];
  for (const binding of bindings) {
    const grant = s.getGrant(binding.grant_id);
    if (!grant) continue;
    try {
      const c = authorizeGrant(s, grant, message.project_id, "read_feed", now);
      memberAllowed(s, c, binding.channel_id);
      if (
        binding.member_id !== grant.member_id ||
        (message.recipient_id !== null &&
          message.recipient_id !== grant.member_id)
      )
        continue;
    } catch (e) {
      if (e instanceof ServiceFault) continue;
      throw e;
    }
    const position = binding.next_position + 1;
    s.db
      .prepare("INSERT INTO message_deliveries VALUES(?,?,?)")
      .run(binding.grant_id, position, message.id);
    s.db
      .prepare("UPDATE feed_bindings SET next_position=? WHERE grant_id=?")
      .run(position, binding.grant_id);
  }
}
export class ExecutionFeed {
  readonly store: Store;
  readonly now: () => number;
  private signer: OwnerAuth;
  constructor(store: Store, now: () => number = Date.now) {
    this.store = store;
    this.now = now;
    this.signer = new OwnerAuth(store, now);
  }
  // Trusted connector registration only. No HTTP endpoint can mint or bind grants.
  bind(grantId: string, channel: string): void {
    this.store.transaction(() => {
      const g = this.store.getGrant(grantId);
      if (!g) fail("NOT_FOUND_OR_DENIED");
      const c = authorizeGrant(
        this.store,
        g,
        g.project_id,
        "read_feed",
        this.now(),
      );
      memberAllowed(this.store, c, channel);
      const existing = this.store.db
        .prepare("SELECT * FROM feed_bindings WHERE grant_id=?")
        .get(g.id);
      if (existing) {
        if (existing.channel_id !== channel || existing.state !== "active")
          fail("NOT_FOUND_OR_DENIED");
        return;
      }
      this.store.db
        .prepare(
          "INSERT INTO feed_bindings(grant_id,project_id,member_id,channel_id,state) VALUES(?,?,?,?,'active')",
        )
        .run(g.id, g.project_id, g.member_id, channel);
    });
  }
  read(token: string, value: unknown) {
    if (!validate(value)) reject(400, "INVALID_REQUEST");
    const q = value as {
      project_id: string;
      cursor: string | null;
      limit: number;
    };
    return this.store.transaction(() => {
      const c = authenticate(
        this.store,
        token,
        q.project_id,
        "read_feed",
        this.now(),
      );
      const b = this.store.db
        .prepare(
          "SELECT * FROM feed_bindings WHERE grant_id=? AND project_id=? AND state='active'",
        )
        .get(c.grant.id, q.project_id) as unknown as Binding | undefined;
      if (!b || b.member_id !== c.grant.member_id) fail("NOT_FOUND_OR_DENIED");
      memberAllowed(this.store, c, b.channel_id);
      let after = 0;
      if (q.cursor) {
        const parts = q.cursor.split(".");
        if (parts.length !== 2) reject(409, "CURSOR_INVALID");
        const [payload, signature] = parts as [string, string];
        const actual = Buffer.from(signature),
          expected = Buffer.from(this.signer.sign("feed:" + payload));
        if (
          actual.length !== expected.length ||
          !timingSafeEqual(actual, expected)
        )
          reject(409, "CURSOR_INVALID");
        let parsed: unknown;
        try {
          parsed = JSON.parse(
            Buffer.from(payload, "base64url").toString("utf8"),
          );
        } catch {
          reject(409, "CURSOR_INVALID");
        }
        const p = parsed as {
          grant: string;
          channel: string;
          after: number;
          expires: number;
        };
        if (
          !p ||
          p.grant !== c.grant.id ||
          p.channel !== b.channel_id ||
          !Number.isSafeInteger(p.after) ||
          p.after < 0 ||
          !Number.isSafeInteger(p.expires)
        )
          reject(409, "CURSOR_INVALID");
        if (p.expires <= this.now()) reject(409, "CURSOR_EXPIRED");
        after = p.after;
      }
      const rows = this.store.db
        .prepare(
          "SELECT d.position,m.id,m.body,m.audience,m.recipient_id,m.created_at,m.channel_id FROM message_deliveries d JOIN workspace_messages m ON m.id=d.message_id WHERE d.grant_id=? AND d.position>? AND m.project_id=? AND m.channel_id=? ORDER BY d.position LIMIT ?",
        )
        .all(c.grant.id, after, q.project_id, b.channel_id, q.limit);
      const position = rows.length ? Number(rows.at(-1)!.position) : after;
      const encoded = Buffer.from(
        JSON.stringify({
          grant: c.grant.id,
          channel: b.channel_id,
          after: position,
          expires: this.now() + 86400000,
        }),
      ).toString("base64url");
      return {
        contract_version: "feed/0.1",
        items: rows.map((r) => ({
          id: String(r.id),
          body: String(r.body),
          audience: String(r.audience),
          recipient_id: r.recipient_id === null ? null : String(r.recipient_id),
          created_at: String(r.created_at),
          input_kind: "ordinary_instruction",
          dispatch_state: "not_dispatched",
        })),
        next_cursor: encoded + "." + this.signer.sign("feed:" + encoded),
      };
    });
  }
}
