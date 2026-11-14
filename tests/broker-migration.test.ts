import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { Store, digest } from "../packages/service/src/store.ts";
import { tempWorkspace } from "./temp.ts";
function oldDatabase(file: string) {
  const db = new DatabaseSync(file);
  db.exec(
    "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL)",
  );
  for (const [i, name] of ["001_core.sql", "002_workspace.sql"].entries()) {
    const sql = readFileSync("packages/service/migrations/" + name, "utf8");
    db.exec(sql);
    db.prepare("INSERT INTO schema_migrations VALUES(?,?)").run(
      i + 1,
      digest(sql),
    );
  }
  db.prepare("INSERT INTO project_heads VALUES(?,?)").run(
    "preserved",
    "legacy-head",
  );
  return db;
}
test("broker migration upgrades genuine v2, preserves old heads and rejects altered v3 checksum", () => {
  const tmp = tempWorkspace();
  try {
    oldDatabase(tmp.db).close();
    const s = new Store(tmp.db);
    try {
      assert.equal(s.head("preserved"), "legacy-head");
      assert.equal(
        s.db.prepare("SELECT count(*) n FROM schema_migrations").get()!.n,
        4,
      );
      for (const name of [
        "broker_workspaces",
        "broker_claims",
        "broker_locks",
        "broker_edits",
      ])
        assert.ok(
          s.db
            .prepare(
              "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            )
            .get(name),
        );
      s.db.exec(
        "UPDATE schema_migrations SET checksum='tampered' WHERE version=3",
      );
    } finally {
      s.close();
    }
    assert.throws(() => new Store(tmp.db), /checksum/);
  } finally {
    tmp.dispose();
  }
});
test("failed broker migration rolls back all new tables and leaves v2 readable", () => {
  const tmp = tempWorkspace();
  try {
    const old = oldDatabase(tmp.db);
    old.exec("CREATE TABLE broker_claims(conflict TEXT)");
    old.close();
    assert.throws(() => new Store(tmp.db), /already exists/);
    const db = new DatabaseSync(tmp.db);
    try {
      assert.equal(
        db.prepare("SELECT count(*) n FROM schema_migrations").get()!.n,
        2,
      );
      assert.equal(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE name='broker_workspaces'",
          )
          .get(),
        undefined,
      );
      assert.equal(
        db
          .prepare(
            "SELECT token FROM project_heads WHERE project_id='preserved'",
          )
          .get()!.token,
        "legacy-head",
      );
    } finally {
      db.close();
    }
  } finally {
    tmp.dispose();
  }
});
