import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { runnerFixture, until, terminal } from "./runner-helpers.ts";
import { RunnerController } from "../packages/service/src/runner.ts";
import { DevelopmentBroker } from "../packages/service/src/broker.ts";
import { Store } from "../packages/service/src/store.ts";
import { gitExe } from "./broker-helpers.ts";
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
test("host death is UNKNOWN without trusted Job-empty evidence, even if the worker also disappears", async () => {
  const f = runnerFixture();
  try {
    const q = { ...f.request(), input: { scenario: "host_crash" } };
    f.runner.start(f.token, q);
    const r = await until(
      () => f.runner.read(f.observerToken, f.ids.project, q.execution_id),
      (r) => terminal(r.state),
    );
    assert.equal(r.state, "unknown", JSON.stringify(r));
    assert.equal(r.exit, null);
    assert.equal(f.s.getRun(f.ids.run)!.state, "unknown");
    assert.equal(f.s.getGrant(f.g.id)!.state, "revoked");
    assert.ok(
      Number(f.s.db.prepare("SELECT count(*) n FROM broker_locks").get()!.n) >
        0,
    );
    await until(
      () => alive(r.worker_pid!),
      (v) => !v,
    );
  } finally {
    await f.dispose();
  }
});
test("actual controller process death closes its host input; restart quarantines without PID killing, restart or lock release", async () => {
  const f = runnerFixture();
  let reopened: Store | undefined;
  const unrelated = spawn(
    process.execPath,
    ["-e", "setInterval(()=>{},1000)"],
    { stdio: "ignore", windowsHide: true },
  );
  const child = spawn(
    process.execPath,
    ["tests/fixtures/runner-controller-crash.ts"],
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
  );
  let err = "";
  child.stderr.on("data", (s) => (err += s));
  const closed = new Promise((resolve) => child.once("close", resolve));
  try {
    const q = f.request("idle");
    const ready = new Promise<{ worker_pid: number; host_pid: number }>(
      (resolve, reject) => {
        createInterface({ input: child.stdout }).once("line", (s) =>
          resolve(JSON.parse(s)),
        );
        child.once("exit", (code) => {
          if (code !== null)
            reject(new Error(err || "Controller exited before ready"));
        });
      },
    );
    child.stdin.end(
      JSON.stringify({
        db: f.tmp.db,
        git: gitExe,
        now: f.now(),
        profile: f.profile,
        token: f.token,
        request: q,
      }) + "\n",
    );
    const pids = await Promise.race([
      ready,
      new Promise<never>((_, reject) => {
        const t = setTimeout(
          () => reject(new Error("Controller readiness timeout: " + err)),
          15000,
        );
        t.unref();
      }),
    ]);
    assert.ok(alive(pids.worker_pid));
    child.kill();
    await closed;
    await until(
      () => alive(pids.worker_pid),
      (v) => !v,
    );
    await until(
      () => alive(pids.host_pid),
      (v) => !v,
    );
    reopened = new Store(f.tmp.db);
    const controller = new RunnerController(
      reopened,
      new DevelopmentBroker(reopened, gitExe, f.now),
      f.profile,
      f.now,
    );
    assert.equal(controller.recoverOrphans(), 1);
    assert.equal(controller.recoverOrphans(), 0);
    const observed = controller.read(
      f.observerToken,
      f.ids.project,
      q.execution_id,
    );
    assert.equal(observed.state, "unknown");
    assert.equal(observed.reason, "CONTROLLER_LOST");
    assert.equal(observed.exit, null);
    assert.equal(reopened.getGrant(f.g.id)!.state, "revoked");
    assert.equal(
      reopened.db.prepare("SELECT state FROM broker_claims").get()!.state,
      "quarantined",
    );
    assert.ok(
      Number(
        reopened.db.prepare("SELECT count(*) n FROM broker_locks").get()!.n,
      ) > 0,
    );
    assert.ok(alive(unrelated.pid!));
    const count = reopened.db
      .prepare("SELECT count(*) n FROM runner_executions")
      .get()!.n;
    assert.throws(() => controller.start(f.token, q), /GRANT_REVOKED/);
    assert.equal(
      reopened.db.prepare("SELECT count(*) n FROM runner_executions").get()!.n,
      count,
    );
  } finally {
    child.kill();
    await closed;
    unrelated.kill();
    await new Promise((r) => unrelated.once("close", r));
    reopened?.close();
    await f.dispose();
  }
});

test("startup persistence failure still tracks and reaps the newly spawned host", async () => {
  const f = runnerFixture();
  const child = spawn(
    process.execPath,
    ["tests/fixtures/runner-controller-crash.ts"],
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
  );
  let output = "",
    err = "";
  child.stdout.on("data", (s) => (output += s));
  child.stderr.on("data", (s) => (err += s));
  const closed = new Promise((resolve) => child.once("close", resolve));
  try {
    f.s.db.exec(
      "CREATE TRIGGER reject_spawn_record BEFORE UPDATE ON runner_executions WHEN NEW.state='starting' AND json_extract(NEW.data,'$.host_pid') IS NOT NULL BEGIN SELECT RAISE(ABORT,'startup storage failure'); END",
    );
    const q = f.request("idle");
    child.stdin.end(
      JSON.stringify({
        mode: "startup_failure",
        db: f.tmp.db,
        git: gitExe,
        now: f.now(),
        profile: f.profile,
        token: f.token,
        request: q,
      }) + "\n",
    );
    const timeout = setTimeout(() => child.kill(), 15000);
    await closed;
    clearTimeout(timeout);
    assert.ok(output, err);
    const result = JSON.parse(output);
    if (result.execution.host_pid)
      await until(
        () => alive(result.execution.host_pid),
        (v) => !v,
      );
    assert.match(result.error, /startup storage failure/);
    assert.equal(result.execution.state, "failed");
    assert.equal(result.execution.exit?.job_empty, true);
    assert.equal(f.s.getGrant(f.g.id)!.state, "revoked");
    assert.ok(
      Number(f.s.db.prepare("SELECT count(*) n FROM broker_locks").get()!.n) >
        0,
    );
  } finally {
    child.kill();
    await closed;
    await f.dispose();
  }
});
