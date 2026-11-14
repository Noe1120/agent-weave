import { canonical, nextRevision } from "./domain.ts";
import type { Context, TaskData } from "./domain.ts";
import {
  authenticate,
  authorizeGrant,
  requireActive,
  requireResource,
} from "./auth.ts";
import { Store } from "./store.ts";
import { BrokerGit } from "./broker-git.ts";
import type { FileEdit } from "./broker-git.ts";
import {
  demand,
  logicalPath,
  overlaps,
  readText,
  replaceText,
  textDigest,
} from "./broker-paths.ts";
import { ServiceFault } from "./errors.ts";
import { BrokerFault } from "./broker-paths.ts";
import { reconcile } from "./waits.ts";
export type FaultPoint =
  "prepared" | "file_written" | "files_applied" | "ref_updated";
export interface ClaimRequest {
  project_id: string;
  workspace_id: string;
  scope_id: string;
  claim_id: string;
  expected_task_revision: string;
  lease_ms: number;
}
export interface WriteRequest {
  project_id: string;
  claim_id: string;
  action_id: string;
  edits: FileEdit[];
}
interface Scope {
  task_id: string;
  candidate_id: string;
  paths: string[];
}
interface Workspace {
  id: string;
  project_id: string;
  root: string;
  head: string;
  grant_id: string | null;
}
interface Claim {
  id: string;
  project_id: string;
  workspace_id: string;
  grant_id: string;
  scope_id: string;
  scope_revision: string;
  task_id: string;
  task_revision: string;
  candidate_id: string;
  candidate_revision: string;
  run_id: string;
  run_epoch: string;
  paths: string[];
  metadata_path: string;
  base_commit: string;
  lease_until: number;
  state: "active" | "quarantined" | "released";
  quarantine_reason?: string;
}
interface Edit {
  observed_at: string;
  action_id: string;
  claim_id: string;
  phase: "prepared" | "files_applied" | "checkpointed";
  parent: string;
  commit: string;
  tree: string;
  diff: string;
  edits: FileEdit[];
}
const validId = (id: string) =>
  typeof id === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
