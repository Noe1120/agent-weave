import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { resolve } from "node:path";

test("no-model diagnosis counts thread/start but not the separate initialize handshake", async () => {
  const { CodexAppServer } =
    await import("../packages/service/src/codex-app-server.ts");
  const { noModelThread } = await import("./codex-joint-support.mjs");
  const child = spawn(
    process.execPath,
    [resolve("tests/fixtures/codex-app-server-fixture.mjs"), "success"],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  const handle = new CodexAppServer(child);
  try {
    await handle.ready;
    await handle.startThread(resolve("tests/fixtures"));
    assert.equal(noModelThread(handle.statistics, { tool_calls: 0 }), true);
    assert.equal(
      noModelThread({ ...handle.statistics, generation: 1 }, { tool_calls: 0 }),
      false,
    );
    assert.equal(noModelThread(handle.statistics, { tool_calls: 1 }), false);
  } finally {
    handle.close();
    await handle.closed;
  }
});

test(
  "retained Windows process handle observes a real child exit code, not a reused PID",
  { skip: process.platform !== "win32" },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "aw-exit-watch-"));
    const output = join(root, "exit.json");
    const child = spawn(
      process.execPath,
      [
        "-e",
        "process.stdin.resume();process.stdin.on('end',()=>process.exit(7));",
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    const childEnd = once(child, "close");
    const watcher = spawn(
      "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
      [
        "-NoProfile",
        "-File",
        resolve("tests/watch-owned-exit.ps1"),
        "-TargetId",
        String(child.pid),
        "-OutputFile",
        output,
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    const watcherEnd = once(watcher, "close");
    try {
      const deadline = Date.now() + 10000;
      while (!existsSync(output + ".ready")) {
        assert.ok(Date.now() < deadline);
        await new Promise((r) => setTimeout(r, 20));
      }
      child.stdin.end();
      assert.equal((await childEnd)[0], 7);
      assert.equal((await watcherEnd)[0], 0);
      const record = JSON.parse(readFileSync(output, "utf8"));
      assert.equal(record.exit_observed, true);
      assert.equal(record.exit_code, 7);
    } finally {
      if (child.exitCode === null) child.kill();
      if (watcher.exitCode === null) watcher.kill();
      await childEnd;
      await watcherEnd;
      rmSync(root, { recursive: true, force: true });
    }
  },
);

for (const shutdown of ["eof", "abrupt"])
  test(`MCP report records graceful EOF but never invents it after ${shutdown} termination`, async () => {
    const root = mkdtempSync(join(tmpdir(), "aw-joint-lifecycle-"));
    const config = join(root, "config.json"),
      report = join(root, "report.json");
    writeFileSync(
      config,
      JSON.stringify({
        version: 1,
        target: "codex",
        service_origin: "http://127.0.0.1:54321",
        project_id: "10000000-0000-4000-8000-000000000001",
        token: randomBytes(32).toString("base64url"),
        task_ids: ["10000000-0000-4000-8000-000000000002"],
        execution_ids: [],
        allow_message_poll: false,
        egress: {
          data_class: "synthetic_only",
          provider_fingerprint: "a".repeat(64),
          expires_at: new Date(Date.now() + 60000).toISOString(),
        },
      }),
    );
    const child = spawn(
      process.execPath,
      [
        resolve("packages/service/src/mcp-entry.ts"),
        "--config",
        config,
        "--report",
        report,
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    const ended = once(child, "close"),
      lines = createInterface({ input: child.stdout });
    const timer = setTimeout(() => child.kill(), 5000);
    let stderr = "";
    child.stderr.on("data", (bytes) => {
      stderr += bytes.toString();
    });
    try {
      const reply = once(lines, "line");
      child.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "fixture", version: "1" },
          },
        }) + "\n",
      );
      assert.ok(JSON.parse((await reply)[0]).result);
      child.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }) + "\n",
      );
      // A protocol barrier proves the prior initialized frame was saved. Polling
      // the live JSON opened it during Windows rename and could itself cause IO failure.
      const pong = once(lines, "line");
      child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }) + "\n",
      );
      assert.deepEqual(JSON.parse((await pong)[0]).result, {}, stderr);
      if (shutdown === "eof") child.stdin.end();
      else child.kill();
      await ended;
      const saved = JSON.parse(readFileSync(report, "utf8"));
      assert.equal(saved.initialized, true);
      assert.equal(saved.stdin_eof, shutdown === "eof");
      assert.equal(saved.tool_calls, 0);
    } finally {
      clearTimeout(timer);
      lines.close();
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await ended;
      rmSync(root, { recursive: true, force: true });
    }
  });

