import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { brokerFixture, gitExe } from "./broker-helpers.ts";
import {
  createRecovery,
  verifyRecovery,
  restoreRecovery,
} from "../packages/service/src/recovery.ts";
function setup() {
  const f = brokerFixture();
  const run = f.s.getRun(f.ids.run)!;
  run.state = "closed";
  f.s.putRun(run);
  return {
    ...f,
    options: {
      database: f.tmp.db,
      destination: join(f.tmp.directory, "backup"),
      git: gitExe,
      allowedUntracked: { [f.workspace]: ["scratch.bin"] },
    },
    restore: join(f.tmp.directory, "restored"),
  };
}
const git = (root: string, args: string[]) =>
  execFileSync(gitExe, ["-C", root, ...args], {
    windowsHide: true,
    encoding: "utf8",
  });
test("consistent DB plus all Git objects/index/dirty bytes restore without usable credentials", async () => {
  const f = setup();
  try {
    writeFileSync(join(f.root, "tracked.txt"), "staged\n");
    git(f.root, ["add", "--", "tracked.txt"]);
    writeFileSync(join(f.root, "tracked.txt"), "unstaged\n");
    writeFileSync(join(f.root, "scratch.bin"), Buffer.from([0, 1, 255, 3]));
    const status = git(f.root, ["status", "--porcelain=v1"]);
    const manifest = await createRecovery(f.options);
    assert.equal(manifest.status, "COMPLETE");
    assert.equal(verifyRecovery(f.options.destination).cut_id, manifest.cut_id);
    const result = restoreRecovery(f.options.destination, f.restore, gitExe);
    const repo = join(f.restore, "workspaces", f.workspace);
    assert.equal(readFileSync(join(repo, "tracked.txt"), "utf8"), "unstaged\n");
    assert.deepEqual(
      readFileSync(join(repo, "scratch.bin")),
      Buffer.from([0, 1, 255, 3]),
    );
    assert.equal(git(repo, ["show", ":tracked.txt"]), "staged\n");
    assert.equal(git(repo, ["status", "--porcelain=v1"]), status);
    const db = new DatabaseSync(result.database, { readOnly: true });
    try {
      assert.equal(
        db.prepare("SELECT COUNT(*) n FROM console_sessions").get()!.n,
        0,
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) n FROM console_pairings").get()!.n,
        0,
      );
      assert.equal(
        db
          .prepare(
            "SELECT json_extract(data,'$.state') state FROM grants WHERE id=?",
          )
          .get(f.ids.grant)!.state,
        "revoked",
      );
      assert.notEqual(
        db.prepare("SELECT token_hash FROM grants WHERE id=?").get(f.ids.grant)!
          .token_hash,
        f.s.db
          .prepare("SELECT token_hash FROM grants WHERE id=?")
          .get(f.ids.grant)!.token_hash,
      );
      assert.equal(
        db
          .prepare("SELECT root FROM broker_workspaces WHERE id=?")
          .get(f.workspace)!.root,
        repo,
      );
      assert.equal(
        db.prepare("PRAGMA integrity_check").get()!.integrity_check,
        "ok",
      );
    } finally {
      db.close();
    }
    assert.equal(f.s.getGrant(f.ids.grant)!.state, "active");
  } finally {
    f.dispose();
  }
});
for (const state of ["active", "unknown"] as const)
  test("refuses recovery cut while run " + state, async () => {
    const f = setup();
    try {
      const r = f.s.getRun(f.ids.run)!;
      r.state = state;
      f.s.putRun(r);
      await assert.rejects(createRecovery(f.options), /RECOVERY_NOT_QUIESCENT/);
      assert.equal(
        existsSync(join(f.options.destination, "manifest.json")),
        false,
      );
    } finally {
      f.dispose();
    }
  });
