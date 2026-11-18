// One approved W31 attempt, not a default launcher or a model task runner.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { officialCodexRelayLauncher } from "../dist/packages/service/src/codex-relay-launcher.js";
import {
  tomlSectionValue,
  verifyCodexInstallation,
} from "../dist/packages/service/src/codex-app-server.js";
import { listenLoopback } from "../dist/packages/service/src/loopback-listener.js";
import { cleanCredentials, noModelThread } from "./codex-joint-support.mjs";

assert.deepEqual(process.argv.slice(2), ["--allow-w31-once"]);
const pin = "094d4db493de22025712cc5963854e7654b7c97f4cee795e3e986270a0f4f6b4";
const install = join(
  process.env.LOCALAPPDATA,
  "OpenAI/Codex/bin/c38161ad8494f88c",
);
await verifyCodexInstallation(install, pin);
const root = resolve(import.meta.dirname, "../.runtime/w31-no-model-once");
const data = join(root, "data"),
  bridges = join(root, "bridges");
const ps = (script) =>
  execFileSync(
    "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { windowsHide: true, encoding: "utf8", timeout: 10000 },
  ).trim();
const inventory = () =>
  ps(
    `@(Get-CimInstance Win32_Process -Filter "Name = 'codex.exe' OR Name = 'ChatGPT.exe'" | Sort-Object ProcessId | Select-Object ProcessId,CreationDate) | ConvertTo-Json -Compress`,
  );
const before = inventory();
mkdirSync(root); // Exclusive, fixed across invocations. Never auto-delete or retry.
mkdirSync(data);
mkdirSync(bridges);
const token = randomBytes(32).toString("base64url");
let requests = 0,
  handle,
  relayToken;
const sink = createServer((_req, res) => {
  requests++;
  res.writeHead(503);
  res.end();
});
const result = {
  pin,
  started_at: new Date().toISOString(),
  status: "FAILED",
  stage: "prepare",
};
const bridgePath = () => {
  const names = readdirSync(bridges);
  assert.equal(names.length, 1);
  return join(bridges, names[0], "report.json");
};
try {
  await listenLoopback(sink);
  const origin = `http://127.0.0.1:${sink.address().port}`;
  const launcher = officialCodexRelayLauncher(
    {
      installation_root: install,
      data_root: data,
      client_version: "w31-pin-094d4db4",
      executable_sha256: pin,
      model_provider: {
        base_url: origin,
        model: "agent-weave-no-model-diagnostic",
      },
    },
    {
      dataRoot: bridges,
      config: {
        version: 1,
        target: "codex",
        service_origin: origin,
        project_id: randomUUID(),
        token,
        task_ids: [randomUUID()],
        execution_ids: [],
        allow_message_poll: false,
        egress: {
          data_class: "synthetic_only",
          provider_fingerprint: "a".repeat(64),
          expires_at: new Date(Date.now() + 180000).toISOString(),
        },
      },
    },
  );
  result.stage = "launch";
  handle = await launcher.launch(() => true);
  const config = join(dirname(handle.workDirectory), "home", "config.toml");
  relayToken = JSON.parse(
    tomlSectionValue(
      readFileSync(config, "utf8"),
      "mcp_servers.agent-weave-probe.env",
      "TEAM_RELAY",
    ),
  ).token;
  assert.match(relayToken, /^[a-f0-9]{64}$/);
  result.stage = "initialize";
  const hello = await handle.ready;
  result.client_version =
    hello.user_agent?.match(/\b\d+\.\d+\.\d+(?:[-.][A-Za-z0-9.]+)?/)?.[0] ??
    null;
  result.stage = "thread_and_relay";
  const thread = await handle.startThread(handle.workDirectory);
  result.thread_digest = createHash("sha256").update(thread).digest("hex");
  result.stage = "discovery";
  const until = Date.now() + 15000,
    file = bridgePath();
  for (;;) {
    if (existsSync(file)) {
      const text = ps(
        `$s=[IO.File]::Open('${file.replaceAll("'", "''")}', 'Open', 'Read', ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)); $r=New-Object IO.StreamReader($s); try {$r.ReadToEnd()} finally {$r.Dispose()}`,
      );
      if (JSON.parse(text).tools_list_requests >= 1) break;
    }
    if (Date.now() >= until) throw new Error("DISCOVERY_TIMEOUT");
    await delay(100);
  }
  result.stage = "close";
} catch (error) {
  result.error = /^[A-Z_]+$/.test(error.message)
    ? error.message
    : "ACCEPTANCE_FAILED";
} finally {
  try {
    if (handle) {
      handle.close();
      const exit = await handle.closed;
      result.exit = {
        code: exit.code,
        observed: exit.exit_observed,
        forced: exit.forced,
        fault: exit.fault,
      };
      result.generation = exit.statistics.generation;
      const report = JSON.parse(readFileSync(bridgePath(), "utf8"));
      result.bridge = {
        initialized: report.initialized,
        list: report.tools_list_requests,
        calls: report.tool_calls,
        errors: report.tool_errors,
        eof: report.stdin_eof,
        fault: report.fault,
      };
      result.no_turn = noModelThread(exit.statistics, report);
      result.configs_removed =
        !existsSync(join(dirname(handle.workDirectory), "home/config.toml")) &&
        !existsSync(join(dirname(bridgePath()), "bridge.json"));
      if (exit.exit_observed && relayToken)
        result.scan = cleanCredentials(root, [], [token, relayToken]);
    }
  } catch {
    result.evidence_error = "EXIT_OR_CLEANUP_EVIDENCE";
  }
  sink.closeAllConnections();
  if (sink.listening) await new Promise((r) => sink.close(r));
  result.sink_requests = requests;
  result.originals_unchanged = inventory() === before;
  if (
    !result.error &&
    !result.evidence_error &&
    result.stage === "close" &&
    result.exit?.code === 0 &&
    result.exit.observed &&
    !result.exit.forced &&
    result.exit.fault === null &&
    result.no_turn &&
    result.bridge.initialized &&
    result.bridge.list === 1 &&
    result.bridge.errors === 0 &&
    result.bridge.eof &&
    result.bridge.fault === null &&
    !requests &&
    result.originals_unchanged &&
    result.configs_removed &&
    result.scan?.residual_files === 0
  )
    result.status = "PASSED_FIXED_NO_MODEL_LIFECYCLE";
  result.finished_at = new Date().toISOString();
  writeFileSync(
    join(root, "result.json"),
    JSON.stringify(result, null, 2) + "\n",
    { flag: "wx" },
  );
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "FAILED") process.exitCode = 1;
}
