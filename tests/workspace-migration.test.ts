import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { Store, digest } from "../packages/service/src/store.ts";
import { tempWorkspace } from "./temp.ts";
test("W04 upgrades genuine v1 database without replacing old ledger", () => {
  const tmp = tempWorkspace();
  try {
    const old = new DatabaseSync(tmp.db);
    const sql = readFileSync(
      "packages/service/migrations/001_core.sql",
      "utf8",
    );
    old.exec(
      "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL)",
    );
    old.exec(sql);
    old.prepare("INSERT INTO schema_migrations VALUES(1,?)").run(digest(sql));
    old
      .prepare("INSERT INTO project_heads VALUES(?,?)")
      .run("legacy-project", "legacy-token");
    old.close();
    const store = new Store(tmp.db);
    try {
      assert.equal(
        store.db.prepare("SELECT count(*) n FROM schema_migrations").get()!.n,
        4,
      );
      assert.equal(store.head("legacy-project"), "legacy-token");
      for (const name of [
        "workspace_projects",
        "workspace_members",
        "workspace_messages",
        "workspace_drafts",
        "console_sessions",
        "console_pairings",
        "feed_bindings",
        "message_deliveries",
      ])
        assert.ok(
          store.db
            .prepare(
              "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
            )
            .get(name),
          name,
        );
    } finally {
      store.close();
    }
  } finally {
    tmp.dispose();
  }
});

test("W04 rejects altered second migration checksum and rolls back partial upgrade", () => {
  const tamper = tempWorkspace();
  try {
    const s = new Store(tamper.db);
    s.db
      .prepare(
        "UPDATE schema_migrations SET checksum='tampered' WHERE version=2",
      )
      .run();
    s.close();
    assert.throws(() => new Store(tamper.db), /Migration checksum mismatch/);
  } finally {
    tamper.dispose();
  }
  const tmp = tempWorkspace();
  try {
    const db = new DatabaseSync(tmp.db);
    const sql = readFileSync(
      "packages/service/migrations/001_core.sql",
      "utf8",
    );
    db.exec(
      "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL)",
    );
    db.exec(sql);
    db.prepare("INSERT INTO schema_migrations VALUES(1,?)").run(digest(sql));
    db.exec("CREATE TABLE workspace_messages(synthetic_conflict TEXT)");
    db.close();
    assert.throws(() => new Store(tmp.db), /already exists/);
    const reopened = new DatabaseSync(tmp.db);
    try {
      assert.equal(
        reopened.prepare("SELECT COUNT(*) n FROM schema_migrations").get()!.n,
        1,
      );
      assert.equal(
        reopened
          .prepare(
            "SELECT name FROM sqlite_master WHERE name='console_sessions'",
          )
          .get(),
        undefined,
      );
      assert.equal(
        reopened
          .prepare(
            "SELECT name FROM sqlite_master WHERE name='workspace_projects'",
          )
          .get(),
        undefined,
      );
    } finally {
      reopened.close();
    }
  } finally {
    tmp.dispose();
  }
});
