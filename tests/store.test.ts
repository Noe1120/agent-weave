import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../packages/service/src/store.ts";
test("migration creates durable transaction tables, once", () => {
  const s = new Store();
  try {
    const names = s.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name);
    for (const name of [
      "schema_migrations",
      "policies",
      "runs",
      "grants",
      "resources",
      "project_heads",
      "actions",
      "waits",
      "outbox",
      "continuation_inbox",
    ])
      assert.ok(names.includes(name), "missing " + name);
  } finally {
    s.close();
  }
});
