import assert from "node:assert/strict";
import { after, test } from "node:test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
const children = new Set<ChildProcessWithoutNullStreams>();
after(() => {
  for (const child of children)
    if (child.exitCode === null && !child.killed) child.kill();
});
async function server(timeout = 5000) {
  const dir = await mkdtemp(join(tmpdir(), "team-claude-mcp-"));
  const reportPath = join(dir, "report.json");
  const child = spawn(
    process.execPath,
    [resolve("tests/claude-mcp-server.mjs"), reportPath, String(timeout)],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  children.add(child);
  const frames: Record<string, any>[] = [],
    stderr: Buffer[] = [];
  createInterface({ input: child.stdout }).on("line", (line) =>
    frames.push(JSON.parse(line)),
  );
  child.stderr.on("data", (bytes) => stderr.push(bytes));
  const closed = new Promise<number | null>((r) => child.once("close", r));
  const send = (frame: unknown) =>
    child.stdin.write(JSON.stringify(frame) + "\n");
  const initialize = (version = "2025-06-18") =>
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: version,
        capabilities: {},
        clientInfo: { name: "claude-ai", version: "0.1.0" },
      },
    });
  const finish = async () => {
    child.stdin.end();
    const code = await closed;
    return {
      code,
      frames,
      report: JSON.parse(await readFile(reportPath, "utf8")),
      stderr: Buffer.concat(stderr).toString(),
    };
  };
  return { child, frames, send, initialize, finish, closed, reportPath };
}
test("Desktop client initializes the empty MCP server, discovers empty capabilities, then EOF", async () => {
  const s = await server();
  s.initialize();
  s.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  for (const [i, method] of [
    "tools/list",
    "resources/list",
    "prompts/list",
    "ping",
  ].entries())
    s.send({ jsonrpc: "2.0", id: i + 2, method });
  const { code, frames, report } = await s.finish();
  assert.equal(code, 0);
  assert.equal(report.fault, null);
  assert.equal(report.initialized, true);
  assert.equal(report.stdin_eof, true);
  assert.equal(frames[0]!.result.protocolVersion, "2025-06-18");
  assert.deepEqual(
    frames.slice(1).map((f) => f.result),
    [{ tools: [] }, { resources: [] }, { prompts: [] }, {}],
  );
  assert.equal(report.tools_list_requests, 1);
  assert.equal(report.outbound_requests, 0);
  assert.ok(frames.every((f) => !("method" in f)));
});
for (const version of ["2024-11-05", "2025-03-26", "2025-06-18", "2099-01-01"])
  test("MCP negotiation uses supported version for " + version, async () => {
    const s = await server();
    s.initialize(version);
    s.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    const { frames } = await s.finish();
    assert.equal(
      frames[0]!.result.protocolVersion,
      version === "2099-01-01" ? "2025-06-18" : version,
    );
  });
for (const method of [
  "tools/call",
  "resources/read",
  "prompts/get",
  "sampling/createMessage",
  "session/new",
])
  test("MCP denies unsupported method " + method, async () => {
    const s = await server();
    s.initialize();
    s.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    s.send({
      jsonrpc: "2.0",
      id: 2,
      method,
      params: { private: "private-secret" },
    });
    const { code, frames, report } = await s.finish();
    assert.equal(code, 1);
    assert.equal(frames.at(-1)!.error.code, -32601);
    assert.equal(report.fault, "MCP_METHOD_DENIED");
    assert.doesNotMatch(JSON.stringify(report), /private-secret/);
  });
for (const [name, frames] of [
  ["list-before-init", [{ jsonrpc: "2.0", id: 1, method: "tools/list" }]],
  [
    "initialized-before-init",
    [{ jsonrpc: "2.0", method: "notifications/initialized" }],
  ],
  [
    "duplicate-id",
    [
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", id: 1, method: "ping" },
    ],
  ],
  ["unsolicited-response", [{ jsonrpc: "2.0", id: 1, result: {} }]],
  [
    "bad-version",
    [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: 1,
          capabilities: {},
          clientInfo: { name: "x", version: "1" },
        },
      },
    ],
  ],
  ["unknown-notification", [{ jsonrpc: "2.0", method: "private-secret" }]],
] as const)
  test("MCP rejects " + name, async () => {
    const s = await server();
    for (const f of frames) s.send(f);
    const { code, report } = await s.finish();
    assert.equal(code, 1);
    assert.ok(report.fault);
    assert.doesNotMatch(JSON.stringify(report), /private-secret/);
  });
for (const [name, data, fault] of [
  ["invalid-json", Buffer.from("invalid\n"), "MCP_PROTOCOL"],
  ["bad-utf8", Buffer.from([255, 10]), "MCP_PROTOCOL"],
  ["oversized-frame", Buffer.alloc(65537, 120), "MCP_FRAME_LIMIT"],
  ["truncated", Buffer.from('{"jsonrpc":'), "MCP_PROTOCOL"],
] as const)
  test("MCP rejects " + name, async () => {
    const s = await server();
    s.child.stdin.write(data);
    const { code, report } = await s.finish();
    assert.equal(code, 1);
    assert.equal(report.fault, fault);
  });
