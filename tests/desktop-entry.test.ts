import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { tempWorkspace } from "./temp.ts";

const entry = "packages/service/src/desktop-entry.ts";
function launch(db: string) {
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, CORE_DB: db },
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (data) => (output += data));
  child.stderr.resume();
  return { child, output: () => output };
}
async function ready(run: ReturnType<typeof launch>) {
  for (let i = 0; i < 150; i++) {
    if (run.child.exitCode !== null)
      throw new Error("Desktop entry exited before ready");
    if (run.output().includes("\n")) return JSON.parse(run.output().trim());
    await delay(40);
  }
  throw new Error("Desktop handshake timeout");
}

test("desktop does not open database before its private ownership handshake", async () => {
  assert.ok(existsSync(entry), "native service entry must exist");
  const temp = tempWorkspace();
  const run = launch(temp.db);
  try {
    await delay(300);
    assert.equal(existsSync(temp.db), false);
    assert.equal(run.output(), "");
    const exit = once(run.child, "exit");
    run.child.stdin.end();
    await exit;
    assert.equal(run.child.exitCode, 0);
    assert.equal(existsSync(temp.db), false);
  } finally {
    if (run.child.exitCode === null) {
      const exit = once(run.child, "exit");
      run.child.kill();
      await exit;
    }
    temp.dispose();
  }
});
for (const shutdown of ["stop", "eof"]) {
  test(
    "desktop pairs privately and closes its loopback port on " + shutdown,
    async () => {
      assert.ok(existsSync(entry), "native service entry must exist");
      const temp = tempWorkspace();
      const run = launch(temp.db);
      try {
        run.child.stdin.write("start\n");
        const hello = await ready(run);
        assert.equal(hello.host, "127.0.0.1");
        assert.equal(hello.native_dispatch, false);
        assert.match(hello.code, /^[A-Za-z0-9_-]{43}$/);
        assert.equal(run.output().trim().split("\n").length, 1);
        const origin = "http://127.0.0.1:" + hello.port;
        const pair = await fetch(origin + "/v1/console/pair", {
          method: "POST",
          headers: { Origin: origin, "Content-Type": "application/json" },
          body: JSON.stringify({ code: hello.code }),
        });
        assert.equal(pair.status, 200);
        const exit = once(run.child, "exit");
        if (shutdown === "stop") run.child.stdin.write("stop\n");
        else run.child.stdin.end();
        await exit;
        assert.equal(run.child.exitCode, 0);
        await assert.rejects(
          fetch(origin + "/v1/console/session", {
            signal: AbortSignal.timeout(1000),
          }),
        );
      } finally {
        if (run.child.exitCode === null) {
          const exit = once(run.child, "exit");
          run.child.kill();
          await exit;
        }
        temp.dispose();
      }
    },
  );
}

test("desktop startup exposes safe root-cause metadata for a damaged database", async () => {
  const { writeFileSync, readFileSync } = await import("node:fs");
  const temp = tempWorkspace();
  writeFileSync(temp.db, "synthetic damaged database");
  const run = launch(temp.db);
  let errors = "";
  run.child.stderr.on("data", (chunk) => (errors += chunk));
  try {
    const exit = once(run.child, "exit");
    run.child.stdin.write("start\n");
    await exit;
    assert.equal(run.child.exitCode, 1);
    const line = errors.split(/\r?\n/).find((s) => s.startsWith("{"));
    assert.ok(line, "startup must report structured root-cause metadata");
    const fault = JSON.parse(line);
    assert.equal(fault.event, "desktop_start_failed");
    assert.equal(fault.error_code, "ERR_SQLITE_ERROR");
    assert.ok(fault.error_type);
    assert.equal(run.output(), "");
    assert.equal(readFileSync(temp.db, "utf8"), "synthetic damaged database");
  } finally {
    if (run.child.exitCode === null) {
      const exit = once(run.child, "exit");
      run.child.kill();
      await exit;
    }
    temp.dispose();
  }
});
