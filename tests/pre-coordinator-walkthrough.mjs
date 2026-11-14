import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { brokerFixture, gitExe } from "./broker-helpers.ts";
import { dependencyFixture, provision } from "./dependency-helpers.ts";
import { id, ref } from "./helpers.ts";
import { DependencyService } from "../dist/packages/service/src/dependencies.js";
import { KnowledgeReader } from "../dist/packages/service/src/knowledge.js";
import { DevelopmentBroker } from "../dist/packages/service/src/broker.js";
import {
  createRecovery,
  verifyRecovery,
  restoreRecovery,
} from "../dist/packages/service/src/recovery.js";
import { Store } from "../dist/packages/service/src/store.js";
const output = resolve(
  process.env.FOUNDATIONS_EVIDENCE ??
    ".runtime/foundations-walkthrough-" + Date.now(),
);
mkdirSync(output, { recursive: true });
const steps = [];
const b = brokerFixture(),
  f = dependencyFixture(b);
try {
  const dependencies = new DependencyService(f.s, f.now),
    broker = new DevelopmentBroker(f.s, gitExe, f.now);
  dependencies.capture(f.token, f.request());
  const claim = broker.claim(f.token, {
    ...b.request,
    expected_task_revision: "2",
  });
  broker.write(f.token, {
    project_id: f.ids.project,
    claim_id: claim.id,
    action_id: id(),
    edits: [
      {
        path: "src/main.txt",
        before_digest: null,
        text: "authorized dependent work\n",
      },
    ],
  });
  const source = f.s.getResource(f.base);
  source.revision = "2";
  f.s.putResource(source);
  assert.equal(
    dependencies.read(f.token, f.ids.project, f.snapshot).validity,
    "stale",
  );
  assert.throws(
    () =>
      broker.write(f.token, {
        project_id: f.ids.project,
        claim_id: claim.id,
        action_id: id(),
        edits: [
          {
            path: "src/extra.txt",
            before_digest: null,
            text: "must not write",
          },
        ],
      }),
    /PLAN_STALE/,
  );
  assert.throws(
    () => broker.finish(f.token, f.ids.project, claim.id),
    /PLAN_STALE/,
  );
  broker.reconcileLiveness();
  const locks = Number(
    f.s.db.prepare("SELECT count(*) n FROM broker_locks").get().n,
  );
  assert.equal(locks, 3);
  assert.equal(f.s.getResource(f.ids.task).data.status, "running");
  steps.push({
    step: "dependency_invalidation",
    validity: "stale",
    task: "running",
    retained_locks: locks,
    automatic_retry: false,
  });
  const doc = id(),
    hidden = id();
  provision(f, [doc, hidden], []);
  for (const rid of [doc, hidden])
    f.s.putResource({
      id: rid,
      project_id: f.ids.project,
      kind: "knowledge_document",
      revision: "1",
      domain: f.g.domain,
      acl: rid === hidden ? [] : [f.g.id],
      dependencies: [],
      data: {
        title: "Project note",
        text: "Authorized project recovery note",
        source_refs: [ref(f.base, "2")],
      },
    });
  const reader = new KnowledgeReader(f.s, f.now);
  const before = f.s.db.prepare("SELECT total_changes() n").get().n;
  for (let i = 0; i < 100; i++) {
    const results = reader.search(f.token, f.ids.project, "recovery", 10);
    assert.equal(results.length, 1);
    assert.equal(results[0].id, doc);
  }
  assert.equal(f.s.db.prepare("SELECT total_changes() n").get().n, before);
  f.g.state = "revoked";
  f.s.updateGrant(f.g);
  assert.throws(
    () => reader.read(f.token, f.ids.project, doc),
    /GRANT_REVOKED/,
  );
  steps.push({
    step: "authorized_retrieval",
    read_count: 100,
    read_mutations: 0,
    hidden_results: 0,
    revocation: "DENIED",
  });
} finally {
  b.dispose();
}
const r = brokerFixture();
try {
  const broker = new DevelopmentBroker(r.s, gitExe, r.now),
    claim = broker.claim(r.token, r.request);
  broker.write(r.token, {
    project_id: r.ids.project,
    claim_id: claim.id,
    action_id: id(),
    edits: [
      {
        path: "src/main.txt",
        before_digest: null,
        text: "checkpoint before recovery\n",
      },
    ],
  });
  broker.finish(r.token, r.ids.project, claim.id);
  const run = r.s.getRun(r.ids.run);
  run.state = "closed";
  r.s.putRun(run);
  writeFileSync(join(r.root, "src/main.txt"), "staged recovery content\n");
  execFileSync(gitExe, ["-C", r.root, "add", "--", "src/main.txt"], {
    windowsHide: true,
  });
  writeFileSync(join(r.root, "src/main.txt"), "unstaged recovery content\n");
  writeFileSync(join(r.root, "scratch.bin"), Buffer.from([0, 255, 2]));
  const backup = join(output, "local-backup"),
    restored = join(output, "local-restored");
  const manifest = await createRecovery({
    database: r.tmp.db,
    destination: backup,
    git: gitExe,
    allowedUntracked: { [r.workspace]: ["scratch.bin"] },
  });
  verifyRecovery(backup);
  const result = restoreRecovery(backup, restored, gitExe);
  assert.equal(
    readFileSync(
      join(restored, "workspaces", r.workspace, "src/main.txt"),
      "utf8",
    ),
    "unstaged recovery content\n",
  );
  const restoredStore = new Store(result.database);
  try {
    assert.equal(restoredStore.getGrant(r.ids.grant).state, "revoked");
    assert.equal(restoredStore.grantForToken(r.token), undefined);
  } finally {
    restoredStore.close();
  }
  steps.push({
    step: "offline_recovery",
    manifest: manifest.status,
    restored: result.state,
    staged_and_unstaged: "PRESERVED",
    binary: "PRESERVED",
    old_token: "REJECTED",
    automatic_resume: false,
  });
} finally {
  r.dispose();
}
const report = {
  qualification: "COMPILED_DEVELOPMENT_BACKEND_WALKTHROUGH",
  steps,
  native_click_acceptance: "NOT_RUN",
  native_clients_started: 0,
  model_calls: 0,
  coordinator_implemented: false,
  os_isolation: "UNVERIFIED",
};
writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2), {
  flag: "wx",
});
console.log(JSON.stringify(report, null, 2));