test("operator JSON accepts Windows UTF8 BOM but still rejects malformed input", async () => {
  const { operatorJson } = await import("./codex-joint-support.mjs");
  assert.deepEqual(operatorJson('\uFEFF{"client_version":"fixed"}'), {
    client_version: "fixed",
  });
  assert.throws(() => operatorJson('\uFEFF{"client_version":'));
});

test("joint relay denies bootstrap, wrong routes and authority, forwards only the pinned task with the live grant", async () => {
  const { taskRelay } = await import("./codex-joint-support.mjs");
  const token = randomBytes(32).toString("base64url");
  const calls = [];
  let revoked = false;
  const relay = await taskRelay({
    path: "/v1/projects/p/task/t",
    entryToken: token,
    read: (grant) => {
      calls.push(grant);
      return revoked
        ? { status: 404, body: { code: "NOT_FOUND_OR_DENIED" } }
        : {
            status: 200,
            body: { ref: { id: "t" }, data: { status: "draft" } },
          };
    },
  });
  const get = (path = "/v1/projects/p/task/t", headers = {}, method = "GET") =>
    fetch(relay.origin + path, {
      method,
      headers: { authorization: "Bearer " + token, ...headers },
    });
  try {
    assert.equal((await get()).status, 404);
    relay.activate("least-privilege-token");
    for (const [path, headers, method] of [
      ["/v1/projects/p/task/other", {}, "GET"],
      ["/v1/projects/p/task/t?q=1", {}, "GET"],
      ["/v1/projects/p/task/t", { authorization: "Bearer wrong" }, "GET"],
      ["/v1/projects/p/task/t", { origin: "https://evil.test" }, "GET"],
      ["/v1/projects/p/task/t", { cookie: "owner=anything" }, "GET"],
      ["/v1/projects/p/task/t", {}, "POST"],
    ])
      assert.equal((await get(path, headers, method)).status, 404);
    assert.equal(calls.length, 0);
    assert.deepEqual(await (await get()).json(), {
      ref: { id: "t" },
      data: { status: "draft" },
    });
    assert.deepEqual(calls, ["least-privilege-token"]);
    assert.equal(relay.reads, 1);
    assert.throws(() => relay.activate("replacement"));
    revoked = true;
    assert.equal((await get()).status, 404);
    assert.equal(relay.reads, 1);
  } finally {
    await relay.close();
  }
});

test("credential cleanup deletes only named files under its owned root, detects residual copies, rejects escape and links", async () => {
  const { cleanCredentials } = await import("./codex-joint-support.mjs");
  const root = mkdtempSync(join(tmpdir(), "aw-joint-clean-"));
  const secret = "synthetic-secret-unique-123456789";
  try {
    mkdirSync(join(root, "home"));
    writeFileSync(join(root, "home/config.toml"), secret);
    writeFileSync(join(root, "residue.txt"), secret);
    assert.throws(
      () => cleanCredentials(root, [join(root, "../outside")], [secret]),
      /OUTSIDE/,
    );
    const first = cleanCredentials(
      root,
      [join(root, "home/config.toml")],
      [secret],
    );
    assert.equal(first.deleted, 1);
    assert.equal(first.residual_files, 1);
    assert.equal(readFileSync(join(root, "residue.txt"), "utf8"), secret);
    const second = cleanCredentials(
      root,
      [join(root, "residue.txt")],
      [secret],
    );
    assert.equal(second.residual_files, 0);
    // Directory junctions are available without developer-mode symlink privilege.
    symlinkSync(
      tmpdir(),
      join(root, "link"),
      process.platform === "win32" ? "junction" : "dir",
    );
    assert.throws(() => cleanCredentials(root, [], [secret]), /LINK/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("joint verdict cannot pass from an empty, partial or mixed failing checklist", async () => {
  const { jointVerdict } = await import("./codex-joint-support.mjs");
  assert.equal(jointVerdict([]), "FAILED");
  assert.equal(jointVerdict([{ name: "tool", passed: true }]), "FAILED");
  const checks = [
    "native",
    "turn",
    "task",
    "bridge",
    "read_only",
    "revoke",
    "exit",
    "preserved",
    "cleanup",
  ].map((name) => ({ name, passed: true }));
  assert.equal(jointVerdict(checks), "PASSED_FIXED_CONFIG");
  assert.equal(
    jointVerdict([...checks, { name: "unexpected", passed: false }]),
    "FAILED",
  );
});
