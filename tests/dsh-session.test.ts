import assert from "node:assert/strict";
import { after, test } from "node:test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolve } from "node:path";
import { probeFreshSession } from "./dsh-session-probe.ts";
const children = new Set<ChildProcessWithoutNullStreams>();
after(() => {
  for (const child of children)
    if (child.exitCode === null && !child.killed) child.kill();
});
async function run(mode: string, sinkFails = false) {
  const child = spawn(
    process.execPath,
    [resolve("tests/fixtures/dsh-session-fixture.mjs"), mode],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  children.add(child);
  const stderr: Buffer[] = [];
  const report = await probeFreshSession(child, resolve("."), {
    requestMs: mode.includes("timeout") ? 300 : 5000,
    // A held descendant pipe must not shorten the root's normal exit budget.
    // Only the root intentionally ignoring EOF needs accelerated termination.
    closeMs: mode === "ignore-eof" ? 300 : 5000,
    onStderr(bytes) {
      if (sinkFails) throw new Error("disk full");
      stderr.push(bytes);
    },
  });
  return { report, stderr: Buffer.concat(stderr).toString() };
}
test("fresh session probe sends exactly initialize/new/close and EOF with no MCP or prompt", async () => {
  const { report, stderr } = await run("ok");
  assert.equal(report.outcome, "PASS", JSON.stringify(report));
  assert.equal(report.fault, null);
  assert.deepEqual(report.requests, [
    "initialize",
    "session/new",
    "session/close",
  ]);
  assert.equal(report.session_state, "closed");
  assert.deepEqual(report.exit, {
    code: 0,
    signal: null,
    observed: true,
    forced: false,
  });
  assert.equal(report.stdin_eof, true);
  const wire = stderr
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(wire[1].params, { cwd: resolve("."), mcpServers: [] });
  assert.equal(
    wire[2].params.sessionId,
    "a65577b1-04d9-4e6e-83db-8fe306bcd401",
  );
  assert.match(report.session_id_sha256!, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(report), /private-secret|a65577b1/);
});
test("ordinary EOF cleanup allows bounded scheduling delay while timeout fixtures retain short deadlines", async () => {
  const { report } = await run("delayed-eof");
  assert.equal(report.outcome, "PASS", JSON.stringify(report));
  assert.equal(report.exit.forced, false);
  assert.equal(report.exit.code, 0);
  assert.equal(report.streams_closed, true);
});
for (const [mode, fault] of [
  ["auth", "DSH_AUTH_REQUIRED"],
  ["changed-hello", "DSH_HELLO_CHANGED"],
  ["duplicate-hello", "DSH_PROTOCOL"],
  ["wrong-id", "DSH_PROTOCOL"],
  ["missing-session", "DSH_PROTOCOL"],
  ["bad-session", "DSH_PROTOCOL"],
  ["malformed", "DSH_PROTOCOL"],
  ["invalid-utf8", "DSH_PROTOCOL"],
  ["permission", "DSH_SERVER_REQUEST"],
  ["notification", "DSH_SERVER_REQUEST"],
  ["new-error", "DSH_NEW_REJECTED"],
  ["close-error", "DSH_CLOSE_REJECTED"],
  ["error-and-result", "DSH_PROTOCOL"],
  ["bad-close", "DSH_PROTOCOL"],
  ["duplicate-new", "DSH_PROTOCOL"],
  ["duplicate-close", "DSH_PROTOCOL"],
  ["initialize-timeout", "DSH_INITIALIZE_TIMEOUT"],
  ["new-timeout", "DSH_NEW_TIMEOUT"],
  ["close-timeout", "DSH_CLOSE_TIMEOUT"],
  ["disconnect", "DSH_DISCONNECTED"],
  ["truncated", "DSH_PROTOCOL"],
  ["long-frame", "DSH_FRAME_LIMIT"],
  ["stderr-flood", "DSH_STDERR_LIMIT"],
  ["ignore-eof", "DSH_EOF_TIMEOUT"],
  ["exit-failure", "DSH_EXIT"],
] as const) {
  test(
    "fresh session rejects " + mode + " without retries or generic RPC",
    async () => {
      const { report } = await run(mode);
      assert.notEqual(report.outcome, "PASS");
      assert.equal(report.fault, fault);
      assert.ok(report.requests.filter((s) => s === "session/new").length <= 1);
      assert.ok(
        report.requests.every((s) =>
          ["initialize", "session/new", "session/close"].includes(s),
        ),
      );
      assert.equal(report.exit.observed, true, JSON.stringify(report));
      assert.equal(report.stdin_eof, true);
      assert.doesNotMatch(JSON.stringify(report), /private-secret/);
      if (mode === "permission" || mode === "missing-session")
        assert.equal(report.session_state, "unknown");
      if (mode === "close-error") assert.equal(report.session_state, "open");
      if (mode === "ignore-eof") assert.equal(report.exit.forced, true);
    },
  );
}
test("diagnostic write failure remains visible", async () => {
  const { report } = await run("ok", true);
  assert.equal(report.fault, "DSH_DIAGNOSTIC_WRITE");
  assert.notEqual(report.outcome, "PASS");
});
test("probe safely records spawn failure", async () => {
  const child = spawn(resolve("no-such-probe-executable"), [], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const report = await probeFreshSession(child, resolve("."), {
    requestMs: 1000,
    closeMs: 200,
  });
  assert.equal(report.fault, "DSH_LAUNCH");
  assert.equal(report.requests.length, 0);
  assert.notEqual(report.outcome, "PASS");
});

import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { prepareFreshDshProbe } from "./dsh-session-launch.ts";
async function installation() {
  const root = await mkdtemp(join(tmpdir(), "team-dsh-session-"));
  const install = join(root, "install"),
    data = join(root, "data");
  await mkdir(join(install, "resources"), { recursive: true });
  await mkdir(data);
  await writeFile(join(install, "DeepSeek Harness.exe"), "fixture exe");
  await writeFile(join(install, "resources", "app.asar"), "fixture archive");
  return {
    installation_root: install,
    data_root: data,
    client_version: "fixture",
    executable_sha256: createHash("sha256").update("fixture exe").digest("hex"),
    archive_sha256: createHash("sha256")
      .update("fixture archive")
      .digest("hex"),
  };
}
test("probe preparation uses new empty directories, fixed command and minimal environment", async () => {
  const config = await installation();
  const prepared = await prepareFreshDshProbe(config);
  assert.equal(
    prepared.executable,
    join(config.installation_root, "DeepSeek Harness.exe"),
  );
  assert.equal(prepared.args.at(-1), "acp");
  for (const field of [
    "DSH_HOME",
    "DSH_AGENTS_HOME",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "TEMP",
    "TMP",
  ]) {
    assert.ok(prepared.env[field]!.startsWith(config.data_root));
    assert.deepEqual(await readdir(prepared.env[field]!), []);
  }
  assert.deepEqual(await readdir(prepared.cwd), []);
  assert.equal(prepared.env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(prepared.env.DSH_TELEMETRY_DISABLED, "1");
  assert.deepEqual(
    Object.keys(prepared.env).sort(),
    [
      "SystemRoot",
      "WINDIR",
      "ComSpec",
      "PATH",
      "PATHEXT",
      "OS",
      "USERPROFILE",
      "HOME",
      "APPDATA",
      "LOCALAPPDATA",
      "TEMP",
      "TMP",
      "DSH_HOME",
      "DSH_AGENTS_HOME",
      "DSH_TELEMETRY_DISABLED",
      "DSH_PERMISSION_MODE",
      "ELECTRON_RUN_AS_NODE",
      "NO_COLOR",
    ].sort(),
  );
  assert.equal((await readFile(prepared.diagnostic)).length, 0);
  const second = await prepareFreshDshProbe(config);
  assert.notEqual(second.cwd, prepared.cwd);
});
test("changed installation pin rejects before creating any profile", async () => {
  const config = await installation();
  await assert.rejects(
    prepareFreshDshProbe({ ...config, archive_sha256: "a".repeat(64) }),
    /DSH_CONFIG_CHANGED/,
  );
  assert.deepEqual(await readdir(config.data_root), []);
});
test("linked data parent is rejected", async () => {
  const config = await installation();
  const linked = config.data_root + "-link";
  await symlink(config.data_root, linked, "junction");
  await assert.rejects(
    prepareFreshDshProbe({ ...config, data_root: linked }),
    /DSH_UNSAFE_PATH/,
  );
  assert.deepEqual(await readdir(config.data_root), []);
});
test("extra trusted configuration fields are rejected", async () => {
  const config = await installation();
  await assert.rejects(
    prepareFreshDshProbe({ ...config, prompt: "forbidden" }),
  );
  assert.deepEqual(await readdir(config.data_root), []);
});

import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawnSync } from "node:child_process";
test("unobserved owned-handle exit stays UNKNOWN after bounded cleanup", async () => {
  const fake = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: () => false,
  });
  const result = probeFreshSession(
    fake as unknown as ChildProcessWithoutNullStreams,
    resolve("."),
    { requestMs: 20, closeMs: 20 },
  );
  fake.emit("spawn");
  const report = await result;
  assert.equal(report.outcome, "UNKNOWN");
  assert.equal(report.exit.observed, false);
  assert.equal(report.exit.forced, true);
  assert.equal(report.fault, "DSH_INITIALIZE_TIMEOUT");
});
test("stdout total limit is visible without retaining raw protocol data", async () => {
  const fake = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: () => false,
  });
  const result = probeFreshSession(
    fake as unknown as ChildProcessWithoutNullStreams,
    resolve("."),
  );
  fake.emit("spawn");
  fake.stdout.write(Buffer.alloc(262145, 120));
  fake.emit("close", 0, null);
  assert.equal((await result).fault, "DSH_STDOUT_LIMIT");
});
test("live entry rejects missing authorization and existing attempt folder before launch", async () => {
  const root = await mkdtemp(join(tmpdir(), "team-dsh-entry-"));
  const args = [
    resolve("tests/dsh-session-live.mjs"),
    "--config",
    join(root, "missing.json"),
    "--output",
    root,
  ];
  const denied = spawnSync(process.execPath, args, {
    windowsHide: true,
    encoding: "utf8",
  });
  assert.notEqual(denied.status, 0);
  assert.match(denied.stderr, /Explicit fresh-session authorization required/);
  const repeat = spawnSync(
    process.execPath,
    [...args, "--allow-dsh-new-session"],
    { windowsHide: true, encoding: "utf8" },
  );
  assert.notEqual(repeat.status, 0);
  assert.match(repeat.stderr, /EEXIST/);
  assert.deepEqual(await readdir(root), []);
});

test("fresh session records actual root exit while a descendant holds output pipes", async () => {
  const { report } = await run("permission-held-pipe");
  assert.equal(report.fault, "DSH_SERVER_REQUEST");
  assert.equal(report.outcome, "FAILED");
  assert.equal(report.exit.observed, true);
  assert.equal(report.exit.forced, false);
  assert.equal(report.exit.code, 0);
  assert.equal(report.streams_closed, false);
});
