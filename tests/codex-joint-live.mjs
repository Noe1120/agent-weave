// W20 opt-in, one owned instance/one turn. No production database or old history.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { adapterFixture } from "./adapter-helpers.ts";
import {
  taskRelay,
  cleanCredentials,
  jointVerdict,
  operatorJson,
} from "./codex-joint-support.mjs";
import {
  CodexAppServer,
  officialCodexLauncher,
  tomlSectionValue,
} from "../dist/packages/service/src/codex-app-server.js";
import { CodexRuntimeController } from "../dist/packages/service/src/codex-runtime.js";
import { CoreService } from "../dist/packages/service/src/service.js";
import { WorkspaceService } from "../dist/packages/service/src/workspace-service.js";
import { ConnectionTaskAccess } from "../dist/packages/service/src/connection-task-access.js";
import { createServer } from "../dist/packages/service/src/http.js";
import { listenLoopback } from "../dist/packages/service/src/loopback-listener.js";
import { McpSession } from "../dist/packages/service/src/mcp-session.js";
import { McpReadClient } from "../dist/packages/service/src/mcp-read-client.js";
import { createOwnedBridgeFactory } from "../dist/packages/service/src/owned-bridge.js";
import { relayJointComposition } from "./codex-relay-joint-support.mjs";
import { officialCodexRelayLauncher } from "../dist/packages/service/src/codex-relay-launcher.js";

const { values } = parseArgs({
  options: {
    fixture: { type: "boolean" },
    relay: { type: "boolean" },
    "trusted-new-pin": { type: "boolean" },
    "allow-once-vendor": { type: "boolean" },
    output: { type: "string" },
    config: { type: "string" },
    "provider-config": { type: "string" },
  },
  strict: true,
});
const synthetic = values.fixture === true;
const relayMode = values.relay === true;
const trusted = values["trusted-new-pin"] === true;
if (trusted) {
  assert.ok(!synthetic && !relayMode && !values.config);
  assert.equal(
    resolve(values.output),
    resolve(import.meta.dirname, "../.runtime/w33/vendor-once"),
  );
  assert.equal(
    resolve(values["provider-config"]),
    resolve(process.env.USERPROFILE, ".codex/config.toml"),
  );
}
assert.ok(
  synthetic !== (values["allow-once-vendor"] === true),
  "Choose fixture OR explicitly authorized vendor",
);
assert.ok(
  values.output && isAbsolute(values.output),
  "absolute new output required",
);
if (!synthetic) {
  assert.ok(trusted || (values.config && isAbsolute(values.config)));
  assert.ok(values["provider-config"] && isAbsolute(values["provider-config"]));
}
const root = resolve(values.output);
assert.ok(!existsSync(root), "Output exists: refusing reuse");
mkdirSync(root);
const report = {
  stage: trusted ? "W33" : relayMode ? "W25" : "W20",
  mode: synthetic ? "SYNTHETIC_ONLY" : "REAL_VENDOR",
  started_at: new Date().toISOString(),
  checks: [],
  facts: {},
  cost: "UNKNOWN",
  soft_token_threshold: 30000,
  limit_is_hard: false,
};
const check = (name, passed) =>
  report.checks.push({ name, passed: passed === true });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inventory = () =>
  JSON.parse(
    execFileSync(
      "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "@(Get-CimInstance Win32_Process -Filter \"Name = 'ChatGPT.exe' OR Name = 'codex.exe'\" | Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath | Sort-Object ProcessId) | ConvertTo-Json -Compress",
      ],
      { encoding: "utf8", windowsHide: true },
    ).trim() || "[]",
  );
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (condition, timeout = 25000) => {
  const deadline = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("JOINT_TIMEOUT");
    await wait(100);
  }
};
let controller,
  relay,
  server,
  fixture,
  before,
  sourceHash,
  secret = "",
  bridgeConfig,
  bridge,
  processStarted = false;