test("quarantined locks are not interpreted as stopped", async () => {
  const f = brokerFixture();
  try {
    f.broker.claim(f.token, f.request);
    const r = f.s.getRun(f.ids.run)!;
    r.state = "closed";
    f.s.putRun(r);
    f.broker.reconcileLiveness();
    await assert.rejects(
      createRecovery({
        database: f.tmp.db,
        destination: join(f.tmp.directory, "backup"),
        git: gitExe,
      }),
      /RECOVERY_NOT_QUIESCENT/,
    );
  } finally {
    f.dispose();
  }
});
test("missing repository refuses a COMPLETE manifest", async () => {
  const f = setup();
  try {
    f.s.db
      .prepare("UPDATE broker_workspaces SET root=?")
      .run(join(f.tmp.directory, "missing"));
    await assert.rejects(createRecovery(f.options), /RECOVERY_|ENOENT/);
    assert.equal(
      existsSync(join(f.options.destination, "manifest.json")),
      false,
    );
  } finally {
    f.dispose();
  }
});
test("unapproved untracked files are not silently omitted", async () => {
  const f = setup();
  try {
    writeFileSync(join(f.root, "unexpected.txt"), "untracked");
    await assert.rejects(createRecovery(f.options), /RECOVERY_UNTRACKED/);
  } finally {
    f.dispose();
  }
});
test("tampered or missing objects cannot restore", async () => {
  const f = setup();
  try {
    await createRecovery(f.options);
    writeFileSync(join(f.options.destination, "database.sqlite"), "corrupt");
    assert.throws(
      () => verifyRecovery(f.options.destination),
      /RECOVERY_INTEGRITY/,
    );
    assert.throws(
      () => restoreRecovery(f.options.destination, f.restore, gitExe),
      /RECOVERY_INTEGRITY/,
    );
    assert.equal(existsSync(f.restore), false);
  } finally {
    f.dispose();
  }
});
test("manifest traversal is rejected before any destination write", async () => {
  const f = setup();
  try {
    await createRecovery(f.options);
    const p = join(f.options.destination, "manifest.json");
    const m = JSON.parse(readFileSync(p, "utf8"));
    m.files[0].path = "../escape";
    writeFileSync(p, JSON.stringify(m));
    assert.throws(
      () => restoreRecovery(f.options.destination, f.restore, gitExe),
      /RECOVERY_|INVALID_PATH/,
    );
    assert.equal(existsSync(f.restore), false);
  } finally {
    f.dispose();
  }
});
test("restore and backup never overwrite existing targets", async () => {
  const f = setup();
  try {
    await createRecovery(f.options);
    await assert.rejects(
      createRecovery(f.options),
      /RECOVERY_DESTINATION_EXISTS/,
    );
    mkdirSync(f.restore);
    writeFileSync(join(f.restore, "keep.txt"), "keep");
    assert.throws(
      () => restoreRecovery(f.options.destination, f.restore, gitExe),
      /RECOVERY_DESTINATION_EXISTS/,
    );
    assert.equal(readFileSync(join(f.restore, "keep.txt"), "utf8"), "keep");
  } finally {
    f.dispose();
  }
});
test("Git alternates, split index and submodules fail closed", async () => {
  const f = setup();
  try {
    mkdirSync(join(f.root, ".git", "objects", "info"), { recursive: true });
    writeFileSync(
      join(f.root, ".git", "objects", "info", "alternates"),
      "../outside",
    );
    await assert.rejects(createRecovery(f.options), /RECOVERY_UNSUPPORTED_GIT/);
  } finally {
    f.dispose();
  }
});

test("changes during asynchronous SQLite backup invalidate the entire cut", async () => {
  const f = setup();
  try {
    writeFileSync(join(f.root, "scratch.bin"), "before");
    const pending = createRecovery(f.options);
    writeFileSync(join(f.root, "scratch.bin"), "after");
    await assert.rejects(pending, /RECOVERY_SOURCE_CHANGED/);
    assert.equal(
      existsSync(join(f.options.destination, "manifest.json")),
      false,
    );
  } finally {
    f.dispose();
  }
});
test("database write barrier prevents a concurrent platform mutation", async () => {
  const f = setup();
  let other: DatabaseSync | undefined;
  try {
    const pending = createRecovery(f.options);
    other = new DatabaseSync(f.tmp.db);
    other.exec("PRAGMA busy_timeout=1");
    assert.throws(
      () => other!.prepare("UPDATE runs SET data=data").run(),
      /locked/,
    );
    await pending;
    assert.doesNotThrow(() =>
      other!.prepare("UPDATE runs SET data=data").run(),
    );
  } finally {
    other?.close();
    f.dispose();
  }
});

test("manifest cannot silently drop a retained ignored file", async () => {
  const f = setup();
  try {
    writeFileSync(join(f.root, "scratch.bin"), "retained");
    await createRecovery(f.options);
    const p = join(f.options.destination, "manifest.json");
    const m = JSON.parse(readFileSync(p, "utf8"));
    m.repositories[0].files = [];
    writeFileSync(p, JSON.stringify(m));
    assert.throws(
      () => verifyRecovery(f.options.destination),
      /RECOVERY_CLOSURE/,
    );
  } finally {
    f.dispose();
  }
});
test("host existence without job-empty proof blocks the cut", async () => {
  const f = setup();
  try {
    const rid = "11111111-1111-4111-8111-111111111111";
    f.s.db
      .prepare("INSERT INTO runner_executions VALUES(?,?,?,?,?,?,?,?,?)")
      .run(
        rid,
        f.ids.project,
        f.ids.run,
        f.ids.grant,
        "synthetic-claim",
        f.ids.scope,
        "failed",
        "fixture",
        JSON.stringify({ host_pid: 123, worker_pid: null, exit: null }),
      );
    await assert.rejects(createRecovery(f.options), /RECOVERY_NOT_QUIESCENT/);
  } finally {
    f.dispose();
  }
});

test("Broker committed metadata absent from the working index is still tracked", async () => {
  const f = brokerFixture();
  try {
    const claim = f.broker.claim(f.token, f.request);
    f.broker.write(f.token, {
      project_id: f.ids.project,
      claim_id: claim.id,
      action_id: "22222222-2222-4222-8222-222222222222",
      edits: [
        { path: "src/main.txt", before_digest: null, text: "checkpoint\n" },
      ],
    });
    f.broker.finish(f.token, f.ids.project, claim.id);
    const run = f.s.getRun(f.ids.run)!;
    run.state = "closed";
    f.s.putRun(run);
    const manifest = await createRecovery({
      database: f.tmp.db,
      destination: join(f.tmp.directory, "backup"),
      git: gitExe,
    });
    assert.equal(manifest.status, "COMPLETE");
    assert.ok(
      manifest.repositories[0]!.files.some((p) => p.startsWith(".team/")),
    );
  } finally {
    f.dispose();
  }
});
