import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync, execFileSync } from "node:child_process";
import { join } from "node:path";
import { Store, digest } from "../packages/service/src/store.ts";
import { DevelopmentBroker } from "../packages/service/src/broker.ts";
import { brokerFixture, gitExe } from "./broker-helpers.ts";
import { id } from "./helpers.ts";
const request = (f: ReturnType<typeof brokerFixture>) => ({
  project_id: f.ids.project,
  claim_id: f.request.claim_id,
  action_id: id(),
  edits: [
    { path: "src/main.txt", before_digest: null, text: "first\n" },
    { path: "src/extra.txt", before_digest: null, text: "second\n" },
  ],
});

for (const point of [
  "prepared",
  "file_written",
  "files_applied",
  "ref_updated",
])
  test(`broker resumes after real process exit at ${point} without duplicate checkpoint`, () => {
    const f = brokerFixture();
    try {
      f.broker.claim(f.token, f.request);
      const q = request(f);
      const config = join(f.tmp.directory, "crash.json");
      writeFileSync(
        config,
        JSON.stringify({
          db: f.tmp.db,
          git: gitExe,
          now: f.now(),
          token: f.token,
          request: q,
          point,
        }),
      );
      const child = spawnSync(
        process.execPath,
        ["tests/fixtures/broker-crash.ts", config],
        { encoding: "utf8", windowsHide: true, timeout: 30000 },
      );
      assert.equal(child.status, 86, child.stdout + child.stderr);
      const reopened = new Store(f.tmp.db);
      try {
        const broker = new DevelopmentBroker(reopened, gitExe, f.now);
        const recovered = broker.write(f.token, q);
        assert.equal(recovered.phase, "checkpointed");
        assert.equal(
          readFileSync(join(f.root, "src/extra.txt"), "utf8"),
          "second\n",
        );
        assert.deepEqual(broker.write(f.token, q), recovered);
        assert.equal(
          reopened.db.prepare("SELECT count(*) n FROM broker_edits").get()!.n,
          1,
        );
        assert.equal(
          execFileSync(gitExe, ["-C", f.root, "rev-list", "--count", "HEAD"], {
            encoding: "utf8",
            windowsHide: true,
          }).trim(),
          "2",
        );
        broker.finish(f.token, f.ids.project, f.request.claim_id);
        assert.equal(
          reopened.getResource(f.ids.task)!.data.status,
          "in_review",
        );
      } finally {
        reopened.close();
      }
    } finally {
      f.dispose();
    }
  });

test("broker duplicate delivery between durable stages observes current phase instead of quarantining success", () => {
  const f = brokerFixture();
  try {
    f.broker.claim(f.token, f.request);
    const q = request(f);
    let once = false;
    const concurrent = new Store(f.tmp.db);
    try {
      const second = new DevelopmentBroker(concurrent, gitExe, f.now);
      const first = new DevelopmentBroker(f.s, gitExe, f.now, (point) => {
        if (point === "prepared" && !once) {
          once = true;
          second.write(f.token, q);
        }
      });
      const result = first.write(f.token, q);
      assert.equal(result.phase, "checkpointed");
      assert.equal(
        f.broker.read(f.token, f.ids.project, q.claim_id).claim.state,
        "active",
      );
      assert.equal(f.s.getResource(f.ids.candidate)!.revision, "2");
    } finally {
      concurrent.close();
    }
  } finally {
    f.dispose();
  }
});

test("broker refuses unrecorded human changes even when caller supplies matching filesystem digest", () => {
  const f = brokerFixture();
  try {
    f.broker.claim(f.token, f.request);
    mkdirSync(join(f.root, "src"));
    writeFileSync(join(f.root, "src/main.txt"), "human");
    const q = request(f);
    q.edits[0] = {
      path: "src/main.txt",
      before_digest: digest("human") as never,
      text: "overwrite",
    };
    assert.throws(() => f.broker.write(f.token, q), /BASELINE_CONFLICT/);
    assert.equal(readFileSync(join(f.root, "src/main.txt"), "utf8"), "human");
    assert.equal(
      f.s.db.prepare("SELECT count(*) n FROM broker_edits").get()!.n,
      0,
    );
  } finally {
    f.dispose();
  }
});

test("broker does not hand over a checkpoint with extra unrecorded files", () => {
  const f = brokerFixture();
  try {
    f.broker.claim(f.token, f.request);
    f.broker.write(f.token, request(f));
    writeFileSync(join(f.root, "unrecorded.txt"), "outside declared set");
    assert.throws(
      () => f.broker.finish(f.token, f.ids.project, f.request.claim_id),
      /RECOVERY_CONFLICT/,
    );
    assert.equal(
      f.s.db.prepare("SELECT count(*) n FROM broker_locks").get()!.n,
      3,
    );
    assert.equal(f.s.getResource(f.ids.task)!.data.status, "running");
  } finally {
    f.dispose();
  }
});

test("broker crash recovery refuses unknown content and retains quarantine locks", () => {
  const f = brokerFixture();
  try {
    f.broker.claim(f.token, f.request);
    const q = request(f);
    const config = join(f.tmp.directory, "crash.json");
    writeFileSync(
      config,
      JSON.stringify({
        db: f.tmp.db,
        git: gitExe,
        now: f.now(),
        token: f.token,
        request: q,
        point: "file_written",
      }),
    );
    assert.equal(
      spawnSync(process.execPath, ["tests/fixtures/broker-crash.ts", config], {
        windowsHide: true,
        timeout: 30000,
      }).status,
      86,
    );
    writeFileSync(join(f.root, "src/main.txt"), "unknown writer");
    assert.throws(() => f.broker.write(f.token, q), /RECOVERY_CONFLICT/);
    assert.equal(
      f.s.db.prepare("SELECT state FROM broker_claims").get()!.state,
      "quarantined",
    );
    assert.equal(
      f.s.db.prepare("SELECT count(*) n FROM broker_locks").get()!.n,
      3,
    );
    assert.equal(
      readFileSync(join(f.root, "src/main.txt"), "utf8"),
      "unknown writer",
    );
  } finally {
    f.dispose();
  }
});

test("broker refuses an externally moved Git head without resetting it or releasing locks", () => {
  const f = brokerFixture();
  try {
    const claim = f.broker.claim(f.token, f.request),
      q = request(f);
    f.broker.write(f.token, q);
    execFileSync(
      gitExe,
      ["-C", f.root, "update-ref", "HEAD", claim.base_commit],
      { windowsHide: true },
    );
    assert.throws(
      () =>
        f.broker.write(f.token, {
          ...q,
          action_id: id(),
          edits: [
            {
              path: "src/main.txt",
              before_digest: digest("first\n"),
              text: "must not overwrite",
            },
          ],
        }),
      /GIT_BASELINE_CONFLICT/,
    );
    assert.throws(
      () => f.broker.finish(f.token, f.ids.project, q.claim_id),
      /GIT_BASELINE_CONFLICT/,
    );
    assert.equal(
      execFileSync(gitExe, ["-C", f.root, "rev-parse", "HEAD"], {
        encoding: "utf8",
        windowsHide: true,
      }).trim(),
      claim.base_commit,
    );
    assert.equal(readFileSync(join(f.root, "src/main.txt"), "utf8"), "first\n");
    assert.equal(
      f.s.db.prepare("SELECT count(*) n FROM broker_locks").get()!.n,
      3,
    );
  } finally {
    f.dispose();
  }
});
