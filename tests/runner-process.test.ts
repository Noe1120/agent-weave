import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runnerFixture, until, terminal } from "./runner-helpers.ts";
import { id } from "./helpers.ts";
import { RunnerController } from "../packages/service/src/runner.ts";
test("runner rejects drift and unauthorized starts without reserving work or acquiring claims", async () => {
  const f = runnerFixture();
  try {
    const drift = structuredClone(f.profile);
    drift.worker.sha256 = "0".repeat(64);
    const r = new RunnerController(f.s, f.broker, drift, f.now);
    assert.throws(() => r.start(f.token, f.request()), /PROFILE_DRIFT/);
    assert.throws(
      () => f.runner.start(f.observerToken, f.request()),
      /NOT_FOUND_OR_DENIED/,
    );
    assert.equal(
      f.s.db.prepare("SELECT count(*) n FROM broker_claims").get()!.n,
      0,
    );
    assert.equal(
      f.s.db.prepare("SELECT count(*) n FROM runner_executions").get()!.n,
      0,
    );
  } finally {
    await f.dispose();
  }
});
test("actual development process patches through Broker, creates a real checkpoint and only reaches in_review", async () => {
  const f = runnerFixture();
  try {
    const q = f.request();
    f.runner.start(f.token, q);
    f.runner.start(f.token, q);
    const result = await until(
      () => f.runner.read(f.observerToken, f.ids.project, q.execution_id),
      (r) => terminal(r.state),
    );
    assert.equal(result.state, "succeeded", JSON.stringify(result));
    assert.equal(result.exit?.job_empty, true);
    assert.equal(result.binding_mode, "owned_process");
    assert.equal(
      readFileSync(join(f.root, "src/main.txt"), "utf8"),
      "Development runner checkpoint\n",
    );
    assert.equal(f.s.getResource(f.ids.task)!.data.status, "in_review");
    assert.equal(
      f.s.db.prepare("SELECT count(*) n FROM runner_executions").get()!.n,
      1,
    );
    assert.equal(
      f.s.db
        .prepare(
          "SELECT count(*) n FROM broker_edits WHERE phase='checkpointed'",
        )
        .get()!.n,
      1,
    );
    assert.equal(
      f.s.db.prepare("SELECT count(*) n FROM broker_locks").get()!.n,
      0,
    );
    const stored = JSON.stringify(
      f.s.db.prepare("SELECT * FROM runner_executions").all(),
    );
    assert.ok(!stored.includes(f.token));
    assert.throws(
      () => f.runner.start(f.token, { ...q, input: { scenario: "idle" } }),
      /PAYLOAD_CONFLICT/,
    );
    assert.throws(
      () => f.runner.start(f.token, { ...q, execution_id: id() }),
      /RUN_ALREADY_BOUND/,
    );
  } finally {
    await f.dispose();
  }
});
test("progress reads are side-effect free; stop revokes worker but leaves supervisor access and locks", async () => {
  const f = runnerFixture();
  try {
    const q = f.request("idle");
    f.runner.start(f.token, q);
    const observed = await until(
      () => f.runner.read(f.observerToken, f.ids.project, q.execution_id),
      (r) => r.events.length > 0,
    );
    assert.equal(observed.events[0]!.kind, "progress");
    const initial = JSON.stringify(observed);
    const changes = f.s.db.prepare("SELECT total_changes() n").get()!.n;
    for (let i = 0; i < 20; i++)
      assert.equal(
        JSON.stringify(
          f.runner.read(f.observerToken, f.ids.project, q.execution_id),
        ),
        initial,
      );
    assert.equal(f.s.db.prepare("SELECT total_changes() n").get()!.n, changes);
    const info = JSON.parse((observed.events[0] as { text: string }).text);
    assert.equal(info.input_count, 1);
    assert.ok(!info.env.includes("OPENAI_API_KEY"));
    assert.notEqual(info.cwd, f.root);
    assert.throws(
      () => f.runner.read(f.token, f.ids.project, q.execution_id),
      /NOT_FOUND_OR_DENIED/,
    );
    assert.throws(
      () => f.runner.read(f.observerToken, id(), q.execution_id),
      /NOT_FOUND_OR_DENIED/,
    );
    f.runner.stop(f.observerToken, f.ids.project, q.execution_id);
    assert.equal(f.s.getGrant(f.g.id)!.state, "revoked");
    const end = await until(
      () => f.runner.read(f.observerToken, f.ids.project, q.execution_id),
      (r) => terminal(r.state),
    );
    assert.equal(end.state, "stopped", JSON.stringify(end));
    assert.equal(end.reason, "USER_STOP");
    assert.equal(end.exit?.job_empty, true);
    assert.equal(
      f.s.db
        .prepare("SELECT state FROM broker_claims WHERE id=?")
        .get(q.claim.claim_id)!.state,
      "quarantined",
    );
    assert.ok(
      Number(f.s.db.prepare("SELECT count(*) n FROM broker_locks").get()!.n) >
        0,
    );
  } finally {
    await f.dispose();
  }
});
for (const [scenario, want] of [
  ["malformed", "PROTOCOL_JSON"],
  ["oversized", "PROTOCOL_FRAME_LIMIT"],
  ["invalid_utf8", "PROTOCOL_UTF8"],
  ["stderr", "STDERR_LIMIT"],
  ["fake_exit", "PROTOCOL_KIND"],
  ["out_of_order", "PROTOCOL_SEQUENCE"],
  ["nonzero", "WORKER_EXIT_NONZERO"],
  ["no_complete", "PROTOCOL_NO_COMPLETE"],
  ["conflict", "PROTOCOL_REPLAY_CONFLICT"],
  ["flood", "PROTOCOL_OUTPUT_LIMIT"],
] as const)
  test(`runner surfaces ${scenario}, never succeeds and retains quarantined locks`, async () => {
    const f = runnerFixture();
    try {
      const q = f.request(scenario);
      f.runner.start(f.token, q);
      const r = await until(
        () => f.runner.read(f.observerToken, f.ids.project, q.execution_id),
        (r) => terminal(r.state),
      );
      assert.equal(r.state, "failed", JSON.stringify(r));
      assert.equal(r.reason, want);
      assert.equal(r.exit?.job_empty, true);
      assert.equal(f.s.getGrant(f.g.id)!.state, "revoked");
      assert.ok(
        Number(f.s.db.prepare("SELECT count(*) n FROM broker_locks").get()!.n) >
          0,
      );
    } finally {
      await f.dispose();
    }
  });
