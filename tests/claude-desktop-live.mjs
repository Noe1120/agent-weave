// Explicitly authorized native Desktop/MCP feasibility attempt, excluded from npm verify.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { prepareClaudeProbe, fileHash } from "./claude-desktop-launch.ts";
import { summarizeClaudeAttempt } from "./claude-desktop-result.ts";
import {
  prepareClaudeThirdPartyProbe,
  redactProbeCredential,
  checkPreparedProbe,
} from "./claude-third-party-probe.ts";
import { McpReadClient } from "../packages/service/src/mcp-read-client.ts";
const { values } = parseArgs({
  options: {
    "allow-claude-desktop-probe": { type: "boolean" },
    config: { type: "string" },
    output: { type: "string" },
    "third-party-route": { type: "string" },
    "allow-third-party-credential-reuse": { type: "boolean" },
    "read-connector-config": { type: "string" },
  },
  strict: true,
});
assert.equal(
  values["allow-claude-desktop-probe"],
  true,
  "Explicit fresh-profile Desktop probe authorization required",
);
assert.equal(process.platform, "win32");
assert.ok(values["third-party-route"], "CLAUDE_CC_SWITCH_ROUTE_REQUIRED");
if (values["third-party-route"])
  assert.equal(
    values["allow-third-party-credential-reuse"],
    true,
    "CLAUDE_CREDENTIAL_REUSE_AUTHORIZATION_REQUIRED",
  );
assert.ok(values.config && isAbsolute(values.config));
assert.ok(values.output && isAbsolute(values.output));
mkdirSync(values.output);
const write = (name, data) =>
  writeFileSync(
    join(values.output, name),
    JSON.stringify(data, null, 2) + "\n",
    { flag: "wx" },
  );
function inventory() {
  const raw = execFileSync(
    join(
      process.env.SystemRoot,
      "System32/WindowsPowerShell/v1.0/powershell.exe",
    ),
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "@(Get-CimInstance Win32_Process -Filter \"Name = 'claude.exe' OR Name = 'DeepSeek Harness.exe'\" -ErrorAction Stop | Select-Object ProcessId, ParentProcessId, CreationDate, ExecutablePath | Sort-Object ProcessId) | ConvertTo-Json -Compress",
    ],
    { windowsHide: true, encoding: "utf8", timeout: 15000 },
  );
  const rows = raw.trim() ? JSON.parse(raw) : [];
  return Array.isArray(rows) ? rows : [rows];
}
const config = JSON.parse(
  readFileSync(values.config, "utf8").replace(/^\uFEFF/, ""),
);
if (values["read-connector-config"]) {
  assert.ok(isAbsolute(values["read-connector-config"]));
  new McpReadClient(
    JSON.parse(readFileSync(values["read-connector-config"], "utf8")),
  ).checkDisclosure();
}
const before = inventory();
write("process-before.json", before);
assert.ok(
  before.every(
    (p) => !p.ExecutablePath?.toLowerCase().endsWith("\\claude.exe"),
  ),
  "Existing Desktop process found; do not attach or restart it",
);
const hostDll = resolve("artifacts/claude-probe-host/Claude.ProbeHost.dll");
assert.ok(existsSync(hostDll), "CLAUDE_OWNED_HOST_NOT_BUILT");
const prepared = values["third-party-route"]
  ? await prepareClaudeThirdPartyProbe(
      config,
      JSON.parse(
        readFileSync(values["third-party-route"], "utf8").replace(
          /^\uFEFF/,
          "",
        ),
      ),
      values["allow-third-party-credential-reuse"],
    )
  : await prepareClaudeProbe(config);
await checkPreparedProbe(prepared, async () => {
  if (values["read-connector-config"]) {
    const path = join(prepared.profile, "claude_desktop_config.json");
    const prefs = JSON.parse(readFileSync(path, "utf8"));
    prefs.mcpServers["agent-weave-probe"] = {
      command: config.node,
      args: [
        config.server,
        "--config",
        values["read-connector-config"],
        "--report",
        prepared.report,
      ],
    };
    writeFileSync(path, JSON.stringify(prefs) + "\n");
  }
  const known = JSON.parse(
    execFileSync(
      resolve(".tools/dotnet/dotnet.exe"),
      [hostDll, "--known-folders"],
      {
        env: prepared.env,
        windowsHide: true,
        encoding: "utf8",
        timeout: 10000,
      },
    ),
  );
  assert.equal(
    known.roaming.toLowerCase(),
    prepared.env.APPDATA.toLowerCase(),
    "CLAUDE_ROAMING_PATH_MISMATCH",
  );
  assert.equal(
    known.local.toLowerCase(),
    prepared.env.LOCALAPPDATA.toLowerCase(),
    "CLAUDE_LOCAL_PATH_MISMATCH",
  );
  write("launch-intent.json", {
    at: new Date().toISOString(),
    prepared,
    host_sha256: await fileHash(hostDll),
    scope: values["third-party-route"]
      ? "fresh 3p profile / selected local gateway credential / MCP discovery only / no prompt / retained root handle"
      : "fresh profile / empty MCP / no login or prompt / retained root handle",
  });
});
const host = spawn(resolve(".tools/dotnet/dotnet.exe"), [hostDll], {
  cwd: prepared.cwd,
  windowsHide: true,
  shell: false,
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    SystemRoot: process.env.SystemRoot,
    TEMP: prepared.env.TEMP,
    TMP: prepared.env.TMP,
    DOTNET_CLI_TELEMETRY_OPTOUT: "1",
  },
});
const events = [];
let hostError = null,
  stderrBytes = 0,
  observed = false,
  exitCode = null,
  pipeClosed = false,
  stopping = false;
