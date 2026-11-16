// Real installed Codex acceptance. Explicitly opt-in: never called by npm verify,
// and each level needs its own authorization flag plus its own new output folder.
//
//   --allow-codex-app-server-initialize  spawn the fixed CLI, one initialize, EOF
//   --allow-codex-new-thread             create one native thread and attach the
//                                        platform read bridge over stdio MCP
//   --allow-codex-synthetic-turn         run one turn; the model is a local stub
//   --allow-codex-provider-reuse         run one turn against the operator's own
//                                        loopback provider (never the stub)
//
// The real client, the real app-server protocol, the real MCP stdio bridge and the
// real platform HTTP service are always in the loop. The two turn modes are kept
// apart: a stub run can never borrow a vendor result, and a vendor run never reads
// the stub's request log. Nothing here throws away evidence: every check is
// recorded, and the report, the process post-check and the cleanup summary are
// written on the success path, the failure path and the exception path alike.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import { parseArgs } from "node:util";
import { adapterFixture } from "./adapter-helpers.ts";
import { id } from "./helpers.ts";
import {
  acceptanceMode,
  acceptanceStatus,
  levelPassed,
  readMockRequests,
  readsMockRequests,
} from "./codex-acceptance-plan.ts";
import {
  officialCodexLauncher,
  tomlSectionValue,
} from "../dist/packages/service/src/codex-app-server.js";
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
    "provider-model": { type: "string" },
    "code-mode-direct": { type: "string" },
    "token-threshold": { type: "string" },
    config: { type: "string" },
    output: { type: "string" },
  },
  strict: true,
});
if (!values.config || !isAbsolute(values.config))
  throw new Error("--config must be an absolute path");
if (!values.output || !isAbsolute(values.output))
  throw new Error("--output must be an absolute path");
const mode = acceptanceMode({
  initialize: values["allow-codex-app-server-initialize"] === true,
  thread: values["allow-codex-new-thread"] === true,
  turn: values["allow-codex-synthetic-turn"] === true,
  vendor: values["allow-codex-provider-reuse"] === true,
});
if (
  values["allow-codex-provider-reuse"] &&
  !values["allow-codex-synthetic-turn"]
)
  throw new Error(
    "--allow-codex-provider-reuse still needs the synthetic turn gate",
  );
if (values["allow-codex-provider-reuse"] && !values["provider-config"])
  throw new Error("--provider-config is required for a vendor turn");
if (process.platform !== "win32") throw new Error("Windows only");

// Exclusive output folder: a rerun can never overwrite an earlier attempt.
const operatorConfig = JSON.parse(
  readFileSync(values.config, "utf8").replace(/^\uFEFF/, ""),
);

mkdirSync(values.output);
const out = (name) => join(values.output, name);
const write = (name, data) => {
  writeFileSync(out(name), JSON.stringify(data, null, 2) + "\n", "utf8");
  return name;
};
const clone = (value) =>
  value === undefined ? null : JSON.parse(JSON.stringify(value));

const facts = {
  mode,
  bridgeConnections: 0,
  bridgeToolCalls: 0,
  bridgeToolErrors: 0,
  bridgeFaults: 0,
  turnState: null,
  agentMessage: null,
  tokenUsageTotal: null,
  taskId: null,
  stubRounds: null,
  processUnchanged: false,
  cleanupComplete: false,
  harnessError: null,
  protocolError: null,
};
const report = {
  schema: 2,
  mode,
  status: "UNKNOWN",
  started_at: new Date().toISOString(),
  finished_at: null,
  status_vocabulary: [
    "PASS_REAL_CLIENT_WITH_LOCAL_MODEL_STUB",
    "PASS_REAL_VENDOR_TOOL_ROUND_TRIP",
    "FAILED_AT_MODEL_TOOL_SELECTION",
    "FAILED_AT_HARNESS",
    "FAILED_AT_PROTOCOL",
    "NOT_RUN",
    "UNVERIFIED",
    "UNKNOWN",
  ],
  evidence_files_read: [],
  checks: [],
  failures: [],
  steps: [],
  cleanup: null,
  process: null,
  error: null,
  facts,
  author_self_review: true,
  independent_review: false,
};
const check = (code, ok, detail = null) => {
  report.checks.push({ code, ok: Boolean(ok), detail });
  if (!ok) report.failures.push({ code, detail });
  return Boolean(ok);
};

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
async function waitFor(file, ms = 20000) {
  const deadline = Date.now() + ms;
  for (;;) {
    if (existsSync(file)) return readFileSync(file, "utf8");
    if (Date.now() > deadline) throw new Error("timeout waiting for " + file);
    await new Promise((r) => setTimeout(r, 100));
  }
}