let fixtureSession;
let prepared, composition, relaySecret;
const entryToken = randomBytes(32).toString("base64url");
try {
  before = synthetic ? [] : inventory();
  let operator;
  if (!synthetic) {
    // Read the source digest before profile parsing so preflight failures do not
    // falsely assert that an unmeasured source was modified.
    sourceHash = hash(readFileSync(values["provider-config"]));
    if (trusted) {
      operator = {
        installation_root: join(
          process.env.LOCALAPPDATA,
          "OpenAI/Codex/bin/c38161ad8494f88c",
        ),
        client_version: "0.169.0-alpha.11.1",
        executable_sha256:
          "094d4db493de22025712cc5963854e7654b7c97f4cee795e3e986270a0f4f6b4",
      };
    } else {
      operator = operatorJson(readFileSync(values.config, "utf8"));
      assert.equal(operator.client_version, "0.167.0-alpha.3.2");
      assert.equal(
        operator.executable_sha256,
        "4b3286e35d7fe866c6b0eb3f07d7a4cdb5e96489576170dfd6b3a15aa1c67382",
      );
    }
    const text = readFileSync(values["provider-config"], "utf8");
    sourceHash = hash(Buffer.from(text));
    assert.equal(tomlSectionValue(text, null, "model_provider"), "custom");
    assert.equal(tomlSectionValue(text, null, "model"), "gpt-6.1-sol");
    assert.equal(
      tomlSectionValue(text, "model_providers.custom", "base_url"),
      "http://127.0.0.1:15721/v1",
    );
    secret = tomlSectionValue(
      text,
      "model_providers.custom",
      "experimental_bearer_token",
    );
    assert.ok(secret);
    report.facts.source_config_sha256 = sourceHash;
    report.facts.executable_sha256 = operator.executable_sha256;
  }
  fixture = adapterFixture();
  const f = fixture,
    s = f.s,
    now = Date.now;
  f.g.expires_at = new Date(now() + 900000).toISOString();
  s.updateGrant(f.g);
  const workspace = new WorkspaceService(s, now),
    core = new CoreService(s, now);
  s.db
    .prepare("INSERT INTO workspace_projects VALUES(?,?,?,?,?,?)")
    .run(
      f.ids.project,
      "W20 synthetic",
      "",
      randomUUID(),
      "1",
      new Date().toISOString(),
    );
  s.db
    .prepare("INSERT INTO workspace_members VALUES(?,?,?,?,?,?,?,?)")
    .run(
      f.ids.member,
      f.ids.project,
      "codex",
      "Codex",
      "read",
      "active",
      "1",
      new Date().toISOString(),
    );
  server = createServer(core, workspace);
  await listenLoopback(server);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, body, headers = {}) => {
    const response = await fetch(origin + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { origin, "content-type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    return {
      status: response.status,
      headers: response.headers,
      body: await response.json(),
    };
  };
  const pair = await call("/v1/console/pair", {
    code: workspace.auth.newPairing().code,
  });
  assert.equal(pair.status, 200);
  const owner = {
    cookie: pair.headers.get("set-cookie").split(";")[0],
    "x-csrf-token": pair.body.data.csrf,
  };
  const taskPath = `/v1/projects/${f.ids.project}/task/${f.ids.task}`;
  relay = await taskRelay({
    path: taskPath,
    entryToken,
    read: (token) =>
      call(taskPath, undefined, { authorization: "Bearer " + token }),
  });
  const dataRoot = join(root, "client-data"),
    reportDir = join(root, "bridge-reports");
  mkdirSync(dataRoot);
  mkdirSync(reportDir);
  bridgeConfig = join(root, "bridge-config.json");
  bridge = {
    version: 1,
    target: "codex",
    service_origin: relay.origin,
    project_id: f.ids.project,
    token: entryToken,
    task_ids: [f.ids.task],
    execution_ids: [],
    allow_message_poll: false,
    egress: {
      data_class: "synthetic_only",
      provider_fingerprint: "a".repeat(64),
      expires_at: new Date(now() + 300000).toISOString(),
    },
  };
  if (relayMode) {
    prepared = await createOwnedBridgeFactory({
      dataRoot: reportDir,
      config: bridge,
    }).prepareClient(() => true);
    relaySecret = JSON.parse(prepared.launch.env.TEAM_RELAY).token;
  } else if (!trusted)
    writeFileSync(bridgeConfig, JSON.stringify(bridge), { flag: "wx" });
  const vendorProfile = !synthetic && {
    ...operator,
    data_root: dataRoot,
    provider_reuse: {
      source_config: values["provider-config"],
      provider_id: "custom",
      model: "gpt-6.1-sol",
    },
    code_mode: { direct_only_tool_namespaces: ["mcp__agent_weave_probe"] },
  };
  const baseLauncher = synthetic
    ? {
        fingerprint: "a".repeat(64),
        clientVersion: "fixture-1",
        source: "development_fixture",
        async launch(allowed) {
          assert.ok(allowed());
          return new CodexAppServer(
            spawn(
              process.execPath,
              [
                resolve("tests/fixtures/codex-app-server-fixture.mjs"),
                "success",
              ],
              { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
            ),
            { workDirectory: dataRoot },
          );
        },
      }
    : trusted
      ? officialCodexRelayLauncher(vendorProfile, {
          dataRoot: reportDir,
          config: bridge,
        })
      : officialCodexLauncher({
          ...vendorProfile,
          ...(relayMode
            ? { relay_binding: JSON.parse(prepared.launch.env.TEAM_RELAY) }
            : { bridge: { config_path: bridgeConfig, report_dir: reportDir } }),
        });
  if (relayMode)
    composition = relayJointComposition(prepared, baseLauncher, {
      root,
      bridgeData: reportDir,
      synthetic,
    });
  const launcher = composition?.launcher ?? baseLauncher;
  report.facts.configuration_fingerprint = launcher.fingerprint;
  const invite = await call(
    "/v1/console/connections/invite",
    {
      project_id: f.ids.project,
      member_id: f.ids.member,
      action_id: randomUUID(),
      expected_member_revision: "1",
      configuration_fingerprint: launcher.fingerprint,
    },
    owner,
  );
  assert.equal(invite.status, 200);
  const connectionId = invite.body.data.connection_id;
  const redeem = await call(
    "/v1/connections/redeem",
    {
      connection_id: connectionId,
      action_id: randomUUID(),
      configuration_fingerprint: launcher.fingerprint,
    },
    { authorization: "Bearer " + invite.body.data.invitation_token },
  );
  assert.equal(redeem.status, 200);
  assert.equal(
    (
      await fetch(relay.origin + taskPath, {
        headers: { authorization: "Bearer " + entryToken },
      })
    ).status,
    404,
  );
  controller = new CodexRuntimeController(s, launcher, {
    now,
    monitorMs: 250,
    turnMs: 150000,
  });
  // Claim the single launch only after all non-launch setup passes. Failed
  // preflight does not consume a model turn; any start attempt remains exclusive.
  if (!synthetic)
    writeFileSync(
      resolve(
        trusted
          ? join(root, "../authorization-used.json")
          : relayMode
            ? ".runtime/w25/authorization-used.json"
            : ".runtime/w20/authorization-used.json",
      ),
      JSON.stringify({
        stage: report.stage,
        at: new Date().toISOString(),
        max_instances: 1,
        max_turns: 1,
        soft_tokens: 30000,
        cost: "UNKNOWN",
      }),
      { flag: "wx" },
    );
  processStarted = true;
  await controller.start(f.token, {
    project_id: f.ids.project,
    runtime_id: f.binding,
    scope_id: f.ids.scope,
    action_id: randomUUID(),
    expected_revision: "0",
    configuration_fingerprint: launcher.fingerprint,
  });
  const view = () => controller.read(f.token, f.ids.project, f.binding);
  assert.equal(view().state, "ready");
  assert.ok(view().native_thread_sha256);
  if (trusted) {
    const homes = readdirSync(dataRoot);
    assert.equal(homes.length, 1);
    const config = readFileSync(
      join(dataRoot, homes[0], "home/config.toml"),
      "utf8",
    );
    relaySecret = JSON.parse(
      tomlSectionValue(
        config,
        "mcp_servers.agent-weave-probe.env",
        "TEAM_RELAY",
      ),
    ).token;
    assert.match(relaySecret, /^[a-f0-9]{64}$/);
    assert.ok(
      config.includes("request_max_retries = 0") &&
        config.includes("stream_max_retries = 0"),
    );
  }
  check("native", true);
  const permit = {
    connection_id: connectionId,
    task_id: f.ids.task,
    configuration_fingerprint: launcher.fingerprint,
    expires_at: new Date(now() + 300000).toISOString(),
    data_class: "synthetic_only",
    max_turns: 1,
  };
  const manager = new ConnectionTaskAccess(
    workspace,
    controller.connectionObserver(
      f.token,
      f.ids.project,
      f.binding,
      connectionId,
      permit,
    ),
  );
  const grant = {
    ...f.g,
    id: randomUUID(),
    actions: ["read_resource"],
    resource_ids: [f.ids.task, f.ids.acceptance],
    expires_at: permit.expires_at,
  };
  for (const id of grant.resource_ids) {
    const resource = s.getResource(id);
    resource.acl.push(grant.id);
    s.putResource(resource);
  }
  const access = manager.issue(
    redeem.body.data.connection_token,
    connectionId,
    grant,
    f.ids.task,
  );
  relay.activate(access.token);
  const taskBefore = s.getResource(f.ids.task),
    runBefore = s.getRun(f.ids.run);
  const writes = s.db.prepare("SELECT total_changes() n").get().n;
  for (let i = 0; i < 1000; i++) view();
  assert.equal(s.db.prepare("SELECT total_changes() n").get().n, writes);
  const relayWrites = [];
  // Capture mutations around each actual service read separately from runtime events.
  const readResource = core.readResource.bind(core);
  core.readResource = (...args) => {
    const start = s.db.prepare("SELECT total_changes() n").get().n;
    try {
      return readResource(...args);
    } finally {
      relayWrites.push(
        Number(s.db.prepare("SELECT total_changes() n").get().n - start),
      );
    }
  };
  if (synthetic && relayMode) {
    const result = await composition.rpc("tools/call", {
      name: "task_get",
      arguments: { task_id: f.ids.task },
    });
    assert.equal(result.result.isError, false);
    assert.equal(
      JSON.parse(result.result.content[0].text).data.status,
      "draft",
    );
  } else if (synthetic) {
    // Rehearsal explicitly calls the real MCP session; no claim of model selection.
    fixtureSession = new McpSession(new McpReadClient(bridge));
    await fixtureSession.receive({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "w20-fixture", version: "1" },
      },
    });
    await fixtureSession.receive({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    const result = await fixtureSession.receive({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "task_get", arguments: { task_id: f.ids.task } },
    });
    assert.equal(result.result.isError, false);
    assert.equal(
      JSON.parse(result.result.content[0].text).data.status,
      "draft",
    );
  }
  writeFileSync(
    join(root, "turn-attempt.json"),
    JSON.stringify({ at: new Date().toISOString(), turns: 1 }),
    { flag: "wx" },
  );
  await controller.turn(f.token, {
    project_id: f.ids.project,
    runtime_id: f.binding,
    action_id: randomUUID(),
    expected_revision: view().revision,
    instruction_profile: "synthetic_task_get/1",
    task_id: f.ids.task,
  });
  let interrupted = false;
  const deadline = now() + 155000;
  while (view().turn?.state === "requested") {
    if (!interrupted && (view().token_usage?.total ?? 0) >= 30000) {
      interrupted = true;
      await controller.interrupt(f.token, {
        project_id: f.ids.project,
        runtime_id: f.binding,
        action_id: randomUUID(),
        expected_revision: view().revision,
      });
    }
    if (now() > deadline) throw new Error("TURN_DEADLINE");
    await wait(100);
  }
  const finalView = view();
  report.facts.task_id = f.ids.task;
  report.facts.task_status = taskBefore.data.status;
  report.facts.turn = finalView.turn;
  report.facts.token_usage = finalView.token_usage;
  report.facts.threshold_interrupted = interrupted;
  // Publish only fixed synthetic task/status match, not unbounded model text.
  report.facts.native_reply_matches =
    !!finalView.last_agent_message?.includes(f.ids.task) &&
    /\bdraft\b/.test(finalView.last_agent_message);
  report.facts.task_reads = relay.reads;
  check(
    "turn",
    finalView.turn?.state === "completed" &&
      finalView.turn?.generation === 1 &&
      (synthetic || (finalView.token_usage?.total ?? 0) > 0),
  );
  check(
    "task",
    relay.reads === 1 && (synthetic || report.facts.native_reply_matches),
  );
  assert.deepEqual(s.getResource(f.ids.task), taskBefore);
  assert.deepEqual(s.getRun(f.ids.run), runBefore);
  check(
    "read_only",
    relayWrites.length === 1 && relayWrites.every((n) => n === 0),
  );
  const revoke = await call(
    "/v1/console/connections/revoke",
    {
      project_id: f.ids.project,
      connection_id: connectionId,
      action_id: randomUUID(),
      expected_revision: "2",
    },
    owner,
  );
  assert.equal(revoke.status, 200);
  const denied = await call(taskPath, undefined, {
    authorization: "Bearer " + access.token,
  });
  const relayDenied = await fetch(relay.origin + taskPath, {
    headers: { authorization: "Bearer " + entryToken },
  });
  check(
    "revoke",
    denied.status === 404 &&
      relayDenied.status === 404 &&
      (!trusted ||
        (denied.body.code === "NOT_FOUND_OR_DENIED" &&
          (await relayDenied.json()).code === "NOT_FOUND_OR_DENIED")),
  );
  if (composition) await composition.arm();
  s.updateGrant({ ...f.g, state: "revoked" });
  assert.throws(view, /GRANT_REVOKED/);
  controller.reconcileAuthorization();
  await until(() => s.getResource(f.binding)?.data.state === "closed");
  const end = s.getResource(f.binding).data.exit;
  report.facts.exit = {
    code: end?.code,
    signal: end?.signal,
    exit_observed: end?.exit_observed,
    forced: end?.forced,
    fault: end?.fault,
  };
  check(
    "exit",
    end?.code === 0 &&
      end?.exit_observed === true &&
      end?.forced === false &&
      (!trusted || end.fault === null),
  );
  if (composition) report.facts.relay_lifecycle = composition.facts;
  const reports = composition
    ? composition.reports()
    : synthetic
      ? [fixtureSession.stats]
      : readdirSync(reportDir).map((name) =>
          JSON.parse(
            readFileSync(join(reportDir, name, "report.json"), "utf8"),
          ),
        );
  report.facts.bridge = reports.map((r) => ({
    initialized: r.initialized,
    tool_calls: r.tool_calls,
    tool_errors: r.tool_errors,
    fault: r.fault ?? null,
    stdin_eof: r.stdin_eof ?? null,
  }));
  check(
    "bridge",
    reports.length > 0 &&
      reports.every(
        (r) =>
          r.initialized &&
          !r.fault &&
          r.tool_errors === 0 &&
          ((!relayMode && synthetic) || r.stdin_eof === true),
      ) &&
      reports.reduce((n, r) => n + r.tool_calls, 0) === 1,
  );
  if (composition)
    check(
      "relay_exit",
      composition.facts.snapshot?.state === "closed" &&
        composition.facts.relay_os_exit?.exit_code === 0 &&
        Date.parse(composition.facts.relay_os_exit.observed_at) <=
          Date.parse(composition.facts.host_close_requested_at),
    );
} catch (error) {
  // Error messages/stack from local files or a provider may contain private data.
  report.error = {
    name: error?.name ?? "Error",
    code: /^[A-Z_]+$/.test(error?.code ?? "")
      ? error.code
      : "JOINT_ASSERTION_OR_IO",
    message_sha256: hash(String(error?.message ?? error)),
  };
  check("execution", false);
  if (synthetic) console.error(error);
} finally {
  try {
    await controller?.dispose();
  } catch {
    check("dispose", false);
  }
  try {
    if (composition) await composition.cleanup();
    else await prepared?.abort();
  } catch {
    check("relay_cleanup", false);
  }
  try {
    await relay?.close();
  } catch {
    check("relay_close", false);
  }
  if (server) {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  // Only clean after owned process exit is known; no blind delete while it is alive.
  try {
    const exit = fixture?.s.getResource(fixture.binding)?.data.exit;
    assert.ok(
      !processStarted || exit?.exit_observed === true,
      "OWNED_EXIT_NOT_CONFIRMED",
    );
    const files = [];
    if (bridgeConfig && existsSync(bridgeConfig)) files.push(bridgeConfig);
    const dataRoot = join(root, "client-data");
    if (existsSync(dataRoot))
      for (const name of readdirSync(dataRoot)) {
        if (!/^codex-init-/.test(name))
          throw new Error("UNEXPECTED_DATA_ROOT_ENTRY");
        const config = join(dataRoot, name, "home", "config.toml");
        if (existsSync(config)) files.push(config);
      }
    report.facts.cleanup = cleanCredentials(root, files, [
      secret,
      entryToken,
      relaySecret,
    ]);
    if (trusted)
      check(
        "production_config_cleanup",
        !!relaySecret &&
          files.length === 0 &&
          readdirSync(join(root, "bridge-reports")).every(
            (name) =>
              !existsSync(join(root, "bridge-reports", name, "bridge.json")),
          ),
      );
    check("cleanup", report.facts.cleanup.residual_files === 0);
  } catch (error) {
    report.facts.cleanup_error_sha256 = hash(String(error));
    check("cleanup", false);
  }
  try {
    const after = synthetic ? [] : inventory();
    report.facts.original_process_count = before?.length ?? null;
    report.facts.original_processes_unchanged =
      JSON.stringify(before) === JSON.stringify(after);
    report.facts.source_config_unchanged =
      synthetic || sourceHash === hash(readFileSync(values["provider-config"]));
    check(
      "preserved",
      report.facts.original_processes_unchanged &&
        report.facts.source_config_unchanged,
    );
  } catch {
    check("preserved", false);
  }
  fixture?.close();
  report.facts.controller_start_attempted = processStarted;
  const verdict = jointVerdict(report.checks);
  report.status =
    synthetic && verdict === "PASSED_FIXED_CONFIG"
      ? "SYNTHETIC_REHEARSAL_PASS"
      : verdict;
  report.finished_at = new Date().toISOString();
  writeFileSync(
    join(root, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx" },
  );
  console.log(JSON.stringify(report, null, 2));
  if (verdict !== "PASSED_FIXED_CONFIG") process.exitCode = 1;
}
