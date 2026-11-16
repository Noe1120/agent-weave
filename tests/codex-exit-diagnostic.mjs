// Opt-in, one original client/thread, never a turn or an operator credential.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { officialCodexLauncher } from "../dist/packages/service/src/codex-app-server.js";
import { listenLoopback } from "../dist/packages/service/src/loopback-listener.js";
import {
  operatorJson,
  cleanCredentials,
  noModelThread,
} from "./codex-joint-support.mjs";

assert.deepEqual(process.argv.slice(2), ["--allow-one-no-model-diagnostic"]);
const root = resolve(".runtime/w20-exit/owned-once");
assert.ok(
  !existsSync(root),
  "Exclusive diagnostic already exists; no automatic retry",
);
mkdirSync(root);
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
const digest = (b) => createHash("sha256").update(b).digest("hex");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn) => {
  const end = Date.now() + 30000;
  while (!fn()) {
    if (Date.now() > end) throw new Error("DIAGNOSTIC_TIMEOUT");
    await pause(50);
  }
};
const report = {
  kind: "NO_MODEL_MCP_EXIT_DIAGNOSTIC",
  checks: [],
  facts: {},
  started_at: new Date().toISOString(),
};
const check = (name, passed) =>
  report.checks.push({ name, passed: passed === true });
const bridgeToken = randomBytes(32).toString("base64url");
let handle,
  before,
  server,
  modelRequests = 0,
  watchers = [];
const bridgePath = join(root, "bridge.json"),
  reports = join(root, "reports"),
  data = join(root, "data");
mkdirSync(reports);
mkdirSync(data);
const watch = async (pid, name) => {
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
  await until(() => existsSync(path + ".ready"));
  return item;
};
try {
  before = inventory();
  // Local rejection sink replaces any default remote provider. No request is expected.
  server = createServer((_req, res) => {
    modelRequests++;
    res.writeHead(503);
    res.end();
  });
  await listenLoopback(server);
  const origin = `http://127.0.0.1:${server.address().port}`;
  writeFileSync(
    bridgePath,
    JSON.stringify({
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
    }),
    { flag: "wx" },
  );
  const operator = operatorJson(
    readFileSync(resolve(".runtime/codex-launch-config.json"), "utf8"),
  );
  const launcher = officialCodexLauncher({
    installation_root: operator.installation_root,
    client_version: operator.client_version,
    executable_sha256: operator.executable_sha256,
    data_root: data,
    model_provider: {
      base_url: origin,
      model: "agent-weave-no-model-diagnostic",
    },
    bridge: { config_path: bridgePath, report_dir: reports },
  });
  report.facts.executable_sha256 = operator.executable_sha256;
  report.facts.launcher_fingerprint = launcher.fingerprint;
  handle = await launcher.launch(() => true);
  await handle.ready;
  await handle.startThread(handle.workDirectory);
  // Permit rename while reading a live report on Windows; ordinary Node reads
  // can briefly deny delete-sharing and interfere with the bridge's atomic save.
  const bridgeReports = () =>
    query(
      `$items=@(); Get-ChildItem -LiteralPath '${reports.replaceAll("'", "''")}' -Directory | ForEach-Object { $p=Join-Path $_.FullName 'report.json'; if(Test-Path -LiteralPath $p) { $s=[IO.File]::Open($p,[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)); $r=New-Object IO.StreamReader($s); try { $items+=($r.ReadToEnd() | ConvertFrom-Json) } finally { $r.Dispose() } } }; ConvertTo-Json -InputObject @($items) -Compress`,
    );
  await until(() => bridgeReports().some((r) => r.initialized));
  check(
    "bridge_initialized",
    bridgeReports().length === 1 && bridgeReports()[0].initialized,
  );
  // Select the bridge only by this newly-created exclusive config; never retain other command lines.
  const escaped = bridgePath.replaceAll("'", "''");
  const bridgeProcesses = [].concat(
    query(
      `@(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine.Contains('${escaped}') } | Select-Object ProcessId,ParentProcessId,CreationDate) | ConvertTo-Json -Compress`,
    ),
  );
  assert.equal(bridgeProcesses.length, 1);
  const child = bridgeProcesses[0];
  const parent = [].concat(
    query(
      `@(Get-CimInstance Win32_Process -Filter "ProcessId = ${child.ParentProcessId}" | Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath) | ConvertTo-Json -Compress`,
    ),
  );
  assert.equal(parent.length, 1);
  assert.equal(
    digest(readFileSync(parent[0].ExecutablePath)),
    operator.executable_sha256,
  );
  assert.ok(!before.some((p) => p.ProcessId === parent[0].ProcessId));
  const hostWatch = await watch(parent[0].ProcessId, "host");
  const bridgeWatch = await watch(child.ProcessId, "bridge");
  report.facts.preclose_bridge = bridgeReports()[0];
  report.facts.close_requested_at = new Date().toISOString();
  handle.close();
  const exit = await handle.closed;
  report.facts.host_exit = {
    code: exit.code,
    forced: exit.forced,
    exit_observed: exit.exit_observed,
    fault: exit.fault,
  };
  await until(() => existsSync(hostWatch.path) && existsSync(bridgeWatch.path));
  assert.equal((await hostWatch.ended)[0], 0);
  assert.equal((await bridgeWatch.ended)[0], 0);
  report.facts.host_os_exit = JSON.parse(readFileSync(hostWatch.path, "utf8"));
  report.facts.bridge_os_exit = JSON.parse(
    readFileSync(bridgeWatch.path, "utf8"),
  );
  report.facts.final_bridge = bridgeReports()[0];
  report.facts.protocol_statistics = structuredClone(handle.statistics);
  check("host_exit", exit.code === 0 && exit.exit_observed && !exit.forced);
  check("bridge_exit_observed", report.facts.bridge_os_exit.exit_observed);
  check("no_turn", noModelThread(handle.statistics, report.facts.final_bridge));
} catch (error) {
  report.error = {
    name: error.name,
    message_sha256: digest(String(error.message)),
  };
  check("diagnostic_execution", false);
} finally {
  if (handle) {
    handle.close();
    const exit = await handle.closed;
    report.facts.cleanup_host_exit = {
      code: exit.code,
      exit_observed: exit.exit_observed,
      forced: exit.forced,
    };
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
  check("no_provider_request", modelRequests === 0);
  try {
    assert.ok(!handle || report.facts.cleanup_host_exit.exit_observed);
    const configs = [
      bridgePath,
      ...readdirSync(data).map((n) => join(data, n, "home", "config.toml")),
    ].filter(existsSync);
    report.facts.cleanup = cleanCredentials(root, configs, [bridgeToken]);
    check("cleanup", report.facts.cleanup.residual_files === 0);
    check(
      "original_processes_unchanged",
      JSON.stringify(before) === JSON.stringify(inventory()),
    );
  } catch {
    check("cleanup_or_preservation", false);
  }
  report.finished_at = new Date().toISOString();
  report.status = report.checks.every((c) => c.passed)
    ? "DIAGNOSTIC_CAPTURED_NOT_PRODUCT_PASS"
    : "DIAGNOSTIC_FAILED";
  writeFileSync(
    join(root, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx" },
  );
  console.log(JSON.stringify(report, null, 2));
  if (report.status === "DIAGNOSTIC_FAILED") process.exitCode = 1;
}
