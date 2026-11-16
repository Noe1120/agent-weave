import { randomUUID, timingSafeEqual } from "node:crypto";
import { canonical, nextRevision, type Resource } from "./domain.ts";
import { fingerprint, revision, uuid } from "./adapter-contract.ts";
import { digest } from "./store.ts";
import { reject } from "./workspace-auth.ts";
import type { WorkspaceService, Member } from "./workspace-service.ts";

interface Registration {
  member_id: string;
  member_revision: string;
  target: Member["client"];
  configuration_fingerprint: string;
  state: "pending" | "registered" | "revoked";
  created_at: number;
  invite_expires: number;
  expires: number;
  key_digest: string;
  invite_action: string;
  invite_payload: string;
  invite_hash: string;
  redeem_action: string | null;
  connection_hash: string | null;
  revoke_action: string | null;
  revoke_payload: string | null;
  replaces_connection_id?: string;
  replaced_by_connection_id?: string;
  replacement_action?: string;
  replacement_payload?: string;
}
const kind = "connection_registration";
function fields(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    reject(400, "INVALID_REQUEST");
  const q = value as Record<string, unknown>;
  if (
    Object.keys(q).length !== keys.length ||
    !keys.every((k) => Object.hasOwn(q, k))
  )
    reject(400, "INVALID_REQUEST");
  return q;
}
function sameToken(token: string, hash: string | null) {
  return (
    hash !== null &&
    timingSafeEqual(Buffer.from(digest(token)), Buffer.from(hash))
  );
}
/** Registration credentials are NOT execution grants or proof of a native connection. */
export class ConnectionRegistry {
  private readonly w: WorkspaceService;
  constructor(workspace: WorkspaceService) {
    this.w = workspace;
  }
  private member(project: string, member: string): Member | undefined {
    return this.w.store.db
      .prepare("SELECT * FROM workspace_members WHERE project_id=? AND id=?")
      .get(project, member) as unknown as Member | undefined;
  }
  private keyDigest() {
    const key = this.w.store.db
      .prepare("SELECT value FROM console_secrets WHERE name='signing_key'")
      .get();
    return key ? digest(String(key.value)) : null;
  }
  private credential(r: Resource<Registration>, type: "invite" | "connection") {
    return this.w.auth.sign(
      `connection-registration/1:${type}:${r.id}:${r.data.invite_action}`,
    );
  }
  private load(id: string) {
    const r = this.w.store.getResource<Registration>(id);
    return r?.kind === kind ? r : undefined;
  }
  private state(r: Resource<Registration>) {
    if (r.data.state === "revoked") return "revoked";
    const m = this.member(r.project_id, r.data.member_id);
    if (
      !m ||
      m.state !== "active" ||
      m.revision !== r.data.member_revision ||
      m.client !== r.data.target ||
      this.keyDigest() !== r.data.key_digest
    )
      return "invalidated";
    if (
      this.w.now() >=
      (r.data.state === "pending" ? r.data.invite_expires : r.data.expires)
    )
      return "expired";
    return r.data.state;
  }
  private reason(r: Resource<Registration>) {
    if (r.data.replaced_by_connection_id) return "REPLACED";
    if (r.data.state === "revoked") return "REVOKED";
    const m = this.member(r.project_id, r.data.member_id);
    if (!m || m.state !== "active") return "MEMBER_UNAVAILABLE";
    if (m.revision !== r.data.member_revision || m.client !== r.data.target)
      return "MEMBER_CHANGED";
    if (this.keyDigest() !== r.data.key_digest) return "SIGNING_KEY_CHANGED";
    if (this.state(r) === "expired")
      return r.data.state === "pending"
        ? "INVITATION_EXPIRED"
        : "CREDENTIAL_EXPIRED";
    return r.data.state === "pending"
      ? "INVITATION_PENDING"
      : "REGISTERED_NOT_CONNECTED";
  }
  private view(r: Resource<Registration>) {
    return {
      connection_id: r.id,
      project_id: r.project_id,
      member_id: r.data.member_id,
      target: r.data.target,
      revision: r.revision,
      state: this.state(r),
      reason: this.reason(r),
      replaces_connection_id: r.data.replaces_connection_id ?? null,
      replaced_by_connection_id: r.data.replaced_by_connection_id ?? null,
      configuration_fingerprint: r.data.configuration_fingerprint,
      created_at: new Date(r.data.created_at).toISOString(),
      expires_at: new Date(r.data.expires).toISOString(),
      invitation_expires_at: new Date(r.data.invite_expires).toISOString(),
      runtime_state: "not_connected",
      qualification: "UNVERIFIED",
    };
  }
  invite(owner: string, csrf: string, value: unknown) {
    this.w.auth.authorize(owner, csrf);
    const q = fields(value, [
      "project_id",
      "member_id",
      "action_id",
      "expected_member_revision",
      "configuration_fingerprint",
    ]);
    if (
      !uuid(q.project_id) ||
      !uuid(q.member_id) ||
      !uuid(q.action_id) ||
      !revision(q.expected_member_revision) ||
      !fingerprint(q.configuration_fingerprint)
    )
      reject(400, "INVALID_REQUEST");
    return this.w.store.transaction(() => {
      this.w.auth.authorize(owner, csrf);
      return this.createInvite(q);
    });
  }
  private createInvite(q: Record<string, unknown>) {
    const project = q.project_id as string,
      member = q.member_id as string,
      action = q.action_id as string,
      fp = q.configuration_fingerprint as string;

    const m = this.member(project, member);
    if (!m) reject(404, "NOT_FOUND_OR_DENIED");
    if (m.state !== "active") reject(409, "MEMBER_INACTIVE");
    if (m.revision !== q.expected_member_revision)
      reject(409, "REVISION_CONFLICT");
    const payload = canonical(q);
    const old = this.w.store.db
      .prepare(
        "SELECT id FROM resources WHERE kind=? AND json_extract(data,'$.invite_action')=?",
      )
      .get(kind, action);
    if (old) {
      const r = this.load(String(old.id))!;
      if (r.data.replaces_connection_id) reject(409, "ACTION_PAYLOAD_CONFLICT");
      if (r.data.invite_payload !== payload)
        reject(409, "ACTION_PAYLOAD_CONFLICT");
      if (this.state(r) !== "pending") reject(409, "INVITATION_NOT_PENDING");
      return {
        ...this.view(r),
        invitation_token: this.credential(r, "invite"),
      };
    }
    const existing = this.w.store.db
      .prepare(
        "SELECT id FROM resources WHERE kind=? AND project_id=? AND json_extract(data,'$.member_id')=?",
      )
      .all(kind, project, member);
    if (
      existing.some((row) =>
        ["pending", "registered"].includes(
          this.state(this.load(String(row.id))!),
        ),
      )
    )
      reject(409, "CONNECTION_EXISTS");
    const now = this.w.now();
    const r: Resource<Registration> = {
      id: randomUUID(),
      project_id: project,
      kind,
      revision: "1",
      domain: project + ":connections",
      acl: [],
      dependencies: [],
      data: {
        member_id: member,
        member_revision: m.revision,
        target: m.client,
        configuration_fingerprint: fp,
        state: "pending",
        created_at: now,
        invite_expires: now + 600000,
        expires: now + 8 * 3600000,
        key_digest: this.keyDigest()!,
        invite_action: action,
        invite_payload: payload,
        invite_hash: "",
        redeem_action: null,
        connection_hash: null,
        revoke_action: null,
        revoke_payload: null,
      },
    };
    const token = this.credential(r, "invite");
    r.data.invite_hash = digest(token);
    this.w.store.putResource(r);
    return { ...this.view(r), invitation_token: token };
  }
  reinvite(owner: string, csrf: string, value: unknown) {
    this.w.auth.authorize(owner, csrf);
    const q = fields(value, [
      "project_id",
      "connection_id",
      "expected_revision",
      "expected_member_revision",
      "configuration_fingerprint",
      "action_id",
    ]);
    if (
      !uuid(q.project_id) ||
      !uuid(q.connection_id) ||
      !uuid(q.action_id) ||
      !revision(q.expected_revision) ||
      !revision(q.expected_member_revision) ||
      !fingerprint(q.configuration_fingerprint)
    )
      reject(400, "INVALID_REQUEST");
    return this.w.store.transaction(() => {
      this.w.auth.authorize(owner, csrf);
      const old = this.load(q.connection_id as string);
      if (!old || old.project_id !== q.project_id)
        reject(404, "NOT_FOUND_OR_DENIED");
      const payload = canonical(q);
      if (old.data.replacement_action === q.action_id) {
        if (old.data.replacement_payload !== payload)
          reject(409, "ACTION_PAYLOAD_CONFLICT");
        const replacement = this.load(old.data.replaced_by_connection_id!);
        if (!replacement || this.state(replacement) !== "pending")
          reject(409, "INVITATION_NOT_PENDING");
        return {
          ...this.view(replacement),
          invitation_token: this.credential(replacement, "invite"),
        };
      }
      if (old.data.replaced_by_connection_id)
        reject(409, "CONNECTION_ALREADY_REPLACED");
      if (old.revision !== q.expected_revision)
        reject(409, "REVISION_CONFLICT");
      // A replacement may not reuse an ordinary invite action or another replacement's action.
      if (
        this.w.store.db
          .prepare(
            "SELECT id FROM resources WHERE kind=? AND json_extract(data,'$.invite_action')=?",
          )
          .get(kind, q.action_id as string)
      )
        reject(409, "ACTION_PAYLOAD_CONFLICT");
      old.data.state = "revoked";
      old.revision = nextRevision(old.revision);
      this.w.store.putResource(old);
      const invitation = this.createInvite({
        project_id: q.project_id,
        member_id: old.data.member_id,
        expected_member_revision: q.expected_member_revision,
        configuration_fingerprint: q.configuration_fingerprint,
        action_id: q.action_id,
      });
      const replacement = this.load(invitation.connection_id)!;
      replacement.data.replaces_connection_id = old.id;
      old.data.replaced_by_connection_id = replacement.id;
      old.data.replacement_action = q.action_id as string;
      old.data.replacement_payload = payload;
      this.w.store.putResource(replacement);
      this.w.store.putResource(old);
      return {
        ...this.view(replacement),
        invitation_token: invitation.invitation_token,
      };
    });
  }
  redeem(token: string, value: unknown) {
    const q = fields(value, [
      "connection_id",
      "action_id",
      "configuration_fingerprint",
    ]);
    if (
      !uuid(q.connection_id) ||
      !uuid(q.action_id) ||
      !fingerprint(q.configuration_fingerprint)
    )
      reject(400, "INVALID_REQUEST");
    return this.w.store.transaction(() => {
      const r = this.load(q.connection_id as string);
      if (
        !r ||
        !sameToken(token, r.data.invite_hash) ||
        !["pending", "registered"].includes(this.state(r)) ||
        this.w.now() >= r.data.invite_expires ||
        q.configuration_fingerprint !== r.data.configuration_fingerprint
      )
        reject(401, "CONNECTION_CREDENTIAL_INVALID");
      if (r.data.redeem_action !== null && r.data.redeem_action !== q.action_id)
        reject(401, "CONNECTION_CREDENTIAL_INVALID");
      const credential = this.credential(r, "connection");
      if (r.data.state === "pending") {
        r.data.state = "registered";
        r.data.redeem_action = q.action_id as string;
        r.data.connection_hash = digest(credential);
        r.revision = nextRevision(r.revision);
        this.w.store.putResource(r);
      }
      return { ...this.view(r), connection_token: credential };
    });
  }
  read(token: string, id: string) {
    const r = this.load(id);
    if (
      !r ||
      !sameToken(token, r.data.connection_hash) ||
      this.state(r) !== "registered"
    )
      reject(401, "CONNECTION_CREDENTIAL_INVALID");
    return this.view(r);
  }
  /** Trusted in-process authorization metadata only; no credential or native identity. */
  registered(id: string) {
    const r = this.load(id);
    return r && this.state(r) === "registered" ? this.view(r) : undefined;
  }
  list(owner: string, project: string) {
    this.w.auth.authorize(owner);
    if (!uuid(project)) reject(400, "INVALID_REQUEST");
    if (
      !this.w.store.db
        .prepare("SELECT id FROM workspace_projects WHERE id=?")
        .get(project)
    )
      reject(404, "NOT_FOUND_OR_DENIED");
    return this.w.store.db
      .prepare(
        "SELECT id FROM resources WHERE project_id=? AND kind=? ORDER BY id",
      )
      .all(project, kind)
      .map((row) => this.view(this.load(String(row.id))!));
  }
  revoke(owner: string, csrf: string, value: unknown) {
    this.w.auth.authorize(owner, csrf);
    const q = fields(value, [
      "project_id",
      "connection_id",
      "action_id",
      "expected_revision",
    ]);
    if (
      !uuid(q.project_id) ||
      !uuid(q.connection_id) ||
      !uuid(q.action_id) ||
      !revision(q.expected_revision)
    )
      reject(400, "INVALID_REQUEST");
    return this.w.store.transaction(() => {
      this.w.auth.authorize(owner, csrf);
      const r = this.load(q.connection_id as string);
      if (!r || r.project_id !== q.project_id)
        reject(404, "NOT_FOUND_OR_DENIED");
      const payload = canonical(q);
      if (r.data.revoke_action === q.action_id) {
        if (r.data.revoke_payload !== payload)
          reject(409, "ACTION_PAYLOAD_CONFLICT");
        return this.view(r);
      }
      if (r.revision !== q.expected_revision) reject(409, "REVISION_CONFLICT");
      if (r.data.state !== "revoked") {
        r.data.state = "revoked";
        r.revision = nextRevision(r.revision);
        r.data.revoke_action = q.action_id as string;
        r.data.revoke_payload = payload;
        this.w.store.putResource(r);
      }
      return this.view(r);
    });
  }
}
