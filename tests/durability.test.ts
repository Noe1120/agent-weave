import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { fixture, success, error, id } from "./helpers.ts";
import { Store } from "../packages/service/src/store.ts";
import { CoreService } from "../packages/service/src/service.ts";
import type { TaskData, InputData } from "../packages/service/src/domain.ts";
import type { WaitRecord } from "../packages/contracts/src/index.ts";
import { tempWorkspace } from "./temp.ts";
test("migration is idempotent and rejects checksum or unknown future migration", () => {
  for (const sql of [
    "UPDATE schema_migrations SET checksum='tampered'",
    "INSERT INTO schema_migrations VALUES(5,'future')",
  ]) {
    const tmp = tempWorkspace();
    try {
      const a = new Store(tmp.db);
      a.close();
      const b = new Store(tmp.db);
      try {
        assert.equal(
          b.db.prepare("SELECT count(*) n FROM schema_migrations").get()!.n,
          4,
        );
        b.db.exec(sql);
      } finally {
        b.close();
      }
      assert.throws(() => new Store(tmp.db), /checksum|Unsupported/);
    } finally {
      tmp.dispose();
    }
  }
});
test("failed initial migration is rolled back including migration journal", () => {
  const tmp = tempWorkspace();
  try {
    const db = new DatabaseSync(tmp.db);
    db.exec("CREATE TABLE resources (id TEXT)");
    db.close();
    assert.throws(() => new Store(tmp.db), /already exists/);
    const reopened = new DatabaseSync(tmp.db);
    try {
      const names = reopened
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((r) => r.name);
      assert.deepEqual(names, ["resources"]);
    } finally {
      reopened.close();
    }
  } finally {
    tmp.dispose();
  }
});
test("credentials are hashed, not persisted in grant payload or DB columns", () => {
  const f = fixture();
  try {
    const row = f.s.db.prepare("SELECT * FROM grants").get()!;
    assert.notEqual(row.token_hash, f.token);
    assert.equal(String(row.token_hash).length, 64);
    assert.equal(JSON.stringify(row).includes(f.token), false);
  } finally {
    f.close();
  }
});
test("failure after mutations but before action receipt rolls back plan, task, budget, head and outbox", () => {
  const f = fixture();
  try {
    const q = f.apply();
    const head = f.s.head(f.ids.project);
    f.s.db.exec(
      "CREATE TRIGGER fail_action BEFORE INSERT ON actions BEGIN SELECT RAISE(ABORT,'synthetic before-commit failure'); END;",
    );
    assert.throws(() => f.service.execute(f.token, q), /before-commit/);
    assert.equal(f.s.getResource<TaskData>(f.ids.task)!.data.status, "draft");
    assert.equal(f.s.getResource(f.ids.root)!.data.budget_reserved, "0");
    assert.equal(f.s.getResource(f.ids.execution), undefined);
    assert.equal(f.s.head(f.ids.project), head);
    assert.equal(f.s.db.prepare("SELECT count(*) n FROM outbox").get()!.n, 0);
    f.s.db.exec("DROP TRIGGER fail_action");
    success(f.service.execute(f.token, q));
  } finally {
    f.close();
  }
});
test("inbox failure atomically rolls back wait consumption and action ledger", () => {
  const f = fixture();
  try {
    const t = f.s.getResource<TaskData>(f.ids.task)!;
    t.revision = "2";
    t.data.status = "completed";
    f.service.updateTask(t);
    const w = success(f.service.execute(f.token, f.register()))
      .data as WaitRecord;
    const q = f.req("consume_wait", {
      action_id: id(),
      wait_id: w.wait_id,
      workflow_id: w.workflow_id,
      run_id: w.run_id,
      run_epoch: w.run_epoch,
      resolution_id: w.resolution_id,
      expected_wait_revision: w.revision,
    });
    f.s.db.exec(
      "CREATE TRIGGER fail_inbox BEFORE INSERT ON continuation_inbox BEGIN SELECT RAISE(ABORT,'synthetic inbox failure'); END;",
    );
    assert.throws(() => f.service.execute(f.token, q), /inbox failure/);
    assert.equal(f.s.getWait(w.wait_id)!.record.state, "resolved");
    assert.equal(f.s.db.prepare("SELECT count(*) n FROM actions").get()!.n, 0);
    f.s.db.exec("DROP TRIGGER fail_inbox");
    success(f.service.execute(f.token, q));
  } finally {
    f.close();
  }
});
test("outbox failure rolls back target update and wait resolution together", () => {
  const f = fixture();
  try {
    const w = success(f.service.execute(f.token, f.register()))
      .data as WaitRecord;
    const t = f.s.getResource<TaskData>(f.ids.task)!;
    t.revision = "2";
    t.data.status = "completed";
    f.s.db.exec(
      "CREATE TRIGGER fail_wakeup BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT,'synthetic wakeup failure'); END;",
    );
    assert.throws(() => f.service.updateTask(t), /wakeup failure/);
    assert.equal(f.s.getResource(f.ids.task)!.revision, "1");
    assert.equal(f.s.getWait(w.wait_id)!.record.state, "registered");
  } finally {
    f.close();
  }
});
test("lost committed response + database reopen preserves exact receipt and single continuation", () => {
  const tmp = tempWorkspace();
  const f = fixture(tmp.db);
  let closed = false;
  try {
    const t = f.s.getResource<TaskData>(f.ids.task)!;
    t.revision = "2";
    t.data.status = "completed";
    f.service.updateTask(t);
    const w = success(f.service.execute(f.token, f.register()))
      .data as WaitRecord;
    const q = f.req("consume_wait", {
      action_id: id(),
      wait_id: w.wait_id,
      workflow_id: w.workflow_id,
      run_id: w.run_id,
      run_epoch: w.run_epoch,
      resolution_id: w.resolution_id,
      expected_wait_revision: w.revision,
    });
    const first = success(f.service.execute(f.token, q));
    f.close();
    closed = true;
    const reopened = new Store(tmp.db);
    try {
      const service = new CoreService(reopened, f.now);
      const retried = success(
        service.execute(f.token, { ...q, request_id: id() }),
      );
      assert.deepEqual(retried.data, first.data);
      assert.equal(
        reopened.db.prepare("SELECT count(*) n FROM continuation_inbox").get()!
          .n,
        1,
      );
      reopened.updateGrant({ ...f.g, state: "revoked" });
      error(service.execute(f.token, q), "GRANT_REVOKED");
    } finally {
      reopened.close();
    }
  } finally {
    if (!closed) f.close();
    tmp.dispose();
  }
});
test("separate connections serialize the plan head; duplicate effects cannot reapply", () => {
  const tmp = tempWorkspace();
  const f = fixture(tmp.db);
  const second = new Store(tmp.db);
  try {
    const q = f.apply();
    const original = success(f.service.execute(f.token, q));
    const service = new CoreService(second, f.now);
    assert.deepEqual(success(service.execute(f.token, q)).data, original.data);
    error(
      service.execute(f.token, { ...q, action_id: id() } as typeof q),
      "PLAN_STALE",
    );
    assert.equal(
      second.db.prepare("SELECT count(*) n FROM outbox").get()!.n,
      1,
    );
  } finally {
    second.close();
    f.close();
    tmp.dispose();
  }
});