let handle;
let controller;
let fixture;
let server;
let mock;
let reportDir = null;
let bridgeConfig = null;
let before = [];
const cleanup = [];
try {
  before = inventory();
  write("process-before.json", before);

  // ---- Level 1: initialize only, straight through the fixed launcher ----
  handle = await officialCodexLauncher(operatorConfig).launch(() => true);
  const initialize = await handle.ready;
  report.steps.push({
    step: "initialize",
    state: handle.status.state,
    user_agent: initialize.user_agent,
    codex_home: initialize.codex_home,
    platform_family: initialize.platform_family,
    platform_os: initialize.platform_os,
    unrecognized_fields: initialize.unrecognized_fields,
    schema: initialize.schema,
  });
  check("initialize_ready", handle.status.state === "ready");
  handle.close();
  const initExit = await handle.closed;
  report.steps.push({ step: "initialize_close", exit: clone(initExit) });
  check("initialize_exit_zero", initExit.code === 0, String(initExit.code));
  check("initialize_not_forced", initExit.forced === false);
  check("initialize_exit_observed", initExit.exit_observed === true);
  handle = undefined;

  // ---- Level 2: native thread + platform bridge (+ optional model) ----
  if (mode !== "initialize") {
    fixture = adapterFixture();
    fixture.g.expires_at = new Date(Date.now() + 900000).toISOString();
    fixture.s.updateGrant(fixture.g);
    server = createServer(fixture.service);
    await listenLoopback(server);
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("platform service has no port");
    const origin = `http://127.0.0.1:${address.port}`;
    report.steps.push({
      step: "platform_service",
      origin,
      kind: "synthetic in-memory grant",
    });

    reportDir = out("bridge-reports");
    mkdirSync(reportDir);
    bridgeConfig = out("bridge-config.json");
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

    const operator = operatorConfig;
    const launcherInput = {
      ...operator,
      bridge: { config_path: bridgeConfig, report_dir: reportDir },
    };
    let modelKind = "none";
    if (mode === "vendor") {
      if (values["code-mode-direct"])
        launcherInput.code_mode = {
          direct_only_tool_namespaces: [values["code-mode-direct"]],
        };
      launcherInput.provider_reuse = {
        source_config: values["provider-config"],
        provider_id: "custom",
        ...(values["provider-model"]
          ? { model: values["provider-model"] }
          : {}),
      };
      modelKind = "vendor loopback route";
      report.steps.push({
        step: "provider_reuse",
        provider_id: "custom",
        model_override: values["provider-model"] ?? null,
        code_mode_direct: values["code-mode-direct"] ?? null,
      });
    } else if (mode === "stub") {
      const portFile = out("mock-port.txt");
      const mockState = out("mock-requests.jsonl");
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
        model: process.env.MOCK_MODEL_NAME ?? "agent-weave-mock",
      };
      modelKind = "local loopback stub";
      report.steps.push({
        step: "model_stub",
        base_url: launcherInput.model_provider.base_url,
        kind: "local loopback Responses stub, no credential, no egress",
      });
    }

    const launcher = officialCodexLauncher(launcherInput);
    controller = new CodexRuntimeController(fixture.s, launcher, {
      now: fixture.now,
      monitorMs: 250,
      turnMs: 150000,
    });
    await controller.start(fixture.token, {
      project_id: fixture.ids.project,
      runtime_id: fixture.binding,
      scope_id: fixture.ids.scope,
      action_id: id(),
      expected_revision: "0",
      configuration_fingerprint: launcher.fingerprint,
    });
    let view = controller.read(
      fixture.token,
      fixture.ids.project,
      fixture.binding,
    );
    facts.taskId = fixture.ids.task;
    report.steps.push({
      step: "native_thread",
      state: view.state,
      native_thread_sha256: view.native_thread_sha256,
      platform_session_id: view.session_id,
      model: modelKind,
    });
    check("thread_ready", view.state === "ready", view.fault);
    check("thread_no_platform_session", view.session_id === null);
    check(
      "thread_digest_present",
      typeof view.native_thread_sha256 === "string",
    );

    // The client starts its MCP servers asynchronously; give the bridge a
    // bounded window to appear before judging the connection.
    const bridgeDeadline = Date.now() + 20000;
    while (Date.now() < bridgeDeadline) {
      const connected =
        reportDir &&
        readdirSync(reportDir, { withFileTypes: true }).some((entry) => {
          if (!entry.isDirectory()) return false;
          return existsSync(join(reportDir, entry.name, "report.json"));
        });
      if (connected) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const writes = fixture.s.db.prepare("SELECT total_changes() n").get().n;
    for (let i = 0; i < 1000; i++)
      controller.read(fixture.token, fixture.ids.project, fixture.binding);
    const afterReads = fixture.s.db.prepare("SELECT total_changes() n").get().n;
    report.steps.push({ step: "read_progress", reads: 1000 });
    check(
      "progress_reads_zero_writes",
      writes === afterReads,
      `${writes}→${afterReads}`,
    );

    if (mode === "stub" || mode === "vendor") {
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
      // Running-usage guard: the client reports usage while the turn runs, so a
      // threshold can stop this owned turn. Reporting can lag, so this is a
      // monitor, not a hard cap, and the report says so.
      const threshold = Number(values["token-threshold"] ?? 30000);
      let interruptedAt = null;
      for (;;) {
        view = controller.read(
          fixture.token,
          fixture.ids.project,
          fixture.binding,
        );
        if (!view.turn || view.turn.state !== "requested") break;
        if (
          interruptedAt === null &&
          Number.isFinite(threshold) &&
          (view.token_usage?.total ?? 0) >= threshold
        ) {
          interruptedAt = view.token_usage?.total ?? null;
          report.steps.push({
            step: "token_threshold",
            tokens: interruptedAt,
            action: "interrupt this owned turn",
            limit_is_soft: true,
          });
          try {
            await controller.interrupt(fixture.token, {
              project_id: fixture.ids.project,
              runtime_id: fixture.binding,
              action_id: id(),
              expected_revision: view.revision,
            });
          } catch (error) {
            report.steps.push({
              step: "token_threshold_interrupt_failed",
              error: String(error?.message ?? error),
            });
          }
        }
        if (Date.now() > deadline) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      report.steps.push({
        step: "token_monitor",
        threshold: Number.isFinite(threshold) ? threshold : null,
        interrupted_at: interruptedAt,
        note: "usage reporting can lag; stopping may still be billed after this point",
      });
      facts.turnState = view.turn?.state ?? "none";
      facts.agentMessage = view.last_agent_message ?? null;
      facts.tokenUsageTotal = view.token_usage?.total ?? null;
      report.steps.push({
        step: "synthetic_turn",
        state: view.state,
        turn: view.turn,
        fault: view.fault,
        token_usage: view.token_usage,
        agent_message: facts.agentMessage,
        statistics: view.statistics,
      });
      check("turn_terminal", facts.turnState === "completed", facts.turnState);
      check(
        "turn_message_carries_task",
        Boolean(facts.agentMessage?.includes(fixture.ids.task)),
        facts.agentMessage,
      );
      if (mode === "vendor")
        check("turn_reports_token_usage", (facts.tokenUsageTotal ?? 0) > 0);
    }

    // Revocation: the platform must refuse reads and stop its own process.
    const revoke = {
      step: "revocation",
      read: null,
      state_after: null,
      stopped: false,
    };
    try {
      fixture.g.state = "revoked";
      fixture.s.updateGrant(fixture.g);
      try {
        controller.read(fixture.token, fixture.ids.project, fixture.binding);
        revoke.read = "still_allowed";
      } catch (error) {
        revoke.read = String(error?.code ?? error?.message ?? error);
      }
      controller.reconcileAuthorization();
      // The grant is revoked, so controller.read is denied by design; observe the
      // persisted projection and the owned process, not the token path.
      const persisted = () =>
        fixture.s.getResource(fixture.binding)?.data ?? null;
      const deadlineRevoke = Date.now() + 25000;
      while (Date.now() < deadlineRevoke) {
        const data = persisted();
        if (
          data &&
          (data.state === "closing" || data.state === "closed" || data.exit)
        ) {
          revoke.stopped = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      const settled = persisted();
      revoke.state_after = settled?.state ?? null;
      revoke.exit = clone(settled?.exit ?? null);
    } catch (error) {
      revoke.error = String(error?.message ?? error);
    }
    report.steps.push(revoke);
    check(
      "revocation_refuses_reads",
      revoke.read !== null && revoke.read !== "still_allowed",
      revoke.read,
    );
    check(
      "revocation_stops_owned_process",
      revoke.stopped === true,
      revoke.state_after,
    );

    // Wait for the stop to reach a confirmed exit before judging it.
    const closeDeadline = Date.now() + 25000;
    let final = fixture.s.getResource(fixture.binding)?.data ?? null;
    while (Date.now() < closeDeadline) {
      final = fixture.s.getResource(fixture.binding)?.data ?? null;
      if (final?.state === "closed" && final?.exit) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    report.steps.push({
      step: "close_after_revocation",
      state: final?.state ?? null,
      exit: clone(final?.exit ?? null),
    });
    check("close_state", final?.state === "closed", final?.state ?? null);
    check("close_exit_observed", final?.exit?.exit_observed === true);
    check("close_not_forced", final?.exit?.forced === false);
  }

  // ---- Evidence from the real client's own bridge connections ----
  if (reportDir) {
    const connections = readdirSync(reportDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        try {
          return JSON.parse(
            readFileSync(join(reportDir, entry.name, "report.json"), "utf8"),
          );
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    report.evidence_files_read.push("bridge-reports/*/report.json");
    facts.bridgeConnections = connections.length;
    facts.bridgeToolCalls = connections.reduce(
      (sum, item) => sum + Number(item.tool_calls ?? 0),
      0,
    );
    facts.bridgeToolErrors = connections.reduce(
      (sum, item) => sum + Number(item.tool_errors ?? 0),
      0,
    );
    facts.bridgeFaults = connections.filter(
      (item) => item.fault !== null,
    ).length;
    report.steps.push({
      step: "bridge_connections",
      connections: connections.map((item) => ({
        target: item.target,
        initialized: item.initialized,
        tool_calls: item.tool_calls,
        tool_errors: item.tool_errors,
        fault: item.fault,
        stdin_eof: item.stdin_eof,
      })),
    });
    check(
      "bridge_connected",
      connections.length >= 1,
      String(connections.length),
    );
    check(
      "bridge_handshake_clean",
      connections.every(
        (item) => item.initialized === true && item.fault === null,
      ),
    );
    if (mode === "thread")
      check(
        "thread_only_no_tool_call",
        connections.every((item) => item.tool_calls === 0),
      );
    if (mode === "stub" || mode === "vendor") {
      check(
        "bridge_tool_call",
        facts.bridgeToolCalls === 1,
        String(facts.bridgeToolCalls),
      );
      check(
        "bridge_no_tool_errors",
        facts.bridgeToolErrors === 0,
        String(facts.bridgeToolErrors),
      );
    }
  }

  // ---- The local stub's request log: never read in any other mode ----
  if (readsMockRequests(mode)) {
    const stub = readMockRequests(mode, values.output);
    if (stub === null) {
      check("stub_requests_present", false, "mock-requests.jsonl missing");
    } else {
      report.evidence_files_read.push("mock-requests.jsonl");
      facts.stubRounds = stub.rounds;
      report.steps.push({
        step: "model_stub_requests",
        rounds: stub.rounds,
        tool_call_rounds: stub.toolCalls,
        final_replies: stub.finalReplies,
      });
      check(
        "stub_tool_call_round",
        stub.toolCalls >= 1,
        String(stub.toolCalls),
      );
      check(
        "stub_saw_platform_result",
        stub.finalReplies.some((reply) => /draft/.test(reply)),
        stub.finalReplies.join(" | "),
      );
    }
  } else {
    report.steps.push({
      step: "model_stub_requests",
      skipped: "no local stub in this mode",
    });
  }
} catch (error) {
  facts.harnessError = error?.message ?? String(error);
  report.error = {
    name: error?.name ?? null,
    message: facts.harnessError,
    stack:
      typeof error?.stack === "string"
        ? error.stack.split("\n").slice(0, 8)
        : null,
  };
} finally {
  // Cleanup runs on every path and reports what it could not finish.
  const record = (name, fn) => {
    try {
      fn();
      cleanup.push({ step: name, ok: true, error: null });
    } catch (error) {
      cleanup.push({
        step: name,
        ok: false,
        error: String(error?.message ?? error),
      });
    }
  };
  const recordAsync = async (name, fn) => {
    try {
      await fn();
      cleanup.push({ step: name, ok: true, error: null });
    } catch (error) {
      cleanup.push({
        step: name,
        ok: false,
        error: String(error?.message ?? error),
      });
    }
  };
  if (handle) {
    record("close_owned_handle", () => handle.close());
    await recordAsync("await_owned_exit", () => handle.closed);
  }
  if (controller)
    await recordAsync("dispose_controller", () => controller.dispose());
  if (server) await recordAsync("close_platform_service", () => server.close());
  if (fixture) record("close_fixture", () => fixture.close());
  if (mock) {
    record("stop_model_stub", () => mock.kill());
    await new Promise((r) => setTimeout(r, 300));
  }
  // Provider credential copy: remove it from the isolated home this attempt
  // created, then prove no file under that root still carries the value.
  const cleanupCredential = () => {
    const result = {
      homes_scanned: 0,
      credential_copies_removed: 0,
      token_hits_before: 0,
      token_hits_after: 0,
      skipped: [],
    };
    if (!values["provider-config"] || !existsSync(values["provider-config"]))
      return result;
    let token = null;
    try {
      token = tomlSectionValue(
        readFileSync(values["provider-config"], "utf8").replace(/^\uFEFF/, ""),
        "model_providers.custom",
        "experimental_bearer_token",
      );
    } catch {
      token = null;
    }
    if (!token || token.length < 8) {
      result.skipped.push(
        "operator token could not be located; nothing scanned",
      );
      return result;
    }
    const dataRoot = operatorConfig.data_root;
    if (!dataRoot || !existsSync(dataRoot)) {
      result.skipped.push("trusted data root unavailable");
      return result;
    }
    const startedAt = Date.parse(report.started_at);
    const scanStart = startedAt - 30000;
    for (const entry of readdirSync(dataRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith("codex-init-"))
        continue;
      const root = join(dataRoot, entry.name);
      const mtime = statSync(root).mtimeMs;
      // Ownership: only roots this attempt created, never an active or unknown one.
      if (mtime < scanStart) continue;
      result.homes_scanned++;
      const configPath = join(root, "home", "config.toml");
      const files = [];
      const walk = (dir) => {
        for (const item of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, item.name);
          if (item.isDirectory()) walk(full);
          else files.push(full);
        }
      };
      walk(root);
      const hits = files.filter((file) => {
        try {
          return readFileSync(file, "utf8").includes(token);
        } catch {
          return false;
        }
      });
      result.token_hits_before += hits.length;
      if (existsSync(configPath)) {
        rmSync(configPath, { force: true });
        result.credential_copies_removed++;
      }
      const after = files
        .filter((file) => existsSync(file))
        .filter((file) => {
          try {
            return readFileSync(file, "utf8").includes(token);
          } catch {
            return false;
          }
        });
      result.token_hits_after += after.length;
    }
    return result;
  };
  try {
    report.credential_cleanup = cleanupCredential();
    cleanup.push({
      step: "provider_credential_cleanup",
      ok: report.credential_cleanup.token_hits_after === 0,
      error: null,
    });
  } catch (error) {
    report.credential_cleanup = { error: String(error?.message ?? error) };
    cleanup.push({
      step: "provider_credential_cleanup",
      ok: false,
      error: String(error?.message ?? error),
    });
  }
  if (bridgeConfig) {
    record("remove_bridge_configuration", () => {
      if (existsSync(bridgeConfig)) rmSync(bridgeConfig, { force: true });
      if (existsSync(bridgeConfig)) throw new Error("still present");
    });
  }
  // Post-check after cleanup, so our own child is not counted as an original.
  try {
    const after = inventory();
    write("process-after.json", after);
    facts.processUnchanged = JSON.stringify(before) === JSON.stringify(after);
    report.process = {
      before: before.length,
      after: after.length,
      unchanged: facts.processUnchanged,
      file: "process-after.json",
    };
  } catch (error) {
    report.process = {
      before: before.length,
      after: null,
      unchanged: false,
      error: String(error?.message ?? error),
    };
    cleanup.push({
      step: "process_after_inventory",
      ok: false,
      error: String(error?.message ?? error),
    });
  }
  facts.cleanupComplete = cleanup.every((item) => item.ok);
  report.cleanup = {
    ok: facts.cleanupComplete,
    steps: cleanup,
    bridge_configuration_removed: cleanup.some(
      (item) => item.step === "remove_bridge_configuration" && item.ok,
    ),
  };
  if (!facts.cleanupComplete && !facts.harnessError)
    facts.harnessError = "cleanup incomplete";
  report.finished_at = new Date().toISOString();
  report.status = acceptanceStatus(facts);
  // A FAILED_* verdict is a level failure even when cleanup was clean.
  report.level_status =
    levelPassed(facts) && !report.status.startsWith("FAILED")
      ? "PASS"
      : "FAILED";
  write("report.json", report);
  process.exitCode = report.level_status === "PASS" ? 0 : 1;
  console.log(
    JSON.stringify(
      {
        status: report.status,
        level_status: report.level_status,
        mode: report.mode,
        checks: report.checks.length,
        failures: report.failures,
        cleanup_ok: facts.cleanupComplete,
        process_unchanged: facts.processUnchanged,
        output: values.output,
      },
      null,
      2,
    ),
  );
}
