// Explicit single-attempt acceptance only; never loaded by the product service.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { resolve, join } from "node:path";
import {
  officialCodexLauncher,
  CodexAppServer,
} from "../dist/packages/service/src/codex-app-server.js";
import { createOwnedBridgeFactory } from "../dist/packages/service/src/owned-bridge.js";
import {
  readFrames,
  writeFrame,
} from "../dist/packages/service/src/bridge-relay-io.js";
import { listenLoopback } from "../dist/packages/service/src/loopback-listener.js";
import {
  operatorJson,
  cleanCredentials,
  noModelThread,
} from "./codex-joint-support.mjs";

const synthetic = process.argv[2] === "--synthetic";
if (
  !(synthetic
    ? process.argv.length === 4
    : process.argv.length === 3 &&
      process.argv[2] === "--allow-one-no-model-relay")
) {
  console.error("RELAY_ACCEPTANCE_OPT_IN_REQUIRED");
  process.exit(1);
}
const root = synthetic
  ? resolve(process.argv[3])
  : resolve(".runtime/w24-live/owned-once");
assert.ok(!existsSync(root), "ATTEMPT_ALREADY_EXISTS");
mkdirSync(root); // Exclusive, never recursively reuse a previous attempt.
const ps = "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";
const query = (script) =>
  JSON.parse(
    execFileSync(ps, ["-NoProfile", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
    }).trim() || "[]",
  );
const inventory = () =>
  query(
    "@(Get-CimInstance Win32_Process -Filter \"Name = 'ChatGPT.exe' OR Name = 'codex.exe'\" | Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath | Sort-Object ProcessId) | ConvertTo-Json -Compress",
  );
const digest = (value) => createHash("sha256").update(value).digest("hex");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 30000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("ACCEPTANCE_TIMEOUT");
    await pause(50);
  }
}
const report = {
  kind: synthetic ? "SYNTHETIC_REHEARSAL" : "ORIGINAL_CODEX_NO_MODEL_RELAY",
  started_at: new Date().toISOString(),
  checks: [],
  facts: {},
};
const check = (name, passed) =>
  report.checks.push({ name, passed: passed === true });
const data = join(root, "data"),
  bridgeData = join(root, "bridge");
mkdirSync(data);
mkdirSync(bridgeData);
let handle,
  prepared,
  server,
  relayChild,
  relayEnded,
  before,
  relayToken,
  modelRequests = 0;
const watchers = [],
  bridgeToken = randomBytes(32).toString("base64url");
