import assert from "node:assert/strict";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { brokerFixture, gitExe } from "./broker-helpers.ts";
import { id } from "./helpers.ts";
import { digest } from "../packages/service/src/store.ts";
import { Store } from "../dist/packages/service/src/store.js";
import { DevelopmentBroker } from "../dist/packages/service/src/broker.js";
const output = resolve(
  process.env.BROKER_EVIDENCE ?? ".runtime/broker-walkthrough-" + Date.now(),
);
mkdirSync(resolve(output, ".."), { recursive: true });
mkdirSync(output);
const f = brokerFixture();
let reopened;
try {
  const broker = new DevelopmentBroker(f.s, gitExe, f.now);
  const claim = broker.claim(f.token, f.request);
  const first = broker.write(f.token, {
    project_id: f.ids.project,
    claim_id: claim.id,
    action_id: id(),
    edits: [
      { path: "src/main.txt", before_digest: null, text: "first checkpoint\n" },
    ],
  });
  const second = {
    project_id: f.ids.project,
    claim_id: claim.id,
    action_id: id(),
    edits: [
      {
        path: "src/main.txt",
        before_digest: digest("first checkpoint\n"),
        text: "recovered checkpoint\n",
      },
      {
        path: "src/extra.txt",
        before_digest: null,
        text: "complete changeset\n",
      },
    ],
  };
  const config = join(f.tmp.directory, "crash.json");
  writeFileSync(
    config,
    JSON.stringify({
      db: f.tmp.db,
      git: gitExe,
      now: f.now(),
      token: f.token,
      request: second,
      point: "ref_updated",
    }),
  );
  const crashed = spawnSync(
    process.execPath,
    ["tests/fixtures/broker-crash.ts", config],
    { windowsHide: true, encoding: "utf8", timeout: 30000 },
  );
  assert.equal(crashed.status, 86, crashed.stdout + crashed.stderr);
  reopened = new Store(f.tmp.db);
  const resumed = new DevelopmentBroker(reopened, gitExe, f.now);
  const recovered = resumed.write(f.token, second);
  assert.deepEqual(resumed.write(f.token, second), recovered);
  const finished = resumed.finish(f.token, f.ids.project, claim.id);
  const evidence = resumed.read(f.token, f.ids.project, claim.id);
  assert.equal(evidence.edits.length, 2);
  assert.equal(evidence.claim.state, "released");
  assert.equal(f.s.getResource(f.ids.task).data.status, "in_review");
  const commits = Number(
    execFileSync(gitExe, ["-C", f.root, "rev-list", "--count", "HEAD"], {
      encoding: "utf8",
      windowsHide: true,
    }).trim(),
  );
  assert.equal(commits, 3);
  // Synthetic repository/evidence only. Never export the temporary DB, token or child config.
  cpSync(f.root, join(output, "synthetic-repository"), {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  writeFileSync(
    join(output, "journal.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  writeFileSync(
    join(output, "changeset.json"),
    JSON.stringify(f.s.getResource(f.ids.candidate), null, 2) + "\n",
  );
  const report = {
    result: "PASS",
    scope: "LOCAL_DEVELOPMENT_ONLY",
    scenario: [
      "claim",
      "checkpoint",
      "process exit after Git update",
      "reopen/replay",
      "review handover",
    ],
    first,
    recovered,
    finished,
    checkpoint_commits: commits - 1,
    forced_exit_code: crashed.status,
    native_clients_started: 0,
    model_calls: 0,
    os_isolation: "UNVERIFIED",
    product_acceptance: "NOT_RUN",
  };
  writeFileSync(
    join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  reopened?.close();
  f.dispose();
}