// Development-only, synchronous, trusted in-process boundary. Never mounted on HTTP/MCP.
// Path checks are defense in depth, NOT a same-user hostile-process security boundary.
export class DevelopmentBroker {
  readonly store: Store;
  readonly git: BrokerGit;
  readonly now: () => number;
  readonly fault: ((point: FaultPoint) => void) | undefined;
  constructor(
    store: Store,
    gitExecutable: string,
    now: () => number = Date.now,
    fault?: (point: FaultPoint) => void,
  ) {
    this.store = store;
    this.git = new BrokerGit(gitExecutable);
    this.now = now;
    this.fault = fault;
  }
  createWorkspace(project: string, id: string, emptyRoot: string) {
    demand(validId(project) && validId(id), "INVALID_REQUEST");
    return this.store.transaction(() => {
      demand(
        !this.store.db
          .prepare("SELECT id FROM broker_workspaces WHERE id=?")
          .get(id),
        "WORKSPACE_EXISTS",
      );
      const head = this.git.create(emptyRoot);
      this.store.db
        .prepare(
          "INSERT INTO broker_workspaces(id,project_id,root,head,mode) VALUES(?,?,?,?,'development')",
        )
        .run(id, project, emptyRoot, head);
      return { id, head, mode: "development" as const };
    });
  }
  private workspace(id: string, project: string): Workspace {
    const w = this.store.db
      .prepare("SELECT * FROM broker_workspaces WHERE id=? AND project_id=?")
      .get(id, project);
    demand(w, "NOT_FOUND_OR_DENIED");
    return w as unknown as Workspace;
  }
  private getClaim(id: string): Claim {
    const row = this.store.db
      .prepare("SELECT data,state FROM broker_claims WHERE id=?")
      .get(id);
    demand(row, "NOT_FOUND_OR_DENIED");
    return { ...JSON.parse(String(row.data)), state: row.state } as Claim;
  }
  private saveClaim(c: Claim) {
    this.store.db
      .prepare("UPDATE broker_claims SET state=?,data=? WHERE id=?")
      .run(c.state, JSON.stringify(c), c.id);
  }
  private quarantine(id: string, reason: string) {
    const claim = this.getClaim(id);
    if (claim.state !== "active") return;
    claim.state = "quarantined";
    claim.quarantine_reason = reason;
    this.saveClaim(claim);
  }
  private resources(c: Context, claim: Claim) {
    demand(c.grant.id === claim.grant_id, "NOT_FOUND_OR_DENIED");
    const scope = requireResource<Scope>(
      this.store,
      c,
      claim.scope_id,
      "broker_scope",
    );
    const task = requireResource<TaskData>(
      this.store,
      c,
      claim.task_id,
      "task",
    );
    const candidate = requireResource(
      this.store,
      c,
      claim.candidate_id,
      "changeset",
    );
    demand(
      scope.data.task_id === task.id &&
        scope.data.candidate_id === candidate.id,
      "NOT_FOUND_OR_DENIED",
    );
    return { scope, task, candidate };
  }
  private authorize(
    token: string,
    project: string,
    id: string,
    write: boolean,
    historical = false,
  ) {
    const c = authenticate(
      this.store,
      token,
      project,
      write ? "broker_write" : "broker_read",
      this.now(),
    );
    const claim = this.getClaim(id);
    demand(claim.project_id === project, "NOT_FOUND_OR_DENIED");
    const resources = this.resources(c, claim);
    if (write && !historical) {
      requireActive(c);
      demand(
        claim.state === "active",
        claim.quarantine_reason ?? "CLAIM_NOT_ACTIVE",
      );
      demand(claim.lease_until > this.now(), "LEASE_STALE");
      demand(
        c.run.id === claim.run_id && c.run.epoch === claim.run_epoch,
        "LEASE_STALE",
      );
      demand(resources.scope.revision === claim.scope_revision, "SCOPE_STALE");
      demand(
        resources.task.revision === claim.task_revision &&
          resources.task.data.status === "running" &&
          resources.task.data.inputs_valid,
        "TASK_STALE",
      );
      demand(
        resources.candidate.revision === claim.candidate_revision,
        "CANDIDATE_STALE",
      );
      const held = this.store.db
        .prepare("SELECT path_key FROM broker_locks WHERE claim_id=?")
        .all(id)
        .map((r) => String(r.path_key));
      demand(
        [...claim.paths, claim.metadata_path].every((p) =>
          held.includes(logicalPath(p, true)),
        ),
        "LOCK_LOST",
      );
    }
    return { c, claim, ...resources };
  }
  // Expiration/unknown/revocation only quarantines. It NEVER deletes locks.
  private fenceInvalidClaims() {
    this.store.transaction(() => {
      for (const row of this.store.db
        .prepare("SELECT id FROM broker_claims WHERE state='active'")
        .all()) {
        const claim = this.getClaim(String(row.id));
        try {
          demand(claim.lease_until > this.now(), "LEASE_STALE");
          const grant = this.store.getGrant(claim.grant_id);
          demand(grant, "GRANT_REVOKED");
          const ctx = authorizeGrant(
            this.store,
            grant,
            claim.project_id,
            "broker_write",
            this.now(),
          );
          requireActive(ctx);
          const { scope, task, candidate } = this.resources(ctx, claim);
          demand(
            ctx.run.epoch === claim.run_epoch && ctx.run.id === claim.run_id,
            "LEASE_STALE",
          );
          demand(
            scope.revision === claim.scope_revision &&
              task.revision === claim.task_revision &&
              task.data.inputs_valid &&
              candidate.revision === claim.candidate_revision,
            "STALE",
          );
        } catch (e) {
          if (!(e instanceof ServiceFault) && !(e instanceof BrokerFault))
            throw e;
          this.quarantine(claim.id, e.message);
        }
      }
    });
  }
  // Trusted scheduler reconciliation; never called by progress reads or mounted publicly.
  reconcileLiveness() {
    this.fenceInvalidClaims();
  }
  claim(token: string, q: ClaimRequest): Claim {
    this.fenceInvalidClaims();
    return this.store.transaction(() => {
      const c = authenticate(
        this.store,
        token,
        q.project_id,
        "broker_write",
        this.now(),
      );
      requireActive(c);
      demand(
        validId(q.claim_id) &&
          Number.isSafeInteger(q.lease_ms) &&
          q.lease_ms > 0 &&
          q.lease_ms <= 300000,
        "INVALID_REQUEST",
      );
      const old = this.store.db
        .prepare("SELECT fingerprint FROM broker_claims WHERE id=?")
        .get(q.claim_id);
      if (old) {
        const result = this.authorize(
          token,
          q.project_id,
          q.claim_id,
          true,
        ).claim;
        demand(old.fingerprint === canonical(q), "ACTION_PAYLOAD_CONFLICT");
        return result;
      }
      const scope = requireResource<Scope>(
        this.store,
        c,
        q.scope_id,
        "broker_scope",
      );
      const task = requireResource<TaskData>(
        this.store,
        c,
        scope.data.task_id,
        "task",
      );
      const candidate = requireResource(
        this.store,
        c,
        scope.data.candidate_id,
        "changeset",
      );
      demand(task.revision === q.expected_task_revision, "TASK_STALE");
      demand(
        task.data.status === "queued" && task.data.inputs_valid,
        "TASK_NOT_READY",
      );
      demand(
        Array.isArray(scope.data.paths) &&
          scope.data.paths.length > 0 &&
          scope.data.paths.length <= 128,
        "INVALID_SCOPE",
      );
      const paths = [...scope.data.paths];
      const metadata_path = `.team/changes/${q.claim_id}.md`;
      const keys = paths.map((p) => logicalPath(p));
      for (let i = 0; i < keys.length; i++)
        for (let j = i + 1; j < keys.length; j++)
          demand(!overlaps(keys[i]!, keys[j]!), "INVALID_SCOPE");
      keys.push(logicalPath(metadata_path, true));
      const held = this.store.db
        .prepare("SELECT path_key FROM broker_locks WHERE project_id=?")
        .all(q.project_id);
      for (const key of keys)
        demand(
          !held.some((r) => overlaps(String(r.path_key), key)),
          "PATH_BUSY",
        );
      const w = this.workspace(q.workspace_id, q.project_id);
      demand(!w.grant_id || w.grant_id === c.grant.id, "NOT_FOUND_OR_DENIED");
      demand(
        !this.store.db
          .prepare(
            "SELECT id FROM broker_claims WHERE workspace_id=? AND state!='released'",
          )
          .get(w.id),
        "WORKSPACE_BUSY",
      );
      demand(
        !this.store.db
          .prepare("SELECT id FROM broker_claims WHERE candidate_id=?")
          .get(candidate.id),
        "CANDIDATE_BUSY",
      );
      demand(this.git.head(w.root) === w.head, "GIT_BASELINE_CONFLICT");
      task.data.status = "running";
      task.revision = nextRevision(task.revision);
      const claim: Claim = {
        id: q.claim_id,
        project_id: q.project_id,
        workspace_id: w.id,
        grant_id: c.grant.id,
        scope_id: scope.id,
        scope_revision: scope.revision,
        task_id: task.id,
        task_revision: task.revision,
        candidate_id: candidate.id,
        candidate_revision: candidate.revision,
        run_id: c.run.id,
        run_epoch: c.run.epoch,
        paths,
        metadata_path,
        base_commit: w.head,
        lease_until: this.now() + q.lease_ms,
        state: "active",
      };
      this.store.db
        .prepare(
          "INSERT INTO broker_claims(id,project_id,workspace_id,grant_id,task_id,candidate_id,state,lease_until,fingerprint,data) VALUES(?,?,?,?,?,?,'active',?,?,?)",
        )
        .run(
          claim.id,
          claim.project_id,
          w.id,
          claim.grant_id,
          task.id,
          candidate.id,
          claim.lease_until,
          canonical(q),
          JSON.stringify(claim),
        );
      for (const key of keys)
        this.store.db
          .prepare("INSERT INTO broker_locks VALUES(?,?,?)")
          .run(q.project_id, key, claim.id);
      this.store.db
        .prepare("UPDATE broker_workspaces SET grant_id=? WHERE id=?")
        .run(c.grant.id, w.id);
      this.store.putResource(task);
      reconcile(this.store, task.id, this.now());
      return claim;
    });
  }
  private edit(id: string): Edit | undefined {
    const row = this.store.db
      .prepare("SELECT data,phase FROM broker_edits WHERE action_id=?")
      .get(id);
    return row
      ? ({ ...JSON.parse(String(row.data)), phase: row.phase } as Edit)
      : undefined;
  }
  private phase(edit: Edit, phase: Edit["phase"]) {
    edit.phase = phase;
    this.store.db
      .prepare("UPDATE broker_edits SET phase=?,data=? WHERE action_id=?")
      .run(phase, JSON.stringify(edit), edit.action_id);
  }
  write(token: string, q: WriteRequest) {
    this.fenceInvalidClaims();
    let edit = this.store.transaction(() => {
      const priorEdit = this.edit(q.action_id);
      const { claim } = this.authorize(
        token,
        q.project_id,
        q.claim_id,
        true,
        priorEdit?.phase === "checkpointed",
      );
      demand(
        validId(q.action_id) &&
          Array.isArray(q.edits) &&
          q.edits.length > 0 &&
          q.edits.length <= 128,
        "INVALID_REQUEST",
      );
      const old = this.store.db
        .prepare(
          "SELECT claim_id,fingerprint FROM broker_edits WHERE action_id=?",
        )
        .get(q.action_id);
      if (old) {
        demand(old.claim_id === claim.id, "NOT_FOUND_OR_DENIED");
        demand(old.fingerprint === canonical(q), "ACTION_PAYLOAD_CONFLICT");
        return this.edit(q.action_id)!;
      }
      demand(
        !this.store.db
          .prepare(
            "SELECT action_id FROM broker_edits WHERE claim_id=? AND phase!='checkpointed'",
          )
          .get(claim.id),
        "RECOVERY_REQUIRED",
      );
      const w = this.workspace(claim.workspace_id, q.project_id);
      demand(this.git.head(w.root) === w.head, "GIT_BASELINE_CONFLICT");
      this.git.assertSnapshot(w.root, w.head, "BASELINE_CONFLICT");
      const edits: FileEdit[] = [],
        seen = new Set<string>();
      let size = 0;
      for (const input of q.edits) {
        const key = logicalPath(input.path);
        demand(!seen.has(key), "INVALID_REQUEST");
        seen.add(key);
        const path = claim.paths.find((p) => logicalPath(p) === key);
        demand(path, "PATH_NOT_GRANTED");
        demand(
          input.text === null || typeof input.text === "string",
          "INVALID_REQUEST",
        );
        demand(
          input.text === null ||
            Buffer.from(input.text, "utf8").toString("utf8") === input.text,
          "UNSUPPORTED_FILE_ENCODING",
        );
        size += Buffer.byteLength(input.text ?? "", "utf8");
        demand(size <= 1024 * 1024, "PAYLOAD_TOO_LARGE");
        demand(
          textDigest(readText(w.root, path)) === input.before_digest,
          "BASELINE_CONFLICT",
        );
        edits.push({
          path,
          before_digest: input.before_digest,
          text: input.text,
        });
      }
      const prior = readText(w.root, claim.metadata_path);
      const text =
        (prior ??
          `# Change ${claim.id}\n\nDevelopment evidence; not accepted or merged.\n`) +
        `\n## Action ${q.action_id}\n\nParent: ${w.head}\n\n` +
        edits
          .map(
            (e) =>
              `- ${JSON.stringify(e.path)}: ${e.before_digest ?? "absent"} → ${textDigest(e.text) ?? "deleted"}`,
          )
          .join("\n") +
        "\n";
      edits.push({
        path: claim.metadata_path,
        before_digest: textDigest(prior),
        text,
      });
      const observed_at = new Date(this.now()).toISOString();
      const prepared = this.git.prepare(
        w.root,
        w.head,
        edits,
        q.action_id,
        observed_at,
      );
      const record: Edit = {
        observed_at,
        action_id: q.action_id,
        claim_id: claim.id,
        phase: "prepared",
        parent: w.head,
        ...prepared,
        edits,
      };
      this.store.db
        .prepare("INSERT INTO broker_edits VALUES(?,?,'prepared',?,?)")
        .run(q.action_id, claim.id, canonical(q), JSON.stringify(record));
      return record;
    });
    if (edit.phase === "checkpointed") return this.receipt(edit);
    this.fault?.("prepared");
    try {
      if (edit.phase === "prepared") {
        this.store.transaction(() => {
          const { claim } = this.authorize(
            token,
            q.project_id,
            q.claim_id,
            true,
          );
          edit = this.edit(q.action_id)!;
          if (edit.phase !== "prepared") return;
          const w = this.workspace(claim.workspace_id, q.project_id);
          demand(
            this.git.head(w.root) === edit.parent,
            "GIT_BASELINE_CONFLICT",
          );
          this.git.assertSnapshot(
            w.root,
            edit.parent,
            "RECOVERY_CONFLICT",
            edit.edits,
          );
          // Validate the entire batch before touching any file; a crash may leave a known prefix applied.
          for (const item of edit.edits) {
            const current = textDigest(readText(w.root, item.path));
            demand(
              current === item.before_digest ||
                current === textDigest(item.text),
              "RECOVERY_CONFLICT",
            );
          }
          for (const item of edit.edits) {
            if (
              textDigest(readText(w.root, item.path)) !== textDigest(item.text)
            )
              replaceText(w.root, item.path, item.text);
            this.fault?.("file_written");
          }
          this.phase(edit, "files_applied");
        });
        this.fault?.("files_applied");
      }
      this.store.transaction(() => {
        const { claim, candidate } = this.authorize(
          token,
          q.project_id,
          q.claim_id,
          true,
        );
        edit = this.edit(q.action_id)!;
        if (edit.phase === "checkpointed") return;
        const w = this.workspace(claim.workspace_id, q.project_id);
        this.git.assertSnapshot(w.root, edit.commit, "RECOVERY_CONFLICT");
        for (const item of edit.edits)
          demand(
            textDigest(readText(w.root, item.path)) === textDigest(item.text),
            "RECOVERY_CONFLICT",
          );
        this.git.advance(w.root, edit.parent, edit.commit);
        this.fault?.("ref_updated");
        candidate.data = {
          ...candidate.data,
          producer_run_id: claim.run_id,
          base_commit: claim.base_commit,
          source_commit: edit.commit,
          tree_digest: edit.tree,
          readiness: "wip",
          review_state: "pending",
          validity: "valid",
          change_id: claim.id,
          metadata_path: claim.metadata_path,
          journal_ids: this.store.db
            .prepare(
              "SELECT action_id FROM broker_edits WHERE claim_id=? ORDER BY rowid",
            )
            .all(claim.id)
            .map((r) => String(r.action_id)),
          diff: this.git.diff(w.root, claim.base_commit, edit.commit),
        };
        candidate.revision = nextRevision(candidate.revision);
        claim.candidate_revision = candidate.revision;
        this.store.putResource(candidate);
        this.saveClaim(claim);
        this.phase(edit, "checkpointed");
        this.store.db
          .prepare("UPDATE broker_workspaces SET head=? WHERE id=?")
          .run(edit.commit, w.id);
      });
    } catch (e) {
      // Preserve both error and evidence; never rollback files blindly or silently free locks.
      this.store.transaction(() =>
        this.quarantine(
          q.claim_id,
          e instanceof BrokerFault || e instanceof ServiceFault
            ? e.message
            : "IO_OR_DATABASE_FAILURE",
        ),
      );
      throw e;
    }
    return this.receipt(edit);
  }
  private receipt(edit: Edit) {
    return {
      action_id: edit.action_id,
      claim_id: edit.claim_id,
      phase: edit.phase,
      commit: edit.commit,
    };
  }
  read(token: string, project: string, id: string) {
    return this.store.transaction(() => {
      const { claim } = this.authorize(token, project, id, false);
      const edits = this.store.db
        .prepare(
          "SELECT action_id FROM broker_edits WHERE claim_id=? ORDER BY rowid",
        )
        .all(id)
        .map((r) => this.edit(String(r.action_id))!);
      return { claim, edits };
    });
  }
  finish(token: string, project: string, id: string, onReleased?: () => void) {
    this.fenceInvalidClaims();
    return this.store.transaction(() => {
      const historic = this.authorize(token, project, id, true, true);
      if (historic.claim.state === "released") {
        onReleased?.();
        return {
          claim_id: id,
          state: "released" as const,
          task_revision: historic.claim.task_revision,
        };
      }
      const { claim, task, candidate } = this.authorize(
        token,
        project,
        id,
        true,
      );
      const rows = this.store.db
        .prepare(
          "SELECT action_id,phase FROM broker_edits WHERE claim_id=? ORDER BY rowid",
        )
        .all(id);
      demand(
        rows.length > 0 && rows.every((r) => r.phase === "checkpointed"),
        "RECOVERY_REQUIRED",
      );
      const w = this.workspace(claim.workspace_id, project);
      demand(this.git.head(w.root) === w.head, "GIT_BASELINE_CONFLICT");
      this.git.assertSnapshot(w.root, w.head, "RECOVERY_CONFLICT");
      // Last recorded content for every path, including files changed by older actions.
      const latest = new Map<string, FileEdit>();
      for (const row of rows)
        for (const edit of this.edit(String(row.action_id))!.edits)
          latest.set(edit.path, edit);
      for (const item of latest.values())
        demand(
          textDigest(readText(w.root, item.path)) === textDigest(item.text),
          "RECOVERY_CONFLICT",
        );
      task.data.status = "in_review";
      task.data.candidate_ref = {
        id: candidate.id,
        revision: candidate.revision,
      };
      task.revision = nextRevision(task.revision);
      claim.task_revision = task.revision;
      this.store.putResource(task);
      reconcile(this.store, task.id, this.now());
      claim.state = "released";
      this.saveClaim(claim);
      this.store.db
        .prepare("DELETE FROM broker_locks WHERE claim_id=?")
        .run(id);
      // The trusted runner records observed exit and success in this same transaction.
      onReleased?.();
      return {
        claim_id: id,
        state: "released" as const,
        task_revision: task.revision,
      };
    });
  }
}
