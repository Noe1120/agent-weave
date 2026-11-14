import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import { tempWorkspace } from "./temp.ts";
const tmp = tempWorkspace();
let child;
try {
  child = spawn(process.execPath, ["dist/packages/service/src/main.js"], {
    env: { ...process.env, PORT: "0", CORE_DB: tmp.db },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (c) => (stdout += c));
  child.stderr.on("data", (c) => (stderr += c));
  let start;
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null)
      throw new Error("Compiled process exited before listening: " + stderr);
    const line = stdout.split(/\r?\n/).find((l) => l.startsWith("{"));
    if (line) {
      start = JSON.parse(line);
      break;
    }
    await sleep(50);
  }
  assert.ok(start, "compiled server did not start");
  assert.equal(start.host, "127.0.0.1");
  assert.equal(start.native_dispatch, false);
  const response = await fetch(
    "http://127.0.0.1:" + start.port + "/v1/core/read_wait",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(3000),
    },
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    kind: "transport_error",
    code: "UNAUTHENTICATED",
  });
  const exit = once(child, "exit");
  child.kill("SIGTERM");
  await exit;
  child = undefined;
  await assert.rejects(
    fetch("http://127.0.0.1:" + start.port + "/v1/core/read_wait", {
      signal: AbortSignal.timeout(1000),
    }),
  );
  const db = new DatabaseSync(tmp.db);
  try {
    assert.equal(
      db.prepare("SELECT count(*) n FROM schema_migrations").get().n,
      4,
    );
    assert.equal(db.prepare("SELECT count(*) n FROM actions").get().n, 0);
  } finally {
    db.close();
  }
  console.log(
    JSON.stringify(
      {
        compiled_process: "PASS",
        loopback_request: "PASS",
        migration: "PASS",
        native_clients_started: 0,
        model_calls: 0,
        port_closed: true,
        qualification: "LOCAL_SYNTHETIC_SMOKE",
      },
      null,
      2,
    ),
  );
} catch (e) {
  throw e;
} finally {
  if (child && child.exitCode === null) {
    const exit = once(child, "exit");
    child.kill();
    await exit;
  }
  tmp.dispose();
}
