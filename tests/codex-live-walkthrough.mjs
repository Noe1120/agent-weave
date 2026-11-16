// Real installed Codex acceptance. Explicitly opt-in: never called by npm verify,
// and each level needs its own authorization flag.
//
//   --allow-codex-app-server-initialize  spawn the fixed CLI, one initialize, EOF
//   --allow-codex-new-thread             additionally create one native thread and
//                                        attach the platform read bridge over stdio MCP
//   --allow-codex-synthetic-turn         additionally run one synthetic turn against a
//                                        LOCAL loopback model stub, so one real tool call
//                                        reaches the platform service with no external
//                                        provider, no credential and no billing
//
// The real client, the real app-server protocol, the real MCP stdio bridge and the
// real platform HTTP service are all in the loop. Only the model is a local stub, and
// the report says so.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { parseArgs } from "node:util";
import { adapterFixture } from "./adapter-helpers.ts";
import { id } from "./helpers.ts";
import { officialCodexLauncher } from "../dist/packages/service/src/codex-app-server.js";
import { CodexRuntimeController } from "../dist/packages/service/src/codex-runtime.js";
import { createServer } from "../dist/packages/service/src/http.js";
import { listenLoopback } from "../dist/packages/service/src/loopback-listener.js";

const { values } = parseArgs({
  options: {
    "allow-codex-app-server-initialize": { type: "boolean" },
    "allow-codex-new-thread": { type: "boolean" },
    "allow-codex-synthetic-turn": { type: "boolean" },
    "allow-codex-provider-reuse": { type: "boolean" },
    "provider-config": { type: "string" },
    config: { type: "string" },
    output: { type: "string" },
  },
  strict: true,
});
assert.equal(
  values["allow-codex-app-server-initialize"],
  true,
  "Real client launch requires explicit app-server initialize authorization",
);
if (values["allow-codex-synthetic-turn"])
  assert.equal(
    values["allow-codex-new-thread"],
    true,
    "A turn needs its own thread authorization first",
  );
if (values["allow-codex-provider-reuse"]) {
  assert.equal(
    values["allow-codex-new-thread"],
    true,
    "A vendor turn needs its own thread authorization first",
  );
  assert.equal(
    values["allow-codex-synthetic-turn"],
    true,
    "A vendor turn is still one synthetic acceptance turn",
  );
  assert.ok(
    values["provider-config"] && isAbsolute(values["provider-config"]),
    "--provider-config must be an absolute path",
  );
}
const vendorTurn = values["allow-codex-provider-reuse"] === true;
assert.equal(process.platform, "win32");
assert.ok(values.config && isAbsolute(values.config));
assert.ok(values.output && isAbsolute(values.output));
// Exclusive output folder is the attempt latch: reruns cannot repeat a level here.
mkdirSync(values.output);
const out = (name) => join(values.output, name);
const write = (name, data) =>
  writeFileSync(out(name), JSON.stringify(data, null, 2) + "\n", {
    flag: "wx",
  });
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
      "@(Get-CimInstance Win32_Process -Filter \"Name = 'ChatGPT.exe' OR Name = 'codex.exe'\" -ErrorAction Stop | Select-Object ProcessId, ParentProcessId, CreationDate, ExecutablePath | Sort-Object ProcessId) | ConvertTo-Json -Compress",
    ],
    { windowsHide: true, encoding: "utf8", timeout: 20000 },
  );
  const value = text.trim() ? JSON.parse(text) : [];
  return Array.isArray(value) ? value : [value];
}
const clone = (value) =>
  value === undefined ? null : JSON.parse(JSON.stringify(value));
