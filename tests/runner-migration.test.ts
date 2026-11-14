import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { Store, digest } from "../packages/service/src/store.ts";
import { tempWorkspace } from "./temp.ts";
function v3(file: string) {
  const db = new DatabaseSync(file);
  db.exec(
    "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL)",
  );
  for (const [i, name] of [
    "001_core.sql",
    "002_workspace.sql",
    "003_broker.sql",
  ].entries()) {
    const sql = readFileSync("packages/service/migrations/" + name, "utf8");
    db.exec(sql);
    db.prepare("INSERT INTO schema_migrations VALUES(?,?)").run(
      i + 1,
      digest(sql),
    );
  }
  db.prepare("INSERT INTO project_heads VALUES('old','preserved')").run();
  return db;
}
test("runner migration upgrades genuine v3 without changing historical state and detects tampering", () => {
  const t = tempWorkspace();
  try {
    v3(t.db).close();
    const s = new Store(t.db);
    try {
      assert.equal(s.head("old"), "preserved");
      assert.equal(
        s.db.prepare("SELECT count(*) n FROM schema_migrations").get()!.n,
        4,
      );
      assert.ok(
        s.db
          .prepare(
            "SELECT name FROM sqlite_master WHERE name='runner_executions'",
          )
          .get(),
      );
      s.db.exec("UPDATE schema_migrations SET checksum='bad' WHERE version=4");
    } finally {
      s.close();
    }
    assert.throws(() => {
      new Store(t.db).close();
    }, /checksum/);
  } finally {
    t.dispose();
  }
});
test("runner migration rolls back entirely on table conflict and preserves v3", () => {
  const t = tempWorkspace();
  try {
    const old = v3(t.db);
    old.exec("CREATE TABLE runner_events(conflict TEXT)");
    old.close();
    assert.throws(() => {
      new Store(t.db).close();
    }, /already exists/);
    const db = new DatabaseSync(t.db);
    try {
      assert.equal(
        db.prepare("SELECT count(*) n FROM schema_migrations").get()!.n,
        3,
      );
      assert.equal(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE name='runner_executions'",
          )
          .get(),
        undefined,
      );
      assert.equal(
        db
          .prepare("SELECT token FROM project_heads WHERE project_id='old'")
          .get()!.token,
        "preserved",
      );
    } finally {
      db.close();
    }
  } finally {
    t.dispose();
  }
});