test("identical patch replay receives the same receipt without repeating a Git checkpoint", async () => {
  const f = runnerFixture();
  try {
    const q = f.request("replay");
    f.runner.start(f.token, q);
    const r = await until(
      () => f.runner.read(f.observerToken, f.ids.project, q.execution_id),
      (r) => terminal(r.state),
    );
    assert.equal(r.state, "succeeded", JSON.stringify(r));
    assert.equal(r.events.length, 3);
    assert.equal(r.input_count, 5);
    assert.equal(
      f.s.db.prepare("SELECT count(*) n FROM broker_edits").get()!.n,
      1,
    );
  } finally {
    await f.dispose();
  }
});
test("timeout, expired lease and revoked execution each stop the owned process without releasing locks", async () => {
  for (const mode of ["timeout", "lease", "revoked"]) {
    const f = runnerFixture();
    try {
      const q = f.request("idle");
      if (mode === "timeout") q.timeout_ms = 500;
      f.runner.start(f.token, q);
      if (mode !== "timeout") {
        await until(
          () => f.runner.read(f.observerToken, f.ids.project, q.execution_id),
          (r) => r.events.length > 0,
        );
        if (mode === "lease") f.advance(60001);
        else {
          f.g.state = "revoked";
          f.s.updateGrant(f.g);
        }
      }
      const r = await until(
        () => f.runner.read(f.observerToken, f.ids.project, q.execution_id),
        (r) => terminal(r.state),
      );
      assert.equal(r.state, "failed", JSON.stringify(r));
      assert.equal(
        r.reason,
        mode === "timeout"
          ? "TIMEOUT"
          : mode === "lease"
            ? "CLAIM_QUARANTINED"
            : "GRANT_REVOKED",
      );
      assert.equal(r.exit?.job_empty, true);
      assert.ok(
        Number(f.s.db.prepare("SELECT count(*) n FROM broker_locks").get()!.n) >
          0,
      );
    } finally {
      await f.dispose();
    }
  }
});
test("observer permissions are rechecked for every derivative, and another scope cannot read this execution", async () => {
  const f = runnerFixture();
  try {
    const q = f.request("idle");
    f.runner.start(f.token, q);
    await until(
      () => f.runner.read(f.observerToken, f.ids.project, q.execution_id),
      (r) => r.events.length > 0,
    );
    const candidate = f.s.getResource(f.ids.candidate)!;
    candidate.acl = candidate.acl.filter((g) => g !== f.observer.id);
    f.s.putResource(candidate);
    assert.throws(
      () => f.runner.read(f.observerToken, f.ids.project, q.execution_id),
      /NOT_FOUND_OR_DENIED/,
    );
    assert.throws(
      () => f.runner.stop(f.observerToken, f.ids.project, q.execution_id),
      /NOT_FOUND_OR_DENIED/,
    );
    candidate.acl.push(f.observer.id);
    f.s.putResource(candidate);
    const observer = f.s.getGrant(f.observer.id)!;
    observer.resource_ids = observer.resource_ids.filter(
      (id) => id !== f.ids.scope,
    );
    f.s.updateGrant(observer);
    assert.throws(
      () => f.runner.read(f.observerToken, f.ids.project, q.execution_id),
      /NOT_FOUND_OR_DENIED/,
    );
  } finally {
    await f.dispose();
  }
});
test("runner success and Broker release must share a transaction, not leave a released claim when recording success fails", async () => {
  const f = runnerFixture();
  try {
    f.s.db.exec(
      "CREATE TRIGGER reject_runner_success BEFORE UPDATE ON runner_executions WHEN NEW.state='succeeded' BEGIN SELECT RAISE(ABORT,'test storage failure'); END",
    );
    const q = f.request();
    f.runner.start(f.token, q);
    const r = await until(
      () => f.runner.read(f.observerToken, f.ids.project, q.execution_id),
      (r) => terminal(r.state),
    );
    assert.equal(r.state, "failed");
    assert.equal(r.reason, "RUNNER_INTERNAL_FAILURE");
    assert.equal(f.s.getResource(f.ids.task)!.data.status, "running");
    assert.ok(
      Number(f.s.db.prepare("SELECT count(*) n FROM broker_locks").get()!.n) >
        0,
    );
  } finally {
    await f.dispose();
  }
});
for (const scenario of ["unauthorized_patch", "complete_hold"] as const)
  test(`runner ${scenario} cannot escape its scope or release before process exit`, async () => {
    const f = runnerFixture();
    try {
      const q = { ...f.request(), input: { scenario } };
      f.runner.start(f.token, q);
      if (scenario === "complete_hold") {
        const e = await until(
          () => f.runner.read(f.observerToken, f.ids.project, q.execution_id),
          (e) => e.complete,
        );
        assert.equal(e.state, "running");
        assert.equal(f.s.getResource(f.ids.task)!.data.status, "running");
        f.runner.stop(f.observerToken, f.ids.project, q.execution_id);
      }
      const e = await until(
        () => f.runner.read(f.observerToken, f.ids.project, q.execution_id),
        (e) => terminal(e.state),
      );
      assert.equal(
        e.state,
        scenario === "complete_hold" ? "stopped" : "failed",
      );
      assert.ok(
        Number(f.s.db.prepare("SELECT count(*) n FROM broker_locks").get()!.n) >
          0,
      );
      assert.equal(f.s.getResource(f.ids.task)!.data.status, "running");
      if (scenario === "unauthorized_patch")
        assert.equal(
          f.s.db.prepare("SELECT count(*) n FROM broker_edits").get()!.n,
          0,
        );
    } finally {
      await f.dispose();
    }
  });