async function watch(pid, name) {
  const path = join(root, name + "-exit.json");
  const child = spawn(
    ps,
    [
      "-NoProfile",
      "-File",
      resolve("tests/watch-owned-exit.ps1"),
      "-TargetId",
      String(pid),
      "-OutputFile",
      path,
    ],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  const ended = once(child, "close");
  child.stdout.resume();
  child.stderr.resume();
  const item = { child, ended, path };
  watchers.push(item);
  await until(() => {
    if (child.exitCode !== null) throw new Error("WATCHER_EARLY_EXIT");
    return existsSync(path + ".ready");
  });
  return item;
}
async function exitRecord(w) {
  await until(() => existsSync(w.path), 5000);
  assert.equal((await w.ended)[0], 0);
  return JSON.parse(readFileSync(w.path, "utf8"));
}
function bridgeReport() {
  const dirs = readdirSync(bridgeData);
  if (dirs.length !== 1) return null;
  const path = join(bridgeData, dirs[0], "report.json");
  if (!existsSync(path)) return null;
  // Share-delete prevents the observer from breaking the bridge atomic rename.
  return query(
    `$s=[IO.File]::Open('${path.replaceAll("'", "''")}',[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)); $r=New-Object IO.StreamReader($s); try { $r.ReadToEnd() } finally { $r.Dispose() }`,
  );
}
try {
  before = inventory();
  server = createServer((_req, res) => {
    modelRequests++;
    res.writeHead(503);
    res.end();
  });
  await listenLoopback(server);
  const origin = `http://127.0.0.1:${server.address().port}`;
  // This no-tool/no-turn probe deliberately has no readable business service.
  const config = {
    version: 1,
    target: "codex",
    service_origin: origin,
    project_id: randomUUID(),
    token: bridgeToken,
    task_ids: [randomUUID()],
    execution_ids: [],
    allow_message_poll: false,
    egress: {
      data_class: "synthetic_only",
      provider_fingerprint: "a".repeat(64),
      expires_at: new Date(Date.now() + 180000).toISOString(),
    },
  };
  const operator = synthetic
    ? null
    : operatorJson(
        readFileSync(resolve(".runtime/codex-launch-config.json"), "utf8"),
      );
  // Verify the already-approved installation metadata, never load provider/home/history.
  if (operator)
    assert.equal(
      digest(readFileSync(join(operator.installation_root, "codex.exe"))),
      operator.executable_sha256,
    );
  prepared = await createOwnedBridgeFactory({
    dataRoot: bridgeData,
    config,
  }).prepareClient(() => true);
  const binding = JSON.parse(prepared.launch.env.TEAM_RELAY);
  relayToken = binding.token;
  let hostPid, relayPid;
  if (synthetic) {
    const child = spawn(
      process.execPath,
      [resolve("tests/fixtures/codex-app-server-fixture.mjs"), "success"],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    handle = new CodexAppServer(child, { workDirectory: data });
    hostPid = child.pid;
    await handle.ready;
    await handle.startThread(data);
    relayChild = spawn(prepared.launch.command, prepared.launch.args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { SystemRoot: process.env.SystemRoot, ...prepared.launch.env },
    });
    relayEnded = once(relayChild, "close");
    relayChild.stderr.resume();
    relayPid = relayChild.pid;
    const frames = readFrames(relayChild.stdout, 131072, 1048576);
    await writeFrame(
      relayChild.stdin,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "w24-rehearsal", version: "1" },
        },
      },
      3000,
    );
    assert.ok((await frames.next()).value.result);
    await writeFrame(
      relayChild.stdin,
      { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
      3000,
    );
    await writeFrame(
      relayChild.stdin,
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      3000,
    );
    assert.ok((await frames.next()).value.result.tools);
  } else {
    const launcher = officialCodexLauncher({
      installation_root: operator.installation_root,
      client_version: operator.client_version,
      executable_sha256: operator.executable_sha256,
      data_root: data,
      model_provider: {
        base_url: origin,
        model: "agent-weave-no-model-diagnostic",
      },
      relay_binding: binding,
    });
    report.facts.client_version = operator.client_version;
    report.facts.executable_sha256 = operator.executable_sha256;
    report.facts.launcher_fingerprint = launcher.fingerprint;
    handle = await launcher.launch(() => true);
    // Diagnostic-only held ChildProcess, not a production/public PID attachment API.
    hostPid = handle.child.pid;
    assert.ok(!before.some((p) => p.ProcessId === hostPid));
    await handle.ready;
    await handle.startThread(handle.workDirectory);
    await prepared.ready;
    const entry = prepared.launch.args[0].replaceAll("'", "''");
    const candidates = [].concat(
      query(
        `@(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.ParentProcessId -eq ${hostPid} -and $_.CommandLine.Contains('${entry}') } | Select-Object ProcessId,ParentProcessId,CreationDate) | ConvertTo-Json -Compress`,
      ),
    );
    assert.equal(candidates.length, 1, "UNIQUE_OWNED_RELAY_REQUIRED");
    assert.ok(
      Number(candidates[0].CreationDate.match(/\d+/)?.[0]) >=
        Date.parse(report.started_at),
    );
    relayPid = candidates[0].ProcessId;
  }
  await prepared.ready;
  await until(() => {
    const r = bridgeReport();
    return r?.initialized && r.tools_list_requests === 1;
  });
  const hostWatch = await watch(hostPid, "host"),
    relayWatch = await watch(relayPid, "relay");
  report.facts.preclose_bridge = bridgeReport();
  check(
    "mcp_discovery",
    report.facts.preclose_bridge.initialized &&
      report.facts.preclose_bridge.tools_list_requests === 1,
  );
  await prepared.stop(
    async () => {
      report.facts.relay_os_exit = await exitRecord(relayWatch);
      return {
        code: report.facts.relay_os_exit.exit_code,
        exit_observed: report.facts.relay_os_exit.exit_observed,
        forced: false,
      };
    },
    async () => {
      report.facts.host_close_requested_at = new Date().toISOString();
      handle.close();
      return await handle.closed;
    },
  );
  report.facts.host_os_exit = await exitRecord(hostWatch);
  report.facts.final_bridge = bridgeReport();
  report.facts.bridge_snapshot = prepared.snapshot();
  report.facts.protocol_statistics = structuredClone(handle.statistics);
  check(
    "no_turn_or_tool",
    noModelThread(handle.statistics, report.facts.final_bridge),
  );
  check(
    "ordered_normal_exit",
    prepared.snapshot().state === "closed" &&
      report.facts.host_os_exit.exit_code === 0 &&
      Date.parse(report.facts.relay_os_exit.observed_at) <=
        Date.parse(report.facts.host_close_requested_at),
  );
  // New descendants are not accepted as a successful automatic reconnect.
  const remaining = [].concat(
    query(
      `@(Get-CimInstance Win32_Process -Filter "ParentProcessId = ${hostPid}" | Select-Object ProcessId) | ConvertTo-Json -Compress`,
    ),
  );
  check("no_remaining_host_children", remaining.length === 0);
} catch (error) {
  report.error = {
    name: error.name,
    message_sha256: digest(String(error.message)),
    code: /^[A-Z_]+$/.test(error.message) ? error.message : "ACCEPTANCE_FAILED",
  };
  check("execution", false);
} finally {
  try {
    if (prepared) await prepared.abort();
  } catch {
    check("bridge_cleanup", false);
  }
  if (prepared) report.facts.bridge_snapshot = prepared.snapshot();
  try {
    report.facts.final_bridge = bridgeReport();
  } catch {
    check("final_bridge_report", false);
  }
  if (handle) {
    handle.close();
    const exit = await handle.closed;
    report.facts.host_exit = {
      code: exit.code,
      exit_observed: exit.exit_observed,
      forced: exit.forced,
      fault: exit.fault,
    };
    check("host_exit", exit.code === 0 && exit.exit_observed && !exit.forced);
  }
  if (relayChild) {
    if (relayChild.exitCode === null && relayChild.signalCode === null)
      relayChild.kill();
    await relayEnded;
  }
  for (const w of watchers) {
    if (w.child.exitCode === null) {
      await Promise.race([w.ended, pause(1000)]);
      if (w.child.exitCode === null) w.child.kill();
    }
    await w.ended;
  }
  if (server) {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  report.facts.provider_sink_requests = modelRequests;
  check("no_model_request", modelRequests === 0);
  try {
    assert.ok(!handle || report.facts.host_exit.exit_observed);
    const files = readdirSync(data)
      .map((n) => join(data, n, "home", "config.toml"))
      .filter(existsSync);
    report.facts.cleanup = cleanCredentials(root, files, [
      bridgeToken,
      relayToken,
    ]);
    check("cleanup", report.facts.cleanup.residual_files === 0);
    check(
      "original_processes_unchanged",
      JSON.stringify(before) === JSON.stringify(inventory()),
    );
  } catch {
    check("cleanup_or_preservation", false);
  }
  report.finished_at = new Date().toISOString();
  report.status =
    report.checks.length >= 7 && report.checks.every((c) => c.passed)
      ? synthetic
        ? "PASSED_SYNTHETIC_ONLY"
        : "PASSED_FIXED_NO_MODEL_LIFECYCLE"
      : "FAILED";
  writeFileSync(
    join(root, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx" },
  );
  console.log(JSON.stringify(report, null, 2));
  if (report.status === "FAILED") process.exitCode = 1;
}