async function waitFor(file, ms = 20000) {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      return readFileSync(file, "utf8");
    } catch {
      if (Date.now() > deadline) throw new Error("timeout waiting for " + file);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

const operator = JSON.parse(
  readFileSync(values.config, "utf8").replace(/^\uFEFF/, ""),
);
const before = inventory();
write("process-before.json", before);
const steps = [];
let report;
let handle;
let controller;
let fixture;
let server;
let mock;
let mockState;
try {
  // Level 1: initialization only, straight through the fixed launcher.
  handle = await officialCodexLauncher(operator).launch(() => true);
  const initialize = await handle.ready;
  steps.push({
    step: "initialize",
    state: handle.status.state,
    user_agent: initialize.user_agent,
    codex_home: initialize.codex_home,
    platform_family: initialize.platform_family,
    platform_os: initialize.platform_os,
    unrecognized_fields: initialize.unrecognized_fields,
    schema: initialize.schema,
  });
  assert.equal(handle.status.state, "ready");
  handle.close();
  const exit = await handle.closed;
  steps.push({ step: "initialize_close", exit: clone(exit) });
  assert.equal(exit.exit_observed, true);
  assert.equal(exit.forced, false);

  let threadDigest = null;
  let turnState = null;
  let lastMessage = null;
  let tokenUsage = null;
  let bridge = null;
  let toolCallSeen = null;
  let launcherFingerprint = null;
  if (values["allow-codex-new-thread"]) {
    fixture = adapterFixture();
    fixture.g.expires_at = new Date(Date.now() + 900000).toISOString();
    fixture.s.updateGrant(fixture.g);
    server = createServer(fixture.service);
    await listenLoopback(server);
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    steps.push({
      step: "platform_service",
      origin,
      kind: "synthetic in-memory grant",
    });

    // The platform's own fixed-scope read bridge for this attempt.
    const reportDir = out("bridge-reports");
    mkdirSync(reportDir);
    const bridgeConfig = out("bridge-config.json");
    writeFileSync(
      bridgeConfig,
      JSON.stringify(
        {
          version: 1,
          target: "codex",
          service_origin: origin,
          project_id: fixture.ids.project,
          token: fixture.token,
          task_ids: [fixture.ids.task],
          execution_ids: [],
          allow_message_poll: false,
          egress: {
            data_class: "synthetic_only",
            provider_fingerprint: "a".repeat(64),
            expires_at: new Date(Date.now() + 900000).toISOString(),
          },
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );

    const launcherInput = {
      ...operator,
      bridge: { config_path: bridgeConfig, report_dir: reportDir },
    };
    if (vendorTurn) {
      // The operator's own loopback provider, read through a pinned provider block.
      launcherInput.provider_reuse = {
        source_config: values["provider-config"],
        provider_id: "custom",
      };
      steps.push({
        step: "provider_reuse",
        provider_id: "custom",
        kind: "operator-authorized loopback provider; exactly one turn",
        cost: "unknown before the turn; token usage captured after it",
      });
    } else if (values["allow-codex-synthetic-turn"]) {
      // A local Responses-API stub: the only non-real participant.
      const portFile = out("mock-port.txt");
      mockState = out("mock-requests.jsonl");
      mock = spawn(
        process.execPath,
        [
          fileURLToPath(new URL("./codex-mock-provider.mjs", import.meta.url)),
          portFile,
          mockState,
        ],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      const port = (await waitFor(portFile)).trim().replace("PORT=", "");
      launcherInput.model_provider = {
        base_url: `http://127.0.0.1:${port}`,
        // Only for a zero-cost tool-visibility probe of model-name gating.
        model: process.env.MOCK_MODEL_NAME ?? "agent-weave-mock",
      };
      steps.push({
        step: "model_stub",
        base_url: launcherInput.model_provider.base_url,
        kind: "local loopback Responses stub, no credential, no egress",
      });
    }
    const launcher = officialCodexLauncher(launcherInput);
    launcherFingerprint = launcher.fingerprint;
    controller = new CodexRuntimeController(fixture.s, launcher, {
      now: fixture.now,
      monitorMs: 250,
      turnMs: 150000,
    });
    const request = {
      project_id: fixture.ids.project,
      runtime_id: fixture.binding,
      scope_id: fixture.ids.scope,
      action_id: id(),
      expected_revision: "0",
      configuration_fingerprint: launcher.fingerprint,
    };
    await controller.start(fixture.token, request);
    let view = controller.read(
      fixture.token,
      fixture.ids.project,
      fixture.binding,
    );
    assert.equal(view.state, "ready");
    assert.equal(view.session_id, null);
    assert.equal(view.qualification, "UNVERIFIED");
    threadDigest = view.native_thread_sha256;
    steps.push({
      step: "native_thread",
      state: view.state,
      native_thread_sha256: threadDigest,
      platform_session_id: view.session_id,
      mcp_bridge_attached: true,
    });
    const writes = fixture.s.db.prepare("SELECT total_changes() n").get().n;
    for (let i = 0; i < 1000; i++)
      controller.read(fixture.token, fixture.ids.project, fixture.binding);
    assert.equal(
      fixture.s.db.prepare("SELECT total_changes() n").get().n,
      writes,
    );
    steps.push({ step: "read_progress", reads: 1000, database_writes: 0 });

    if (values["allow-codex-synthetic-turn"]) {
      view = controller.read(
        fixture.token,
        fixture.ids.project,
        fixture.binding,
      );
      await controller.turn(fixture.token, {
        project_id: fixture.ids.project,
        runtime_id: fixture.binding,
        action_id: id(),
        expected_revision: view.revision,
        instruction_profile: "synthetic_task_get/1",
        task_id: fixture.ids.task,
      });
      const deadline = Date.now() + 150000;
      for (;;) {
        view = controller.read(
          fixture.token,
          fixture.ids.project,
          fixture.binding,
        );
        if (!view.turn || view.turn.state !== "requested") break;
        if (Date.now() > deadline) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      turnState = view.turn?.state ?? "none";
      lastMessage = view.last_agent_message;
      tokenUsage = view.token_usage ?? null;
      steps.push({
        step: "synthetic_turn",
        state: view.state,
        turn: view.turn,
        fault: view.fault,
        last_agent_message: lastMessage,
        statistics: view.statistics,
      });
    }
    view = controller.read(fixture.token, fixture.ids.project, fixture.binding);
    await controller.close(fixture.token, {
      project_id: fixture.ids.project,
      runtime_id: fixture.binding,
      action_id: id(),
      expected_revision: view.revision,
    });
    view = controller.read(fixture.token, fixture.ids.project, fixture.binding);
    steps.push({ step: "close", state: view.state, exit: clone(view.exit) });
    assert.equal(view.state, "closed");
    assert.equal(view.exit?.exit_observed, true);
    assert.equal(view.exit?.forced, false);

    // The real client's own view of the bridge, and the stub's request log.
    bridge = readdirSync(reportDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        try {
          return JSON.parse(
            readFileSync(join(reportDir, d.name, "report.json"), "utf8"),
          );
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    steps.push({
      step: "bridge_connections",
      connections: bridge.map((b) => ({
        target: b.target,
        initialized: b.initialized,
        tool_calls: b.tool_calls,
        tool_errors: b.tool_errors,
        fault: b.fault,
        stdin_eof: b.stdin_eof,
      })),
    });
    if (values["allow-codex-synthetic-turn"]) {
      const lines = readFileSync(mockState, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      toolCallSeen = lines.some((l) => l.result === "tool_call");
      const finalRound = lines.filter((l) => l.result === "final_message");
      steps.push({
        step: "model_stub_requests",
        rounds: lines.length,
        advertised_tools: lines[0]?.tool_names ?? [],
        tool_call_rounds: lines.filter((l) => l.result === "tool_call").length,
        tool_output_rounds: finalRound.length,
        final_reply: finalRound.at(-1)?.reply ?? null,
      });
      assert.equal(toolCallSeen, true, "the real client never called the tool");
      assert.ok(
        finalRound.length >= 1 && /draft/.test(finalRound.at(-1).reply),
        "the platform read result never reached the model stub",
      );
      assert.equal(turnState, "completed", "the native turn did not complete");
      if (vendorTurn) {
        assert.ok(tokenUsage, "the client did not report token usage");
        assert.ok(
          tokenUsage.total > 0 && tokenUsage.total <= 200000,
          "token usage is missing or implausible: " +
            JSON.stringify(tokenUsage),
        );
      }
      assert.ok(
        lastMessage && lastMessage.includes(fixture.ids.task),
        "the native agent message did not carry the synthetic task id",
      );
      assert.ok(
        bridge.some((b) => b.tool_calls >= 1 && b.tool_errors === 0),
        "no bridge connection reported exactly the tool call",
      );
    } else if (!values["allow-codex-synthetic-turn"])
      assert.ok(
        bridge.every((b) => b.tool_calls === 0),
        "a thread-only run must not call a tool",
      );
    assert.ok(bridge.length >= 1, "the real client never opened the bridge");
    assert.ok(
      bridge.every((b) => b.initialized === true && b.fault === null),
      "the bridge handshake did not complete cleanly",
    );
    assert.equal(
      controller.read(fixture.token, fixture.ids.project, fixture.binding)
        .state,
      "closed",
    );
  }
  const after = inventory();
  write("process-after.json", after);
  const unchanged = JSON.stringify(before) === JSON.stringify(after);
  report = {
    status: vendorTurn
      ? "REAL_CODEX_VENDOR_TOOL_ROUND_TRIP_PASS"
      : values["allow-codex-synthetic-turn"]
        ? "REAL_CODEX_TOOL_ROUND_TRIP_PASS"
        : threadDigest
          ? "REAL_CODEX_APP_SERVER_LIFECYCLE_PASS"
          : "REAL_CODEX_APP_SERVER_INITIALIZE_PASS",
    observed_at: new Date().toISOString(),
    platform_state:
      "synthetic isolated in-memory fixture; fresh CODEX_HOME per launch",
    client_version: operator.client_version,
    configuration_fingerprint: launcherFingerprint,
    thread_created: Boolean(threadDigest),
    native_thread_sha256: threadDigest,
    synthetic_turn_state: turnState,
    native_agent_message_sha256: lastMessage
      ? createHash("sha256").update(lastMessage).digest("hex")
      : null,
    native_agent_message_matches_task:
      lastMessage && fixture ? lastMessage.includes(fixture.ids.task) : null,
    model: vendorTurn
      ? "operator loopback provider (real vendor route, exactly one turn)"
      : values["allow-codex-synthetic-turn"]
        ? "local loopback Responses stub (the only non-real participant)"
        : "not invoked",
    token_usage: tokenUsage,
    user_configuration_used: false,
    credentials_supplied: false,
    user_sessions_read: false,
    existing_client_attached: false,
    original_client_processes: {
      before: before.length,
      after: after.length,
      unchanged,
    },
    steps,
    client_qualification: "UNVERIFIED",
    windows_isolation: "UNVERIFIED",
  };
  assert.equal(unchanged, true, "Original client processes changed");
} catch (error) {
  report = {
    status: "FAIL",
    steps,
    error: { name: error?.name, message: error?.message },
  };
  process.exitCode = 1;
} finally {
  handle?.close();
  if (controller) await controller.dispose();
  if (server) await new Promise((r) => server.close(() => r()));
  fixture?.close();
  mock?.kill();
}
write("report.json", report);
console.log(JSON.stringify(report, null, 2));