function stop() {
  if (!stopping) {
    stopping = true;
    host.stdin.end(JSON.stringify({ kind: "stop" }) + "\n");
  }
}
host.stdin.on("error", () => {
  if (!stopping && !observed) hostError ??= "HOST_STDIN";
});
host.stderr.on("data", (b) => {
  stderrBytes += b.length;
  if (stderrBytes > 65536) {
    hostError ??= "HOST_STDERR_LIMIT";
    stop();
  }
});
createInterface({ input: host.stdout }).on("line", (line) => {
  try {
    const event = JSON.parse(line);
    events.push(event);
    if (events.length > 128) {
      hostError ??= "HOST_FRAME_LIMIT";
      stop();
    }
    if (event.kind === "fault") {
      hostError ??= event.code;
      stop();
    }
  } catch {
    hostError ??= "HOST_PROTOCOL";
    stop();
  }
});
let finish;
const exited = new Promise((r) => {
  finish = r;
  host.once("exit", (code) => {
    observed = true;
    exitCode = code;
    r();
  });
  host.once("error", () => {
    hostError ??= "HOST_LAUNCH";
    r();
  });
});
host.once("close", () => {
  pipeClosed = true;
});
const watchdog = setTimeout(() => {
  hostError ??= "HOST_TIMEOUT";
  host.kill();
}, 75000);
const emergency = setTimeout(() => {
  hostError ??= "HOST_EXIT_UNOBSERVED";
  finish();
}, 80000);
host.stdin.write(
  JSON.stringify({ ...prepared, output: values.output, timeout_ms: 60000 }) +
    "\n",
);
const handshakePoll = setInterval(() => {
  if (!existsSync(prepared.report)) return;
  try {
    const current = JSON.parse(readFileSync(prepared.report, "utf8"));
    if (current.initialized && current.tools_list_requests > 0) stop();
    if (current.fault) {
      hostError ??= current.fault;
      stop();
    }
  } catch {
    hostError ??= "MCP_REPORT_INVALID";
    stop();
  }
}, 100);
await exited;
clearInterval(handshakePoll);
clearTimeout(watchdog);
clearTimeout(emergency);
// Exit is authoritative; streams may be held by another process. Never hang on close.
for (let i = 0; i < 20 && !pipeClosed; i++)
  await new Promise((r) => setTimeout(r, 50));
if (!pipeClosed) hostError ??= "HOST_PIPE_UNCLOSED";
host.stdin.destroy();
host.stdout.destroy();
host.stderr.destroy();
host.unref();
write("host-events.json", {
  events,
  hostError,
  stderrBytes,
  observed,
  exitCode,
  pipeClosed,
});
const after = inventory();
write("process-after.json", after);
const unchanged = JSON.stringify(before) === JSON.stringify(after);
let mcp = null;
try {
  if (existsSync(prepared.report))
    mcp = JSON.parse(readFileSync(prepared.report, "utf8"));
} catch {
  hostError ??= "MCP_REPORT_INVALID";
}
const ended = events.find((e) => e.kind === "exited");
const report = {
  ...summarizeClaudeAttempt({
    mcp,
    jobEmpty: ended?.job_empty === true,
    ownedRootExitObserved: ended?.root_exit_observed === true,
    existingClientsUnchanged: unchanged,
    hostExitObserved: observed,
    hostExitCode: exitCode,
    hostFault: hostError ?? ended?.fault ?? null,
  }),
  observed_at: new Date().toISOString(),
  client_version: prepared.client_version,
  executable_sha256: prepared.executable_sha256,
  archive_sha256: prepared.archive_sha256,
  host_exit_observed: observed,
  host_exit_code: exitCode,
  owned_root_exit_observed: ended?.root_exit_observed === true,
  job_empty: ended?.job_empty === true,
  existing_clients_unchanged: unchanged,
  host_fault: hostError,
  root_exit_code: ended?.root_exit_code ?? null,
  stop_reason: ended?.reason ?? null,
  mcp,
  scope: {
    login: false,
    model_prompt: false,
    original_profile: false,
    third_party_config: !!values["third-party-route"],
    selected_gateway_credential_reused: !!values["third-party-route"],
    ui_acceptance: false,
    os_isolation: false,
    production_adapter: false,
    read_connector_discovery: !!values["read-connector-config"],
  },
};
if (values["third-party-route"] && report.cleanup_confirmed) {
  await redactProbeCredential(prepared);
  report.scope.copied_gateway_credential_redacted = true;
}
write("report.json", report);
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.status === "REAL_CLAUDE_MCP_HANDSHAKE_PASS" ? 0 : 2;
