// Real installed Codex app-server acceptance. Explicitly opt-in: never called by
// npm verify, and each level needs its own authorization flag.
//
//   --allow-codex-app-server-initialize  spawn the fixed CLI, one initialize, EOF
//   --allow-codex-new-thread             additionally create one native thread
//   --allow-codex-synthetic-turn         additionally send one synthetic turn
//
// This module never reads the user's CODEX_HOME, credentials, sessions or the
// running desktop app. The turn level needs a credential profile that is not
// implemented here, so an unauthenticated rejection is the expected honest
// outcome until that separate gate is authorized.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { parseArgs } from "node:util";
import { adapterFixture } from "./adapter-helpers.ts";
import { id } from "./helpers.ts";
import { officialCodexLauncher } from "../dist/packages/service/src/codex-app-server.js";
import { CodexRuntimeController } from "../dist/packages/service/src/codex-runtime.js";

const { values } = parseArgs({
  options: {
    "allow-codex-app-server-initialize": { type: "boolean" },
    "allow-codex-new-thread": { type: "boolean" },
    "allow-codex-synthetic-turn": { type: "boolean" },
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
assert.equal(process.platform, "win32");
assert.ok(values.config && isAbsolute(values.config));
assert.ok(values.output && isAbsolute(values.output));
// Exclusive output folder is the attempt latch: reruns cannot repeat a level here.
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
      "@(Get-CimInstance Win32_Process -Filter \"Name = 'ChatGPT.exe' OR Name = 'codex.exe'\" -ErrorAction Stop | Select-Object ProcessId, ParentProcessId, CreationDate, ExecutablePath | Sort-Object ProcessId) | ConvertTo-Json -Compress",
    ],
    { windowsHide: true, encoding: "utf8", timeout: 20000 },
  );
  const value = text.trim() ? JSON.parse(text) : [];
  return Array.isArray(value) ? value : [value];
}
const launcher = officialCodexLauncher(
  JSON.parse(readFileSync(values.config, "utf8").replace(/^\uFEFF/, "")),
);
const before = inventory();
write("process-before.json", before);
const steps = [];
let report;
let handle;
let controller;
let fixture;
try {
  // Level 1: initialization only, straight through the fixed launcher.
  handle = await launcher.launch(() => true);
  const initialize = await handle.ready;
  steps.push({
    step: "initialize",
    state: handle.status.state,
    protocol_version: initialize.protocol_version,
    user_agent: initialize.user_agent,
    declared: initialize.declared,
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
  if (values["allow-codex-new-thread"]) {
    fixture = adapterFixture();
    fixture.g.expires_at = new Date(Date.now() + 600000).toISOString();
    fixture.s.updateGrant(fixture.g);
    controller = new CodexRuntimeController(fixture.s, launcher);
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
      const deadline = Date.now() + 120000;
      view = controller.read(
        fixture.token,
        fixture.ids.project,
        fixture.binding,
      );
      while (
        view.turn &&
        ["requested"].includes(view.turn.state) &&
        Date.now() < deadline
      ) {
        await new Promise((r) => setTimeout(r, 250));
        view = controller.read(
          fixture.token,
          fixture.ids.project,
          fixture.binding,
        );
      }
      turnState = view.turn?.state ?? "none";
      steps.push({
        step: "synthetic_turn",
        state: view.state,
        turn: view.turn,
        fault: view.fault,
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
  }
  const after = inventory();
  write("process-after.json", after);
  const unchanged = JSON.stringify(before) === JSON.stringify(after);
  report = {
    status: threadDigest
      ? "REAL_CODEX_APP_SERVER_LIFECYCLE_PASS"
      : "REAL_CODEX_APP_SERVER_INITIALIZE_PASS",
    observed_at: new Date().toISOString(),
    platform_state: "synthetic isolated in-memory fixture; empty CODEX_HOME",
    client_version: launcher.clientVersion,
    configuration_fingerprint: launcher.fingerprint,
    thread_created: Boolean(threadDigest),
    native_thread_sha256: threadDigest,
    synthetic_turn_state: turnState,
    steps,
    user_configuration_used: false,
    credentials_supplied: false,
    user_sessions_read: false,
    existing_client_attached: false,
    original_client_processes: {
      before: before.length,
      after: after.length,
      unchanged,
    },
    model_requests: values["allow-codex-synthetic-turn"]
      ? "requested; outcome in steps"
      : 0,
    client_qualification: "UNVERIFIED",
    windows_isolation: "UNVERIFIED",
  };
  assert.equal(unchanged, true, "Original client processes changed");
} catch (error) {
  const after = (() => {
    try {
      return inventory();
    } catch {
      return null;
    }
  })();
  report = {
    status: "FAIL",
    steps,
    error: { name: error?.name, message: error?.message },
    original_client_processes: after
      ? { before: before.length, after: after.length }
      : null,
  };
  process.exitCode = 1;
} finally {
  handle?.close();
  if (controller) await controller.dispose();
  fixture?.close();
}
write("report.json", report);
console.log(JSON.stringify(report, null, 2));
function clone(value) {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}
