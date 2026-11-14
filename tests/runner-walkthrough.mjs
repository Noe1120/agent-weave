import assert from "node:assert/strict";
import { cpSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { runnerFixture, until, terminal } from "./runner-helpers.ts";
import { Store } from "../dist/packages/service/src/store.js";
import { DevelopmentBroker } from "../dist/packages/service/src/broker.js";
import { RunnerController } from "../dist/packages/service/src/runner.js";
import { gitExe } from "./broker-helpers.ts";
const output = resolve(
  process.env.RUNNER_EVIDENCE ?? ".runtime/runner-walkthrough-" + Date.now(),
);
mkdirSync(resolve(output, ".."), { recursive: true });
mkdirSync(output);
const results = [];
for (const scenario of ["success", "idle", "malformed"]) {
  const f = runnerFixture();
  const store = new Store(f.tmp.db),
    broker = new DevelopmentBroker(store, gitExe, f.now),
    runner = new RunnerController(store, broker, f.profile, f.now);
  try {
    const q = f.request(scenario);
    const started = runner.start(f.token, q);
    assert.equal(runner.start(f.token, q).execution_id, started.execution_id);
    if (scenario === "idle") {
      await until(
        () => runner.read(f.observerToken, f.ids.project, q.execution_id),
        (r) => r.events.length > 0,
      );
      const before = store.db.prepare("SELECT total_changes() n").get().n;
      for (let i = 0; i < 20; i++)
        runner.read(f.observerToken, f.ids.project, q.execution_id);
      assert.equal(
        store.db.prepare("SELECT total_changes() n").get().n,
        before,
      );
      runner.stop(f.observerToken, f.ids.project, q.execution_id);
    }
    const result = await until(
      () => runner.read(f.observerToken, f.ids.project, q.execution_id),
      (r) => terminal(r.state),
    );
    assert.equal(
      result.state,
      scenario === "success"
        ? "succeeded"
        : scenario === "idle"
          ? "stopped"
          : "failed",
      JSON.stringify(result),
    );
    assert.equal(result.exit.job_empty, true);
    const locks = Number(
      store.db.prepare("SELECT count(*) n FROM broker_locks").get().n,
    );
    const task = store.getResource(f.ids.task);
    assert.equal(
      task.data.status,
      scenario === "success" ? "in_review" : "running",
    );
    if (scenario === "success") {
      assert.equal(locks, 0);
      assert.equal(
        readFileSync(join(f.root, "src/main.txt"), "utf8"),
        "Development runner checkpoint\n",
      );
      const commits = Number(
        execFileSync(gitExe, ["-C", f.root, "rev-list", "--count", "HEAD"], {
          encoding: "utf8",
          windowsHide: true,
        }).trim(),
      );
      assert.equal(commits, 2);
      cpSync(f.root, join(output, "synthetic-repository"), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      writeFileSync(
        join(output, "changeset.json"),
        JSON.stringify(store.getResource(f.ids.candidate), null, 2) + "\n",
      );
      writeFileSync(
        join(output, "journal.json"),
        JSON.stringify(
          broker.read(f.token, f.ids.project, q.claim.claim_id),
          null,
          2,
        ) + "\n",
      );
    } else {
      assert.ok(locks > 0);
      assert.equal(store.getGrant(f.g.id).state, "revoked");
    }
    // Only synthetic, authorized projections; no DB, token, input configuration or raw environment values exported.
    writeFileSync(
      join(output, scenario + ".json"),
      JSON.stringify(result, null, 2) + "\n",
    );
    results.push({
      scenario,
      state: result.state,
      reason: result.reason,
      job_empty: true,
      task_status: task.data.status,
      locks_retained: locks,
      events: result.events.length,
    });
  } finally {
    await runner.shutdown();
    store.close();
    await f.dispose();
  }
}
const report = {
  result: "PASS",
  scope: "COMPILED_DEVELOPMENT_BACKEND_WALKTHROUGH",
  date: "2026-11-14",
  steps: [
    "trusted task admission",
    "fixed fixture launch",
    "read-only progress",
    "Broker edit",
    "Git checkpoint",
    "in_review",
    "cancel and still observe",
    "visible protocol failure",
  ],
  results,
  original_clients_started: 0,
  model_calls: 0,
  native_ui_exercised: false,
  os_isolation: "UNVERIFIED",
  qualification: "Not a production or original-client acceptance test",
};
writeFileSync(
  join(output, "report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