test("MCP idle deadline fails visibly with no retries", async () => {
  const s = await server(100);
  const code = await s.closed;
  const report = JSON.parse(await readFile(s.reportPath, "utf8"));
  assert.equal(code, 1);
  assert.equal(report.fault, "MCP_TIMEOUT");
  assert.equal(report.initialize_requests, 0);
});

import { mkdir, writeFile, readdir, symlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { prepareClaudeProbe } from "./claude-desktop-launch.ts";
async function installation() {
  const root = await mkdtemp(join(tmpdir(), "team-claude-install-")),
    install = join(root, "app"),
    data = join(root, "data");
  await mkdir(join(install, "resources"), { recursive: true });
  await mkdir(data);
  await writeFile(join(install, "claude.exe"), "fixture-exe");
  await writeFile(join(install, "resources", "app.asar"), "fixture-asar");
  return {
    installation_root: install,
    data_root: data,
    client_version: "fixture",
    executable_sha256: createHash("sha256").update("fixture-exe").digest("hex"),
    archive_sha256: createHash("sha256").update("fixture-asar").digest("hex"),
    node: process.execPath,
    server: resolve("tests/claude-mcp-server.mjs"),
  };
}
test("Claude preparation uses new chosen profile and an empty MCP server only", async () => {
  const config = await installation();
  const p = await prepareClaudeProbe(config);
  const prefs = JSON.parse(
    await readFile(join(p.profile, "claude_desktop_config.json"), "utf8"),
  );
  assert.deepEqual(Object.keys(prefs), ["mcpServers"]);
  assert.deepEqual(Object.keys(prefs.mcpServers), ["agent-weave-probe"]);
  assert.equal(prefs.mcpServers["agent-weave-probe"].command, process.execPath);
  assert.equal(p.args.length, 1);
  assert.equal(p.args[0], "--user-data-dir=" + p.profile);
  assert.equal(p.env.CLAUDE_USER_DATA_DIR, undefined);
  assert.equal(p.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(p.env.ANTHROPIC_API_KEY, undefined);
  assert.ok(!Object.keys(p.env).some((k) => /TOKEN|KEY|PROXY|DEBUG/.test(k)));
  for (const k of [
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "TEMP",
    "TMP",
  ])
    assert.ok(p.env[k]!.startsWith(config.data_root));
  assert.deepEqual(await readdir(p.cwd), []);
  const second = await prepareClaudeProbe(config);
  assert.notEqual(p.profile, second.profile);
});
test("Claude preparation rejects changed pins before profile creation", async () => {
  const config = await installation();
  await assert.rejects(
    prepareClaudeProbe({ ...config, archive_sha256: "a".repeat(64) }),
    /CLAUDE_CONFIG_CHANGED/,
  );
  assert.deepEqual(await readdir(config.data_root), []);
});
test("Claude preparation refuses linked data directory and extra credential config", async () => {
  const config = await installation();
  const link = config.data_root + "-link";
  await symlink(config.data_root, link, "junction");
  await assert.rejects(
    prepareClaudeProbe({ ...config, data_root: link }),
    /CLAUDE_UNSAFE_PATH/,
  );
  await assert.rejects(
    prepareClaudeProbe({ ...config, apiKey: "forbidden" }),
    /CLAUDE_CONFIG/,
  );
  assert.deepEqual(await readdir(config.data_root), []);
});

import { createInterface as lines } from "node:readline";
async function hostedWorker(input: unknown) {
  const host = spawn(
    resolve(".tools/dotnet/dotnet.exe"),
    [resolve("artifacts/runner-host/Team.RunnerHost.dll")],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  children.add(host);
  const messages: any[] = [];
  let stderr = "";
  host.stderr.on("data", (b) => (stderr += b.toString()));
  const closed = new Promise<number | null>((r) => host.once("close", r));
  const stopTimer = setTimeout(
    () => host.stdin.write(JSON.stringify({ kind: "stop" }) + "\n"),
    5000,
  );
  lines({ input: host.stdout }).on("line", (line) => {
    const outer = JSON.parse(line);
    const m = outer.kind === "worker" ? JSON.parse(outer.line) : outer;
    messages.push(m);
    if (m.kind === "desktop_output")
      host.stdin.write(JSON.stringify({ kind: "stop" }) + "\n");
  });
  host.stdin.write(
    JSON.stringify({
      node: process.execPath,
      worker: resolve("tests/fixtures/claude-desktop-worker.mjs"),
      cwd: resolve("."),
      input,
    }) + "\n",
  );
  const code = await closed;
  clearTimeout(stopTimer);
  return { code, messages, stderr };
}
test("owned Job contains synthetic Desktop child and descendants before cleanup", async () => {
  const result = await hostedWorker({
    executable: process.execPath,
    args: [
      "-e",
      "require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}).once('spawn',()=>process.stdout.write('ready'));setInterval(()=>{},1000)",
    ],
    cwd: resolve("."),
    env: {
      SystemRoot: process.env.SystemRoot!,
      PATH: process.env.SystemRoot! + "\\System32",
    },
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.messages[0].job_assigned, true);
  assert.ok(result.messages.some((m) => m.kind === "desktop_started"));
  assert.ok(result.messages.some((m) => m.kind === "desktop_output"));
  assert.ok(result.messages.some((m) => m.kind === "exited" && m.job_empty));
});
test("Desktop worker never launches before owned-host bootstrap", async () => {
  const worker = spawn(
    process.execPath,
    [resolve("tests/fixtures/claude-desktop-worker.mjs")],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  children.add(worker);
  let out = "";
  worker.stdout.on("data", (b) => (out += b.toString()));
  const ended = new Promise<number | null>((r) => worker.once("close", r));
  worker.stdin.end();
  assert.equal(await ended, 1);
  assert.doesNotMatch(out, /desktop_started/);
});

import { spawnSync } from "node:child_process";
test("real Desktop entry refuses absent authorization and a reused attempt directory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "team-claude-guard-"));
  const args = [
    resolve("tests/claude-desktop-live.mjs"),
    "--config",
    join(dir, "missing.json"),
    "--output",
    dir,
  ];
  const absent = spawnSync(process.execPath, args, {
    windowsHide: true,
    encoding: "utf8",
  });
  assert.notEqual(absent.status, 0);
  assert.match(
    absent.stderr,
    /Explicit fresh-profile Desktop probe authorization required/,
  );
  const repeated = spawnSync(
    process.execPath,
    [...args, "--allow-claude-desktop-probe"],
    { windowsHide: true, encoding: "utf8" },
  );
  assert.notEqual(repeated.status, 0);
  assert.match(repeated.stderr, /EEXIST/);
  assert.deepEqual(await readdir(dir), []);
});

import { summarizeClaudeAttempt } from "./claude-desktop-result.ts";
const completeMcp = {
  initialize_requests: 1,
  initialized: true,
  tools_list_requests: 1,
  fault: null,
};
test("Job-empty never promotes a surviving original client to successful cleanup", () => {
  const r = summarizeClaudeAttempt({
    mcp: completeMcp,
    jobEmpty: true,
    existingClientsUnchanged: false,
    hostExitObserved: true,
    hostExitCode: 0,
    hostFault: null,
  });
  assert.equal(r.status, "REAL_CLAUDE_CLEANUP_UNCONFIRMED");
  assert.equal(r.transport_handshake, true);
  assert.equal(r.cleanup_confirmed, false);
});
test("missing MCP handshake is a real failed prerequisite even if cleanup succeeds", () => {
  const r = summarizeClaudeAttempt({
    mcp: null,
    jobEmpty: true,
    existingClientsUnchanged: true,
    hostExitObserved: true,
    hostExitCode: 0,
    hostFault: null,
  });
  assert.equal(r.status, "REAL_CLAUDE_MCP_NOT_PASSED");
  assert.equal(r.transport_handshake, false);
});
test("only actual handshake plus observed clean containment can pass feasibility", () => {
  const r = summarizeClaudeAttempt({
    mcp: completeMcp,
    jobEmpty: true,
    existingClientsUnchanged: true,
    hostExitObserved: true,
    hostExitCode: 0,
    hostFault: null,
  });
  assert.equal(r.status, "REAL_CLAUDE_MCP_HANDSHAKE_PASS");
  assert.equal(r.cleanup_confirmed, true);
});
test("unobserved host or explicit fault cannot become a successful attempt", () => {
  for (const extra of [
    { hostExitObserved: false },
    { hostExitCode: 1 },
    { hostFault: "HOST_STDOUT" },
    { jobEmpty: false },
  ]) {
    const r = summarizeClaudeAttempt({
      mcp: completeMcp,
      jobEmpty: true,
      existingClientsUnchanged: true,
      hostExitObserved: true,
      hostExitCode: 0,
      hostFault: null,
      ...extra,
    });
    assert.notEqual(r.status, "REAL_CLAUDE_MCP_HANDSHAKE_PASS");
  }
});

test("known unqualified packaged lifetime prevents a fresh real retry before config read", async () => {
  const dir = await mkdtemp(join(tmpdir(), "team-claude-stop-"));
  const output = join(dir, "attempt");
  const r = spawnSync(
    process.execPath,
    [
      resolve("tests/claude-desktop-live.mjs"),
      "--allow-claude-desktop-probe",
      "--config",
      join(dir, "missing.json"),
      "--output",
      output,
    ],
    { windowsHide: true, encoding: "utf8" },
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /CLAUDE_PACKAGED_LIFETIME_UNQUALIFIED/);
  assert.deepEqual(await readdir(output), []);
});
