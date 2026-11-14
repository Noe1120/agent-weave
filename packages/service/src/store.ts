import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  Grant,
  Policy,
  Run,
  Resource,
  SavedAction,
  WaitData,
} from "./domain.ts";
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export class Store {
  readonly db: DatabaseSync;
  constructor(filename = ":memory:") {
    this.db = new DatabaseSync(filename);
    try {
      this.db.exec(
        "PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;",
      );
      this.migrate();
    } catch (e) {
      this.db.close();
      throw e;
    }
  }
  private migrate() {
    const migrations = [
      "001_core.sql",
      "002_workspace.sql",
      "003_broker.sql",
      "004_runner.sql",
    ].map((name, index) => ({
      version: index + 1,
      sql: readFileSync(
        new URL("../migrations/" + name, import.meta.url),
        "utf8",
      ),
    }));
    this.transaction(() => {
      this.db.exec(
        "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)",
      );
      const rows = this.db
        .prepare(
          "SELECT version,checksum FROM schema_migrations ORDER BY version",
        )
        .all();
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!,
          migration = migrations[i];
        if (!migration || row.version !== migration.version)
          throw new Error("Unsupported database migration version");
        if (row.checksum !== digest(migration.sql))
          throw new Error("Migration checksum mismatch");
      }
      for (const migration of migrations.slice(rows.length)) {
        this.db.exec(migration.sql);
        this.db
          .prepare("INSERT INTO schema_migrations VALUES(?,?)")
          .run(migration.version, digest(migration.sql));
      }
    });
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      if (result && typeof (result as { then?: unknown }).then === "function")
        throw new Error("Transactions must be synchronous");
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  close() {
    this.db.close();
  }
  // Trusted, in-process provisioning only. Never exposed as HTTP administration.
  putPolicy(p: Policy) {
    this.db
      .prepare(
        "INSERT INTO policies VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,data=excluded.data",
      )
      .run(p.id, p.project_id, JSON.stringify(p));
  }
  putRun(r: Run) {
    this.db
      .prepare(
        "INSERT INTO runs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,data=excluded.data",
      )
      .run(r.id, r.project_id, JSON.stringify(r));
  }
  issueGrant(g: Grant): string {
    const token = randomBytes(32).toString("base64url");
    this.db
      .prepare("INSERT INTO grants VALUES(?,?,?,?)")
      .run(g.id, g.project_id, digest(token), JSON.stringify(g));
    return token;
  }
  updateGrant(g: Grant) {
    this.db
      .prepare("UPDATE grants SET data=? WHERE id=? AND project_id=?")
      .run(JSON.stringify(g), g.id, g.project_id);
  }
  getPolicy(id: string): Policy | undefined {
    return this.jsonRow<Policy>("policies", id);
  }
  getRun(id: string): Run | undefined {
    return this.jsonRow<Run>("runs", id);
  }
  getGrant(id: string): Grant | undefined {
    return this.jsonRow<Grant>("grants", id);
  }
  grantForToken(token: string): Grant | undefined {
    const r = this.db
      .prepare("SELECT data FROM grants WHERE token_hash=?")
      .get(digest(token));
    return r ? (JSON.parse(String(r.data)) as Grant) : undefined;
  }
  private jsonRow<T>(
    table: "policies" | "runs" | "grants",
    id: string,
  ): T | undefined {
    const r = this.db
      .prepare("SELECT data FROM " + table + " WHERE id=?")
      .get(id);
    return r ? (JSON.parse(String(r.data)) as T) : undefined;
  }
  putResource<T>(r: Resource<T>) {
    this.db
      .prepare(
        "INSERT INTO resources VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,domain=excluded.domain,acl=excluded.acl,dependencies=excluded.dependencies,data=excluded.data WHERE resources.project_id=excluded.project_id AND resources.kind=excluded.kind",
      )
      .run(
        r.id,
        r.project_id,
        r.kind,
        r.revision,
        r.domain,
        JSON.stringify(r.acl),
        JSON.stringify(r.dependencies),
        JSON.stringify(r.data),
      );
  }
  getResource<T = Record<string, unknown>>(
    id: string,
  ): Resource<T> | undefined {
    const r = this.db.prepare("SELECT * FROM resources WHERE id=?").get(id);
    if (!r) return undefined;
    return {
      id: String(r.id),
      project_id: String(r.project_id),
      kind: String(r.kind),
      revision: String(r.revision),
      domain: String(r.domain),
      acl: JSON.parse(String(r.acl)),
      dependencies: JSON.parse(String(r.dependencies)),
      data: JSON.parse(String(r.data)) as T,
    };
  }
  head(project: string): string | undefined {
    return this.db
      .prepare("SELECT token FROM project_heads WHERE project_id=?")
      .get(project)?.token as string | undefined;
  }
  setHead(project: string, token: string) {
    this.db
      .prepare(
        "INSERT INTO project_heads VALUES(?,?) ON CONFLICT(project_id) DO UPDATE SET token=excluded.token",
      )
      .run(project, token);
  }
  saveAction(a: SavedAction) {
    this.db
      .prepare("INSERT INTO actions VALUES(?,?,?,?,?,?,?,?)")
      .run(
        a.action_id,
        a.project_id,
        a.grant_id,
        a.operation,
        a.fingerprint,
        JSON.stringify(a.request),
        JSON.stringify(a.receipt),
        JSON.stringify(a.resource_ids),
      );
  }
  getAction(id: string): SavedAction | undefined {
    const r = this.db
      .prepare("SELECT * FROM actions WHERE action_id=?")
      .get(id);
    return r
      ? {
          action_id: String(r.action_id),
          project_id: String(r.project_id),
          grant_id: String(r.grant_id),
          operation: String(r.operation) as SavedAction["operation"],
          fingerprint: String(r.fingerprint),
          request: JSON.parse(String(r.request)),
          receipt: JSON.parse(String(r.receipt)),
          resource_ids: JSON.parse(String(r.resource_ids)),
        }
      : undefined;
  }
  saveWait(w: WaitData) {
    const r = w.registration;
    this.db
      .prepare(
        "INSERT INTO waits VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(wait_id) DO UPDATE SET state=excluded.state,data=excluded.data",
      )
      .run(
        r.wait_id,
        r.project_id,
        w.grant_id,
        r.workflow_id,
        r.run_id,
        r.run_epoch,
        r.step_key,
        r.target_task_id,
        w.record.state,
        JSON.stringify(w),
      );
  }
  getWait(id: string): WaitData | undefined {
    const r = this.db.prepare("SELECT data FROM waits WHERE wait_id=?").get(id);
    return r ? (JSON.parse(String(r.data)) as WaitData) : undefined;
  }
  waitsForTask(id: string): WaitData[] {
    return this.db
      .prepare(
        "SELECT data FROM waits WHERE target_task_id=? AND state='registered'",
      )
      .all(id)
      .map((r) => JSON.parse(String(r.data)) as WaitData);
  }
  activeWait(
    workflow: string,
    run: string,
    epoch: string,
    step: string,
  ): boolean {
    return !!this.db
      .prepare(
        "SELECT 1 FROM waits WHERE workflow_id=? AND run_id=? AND run_epoch=? AND step_key=? AND state IN ('registered','resolved')",
      )
      .get(workflow, run, epoch, step);
  }
  outbox(
    project: string,
    grant: string,
    kind: string,
    id: string,
    payload: unknown,
  ) {
    this.db
      .prepare(
        "INSERT INTO outbox(id,project_id,grant_id,kind,aggregate_id,payload) VALUES(?,?,?,?,?,?)",
      )
      .run(randomUUID(), project, grant, kind, id, JSON.stringify(payload));
  }
  inbox(
    project: string,
    grant: string,
    workflow: string,
    source: string,
    resolution: string,
    payload: unknown,
  ) {
    this.db
      .prepare(
        "INSERT INTO continuation_inbox(id,project_id,grant_id,workflow_id,source_id,resolution_id,payload) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        project,
        grant,
        workflow,
        source,
        resolution,
        JSON.stringify(payload),
      );
  }
}
