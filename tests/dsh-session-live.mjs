// Real installed DSH, explicitly opt-in. Never called by verify or ordinary DSH tests.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import { parseArgs } from "node:util";
import { prepareFreshDshProbe } from "./dsh-session-launch.ts";
import { probeFreshSession } from "./dsh-session-probe.ts";
const { values } = parseArgs({
  options: {
    "allow-dsh-new-session": { type: "boolean" },
    config: { type: "string" },
    output: { type: "string" },
  },
  strict: true,
});
assert.equal(
  values["allow-dsh-new-session"],
  true,
  "Explicit fresh-session authorization required",
);
assert.equal(process.platform, "win32");
assert.ok(values.config && isAbsolute(values.config));
assert.ok(values.output && isAbsolute(values.output));
// Exclusive output folder is the attempt latch: reruns cannot repeat session/new here.
mkdirSync(values.output);
const write = (name, data) =>
  writeFileSync(
    join(values.output, name),
    JSON.stringify(data, null, 2) + "\n",
    { flag: "wx" },
  );
function inventory() {
  const text = execFileSync(
    join(
      process.env.SystemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "@(Get-CimInstance Win32_Process -Filter \"Name = 'DeepSeek Harness.exe'\" -ErrorAction Stop | Select-Object ProcessId, ParentProcessId, CreationDate, ExecutablePath | Sort-Object ProcessId) | ConvertTo-Json -Compress",
    ],
    { windowsHide: true, encoding: "utf8", timeout: 15000 },
  );
  const value = text.trim() ? JSON.parse(text) : [];
  return Array.isArray(value) ? value : [value];
}
const config = JSON.parse(
  readFileSync(values.config, "utf8").replace(/^\uFEFF/, ""),
);
const prepared = await prepareFreshDshProbe(config);
const before = inventory();
write("process-before.json", before);
write("launch-intent.json", {
  at: new Date().toISOString(),
  prepared,
  allowed: ["initialize", "session/new", "session/close"],
  prompt_allowed: false,
});
const child = spawn(prepared.executable, prepared.args, {
  cwd: prepared.cwd,
  env: prepared.env,
  windowsHide: true,
  shell: false,
  stdio: ["pipe", "pipe", "pipe"],
});
const lifecycle = await probeFreshSession(child, prepared.cwd, {
  onStderr: (bytes) => appendFileSync(prepared.diagnostic, bytes),
});
// Persist protocol outcome before postflight; inventory failures must not erase lifecycle evidence.
write("lifecycle.json", lifecycle);
const after = inventory();
write("process-after.json", after);
const unchanged = JSON.stringify(before) === JSON.stringify(after);
const report = {
  status:
    lifecycle.outcome === "PASS" && unchanged
      ? "REAL_DSH_FRESH_SESSION_PASS"
      : "REAL_DSH_FRESH_SESSION_NOT_PASSED",
  observed_at: new Date().toISOString(),
  client_version: prepared.client_version,
  executable_sha256: prepared.executable_sha256,
  archive_sha256: prepared.archive_sha256,
  lifecycle,
  desktop_processes: { before: before.length, after: after.length, unchanged },
  outbound_prompt_requests: 0,
  mcp_servers_supplied: 0,
  existing_credentials_supplied: false,
  old_session_operations: 0,
  model_invocation: "no prompt sent; not an OS network audit",
  qualification: "UNVERIFIED",
  windows_isolation: "NOT_TESTED",
  native_click_acceptance: "NOT_RUN",
};
write("report.json", report);
console.log(JSON.stringify(report, null, 2));
assert.equal(
  report.status,
  "REAL_DSH_FRESH_SESSION_PASS",
  "Probe failed; inspect local bounded diagnostics, do not retry session/new automatically",
);
