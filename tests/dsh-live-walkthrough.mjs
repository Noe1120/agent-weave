// Explicitly authorized real DSH initialize-only acceptance. Never included in npm verify.
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { parseArgs } from "node:util";
import { adapterFixture } from "./adapter-helpers.ts";
import { id } from "./helpers.ts";
import { officialDshLauncher } from "../dist/packages/service/src/dsh-acp.js";
import { DshRuntimeController } from "../dist/packages/service/src/dsh-runtime.js";
const { values } = parseArgs({
  options: {
    "allow-dsh-initialize": { type: "boolean" },
    config: { type: "string" },
    output: { type: "string" },
  },
  strict: true,
});
assert.equal(
  values["allow-dsh-initialize"],
  true,
  "Real client launch requires explicit initialize-only authorization",
);
assert.ok(values.config && isAbsolute(values.config));
assert.ok(values.output && isAbsolute(values.output));
const launcher = officialDshLauncher(
  JSON.parse(readFileSync(values.config, "utf8").replace(/^\uFEFF/, "")),
);
mkdirSync(values.output);
const f = adapterFixture();
f.g.expires_at = new Date(Date.now() + 60000).toISOString();
f.s.updateGrant(f.g);
const controller = new DshRuntimeController(f.s, launcher);
const steps = [];
let report;
try {
  const request = {
    project_id: f.ids.project,
    runtime_id: f.binding,
    scope_id: f.ids.scope,
    action_id: id(),
    expected_revision: "0",
    configuration_fingerprint: launcher.fingerprint,
  };
  const receipt = await controller.start(f.token, request);
  let view = controller.read(f.token, f.ids.project, f.binding);
  assert.equal(view.state, "ready");
  assert.equal(view.observation_source, "official_dsh");
  assert.equal(view.session_id, null);
  assert.equal(view.qualification, "UNVERIFIED");
  assert.ok(Object.values(view.capabilities).every((c) => !c.enabled));
  steps.push({
    step: "initialize",
    state: view.state,
    protocol: view.protocol_version,
    bridge_version: view.bridge_version,
    advertised: view.advertised,
  });
  const before = f.s.db.prepare("SELECT total_changes() n").get().n;
  for (let i = 0; i < 1000; i++)
    controller.read(f.token, f.ids.project, f.binding);
  assert.equal(f.s.db.prepare("SELECT total_changes() n").get().n, before);
  steps.push({ step: "read_progress", reads: 1000, database_writes: 0 });
  assert.deepEqual(await controller.start(f.token, request), receipt);
  view = controller.read(f.token, f.ids.project, f.binding);
  await controller.close(f.token, {
    project_id: f.ids.project,
    runtime_id: f.binding,
    action_id: id(),
    expected_revision: view.revision,
  });
  view = controller.read(f.token, f.ids.project, f.binding);
  assert.equal(view.state, "closed");
  assert.equal(view.exit.code, 0);
  assert.equal(view.exit.forced, false);
  assert.equal(view.exit.exit_observed, true);
  assert.equal(view.exit.initialize_requests, 1);
  assert.equal(view.exit.initialize_responses, 1);
  steps.push({ step: "close", state: view.state, exit: view.exit });
  assert.deepEqual(await controller.start(f.token, request), receipt);
  assert.equal(
    controller.read(f.token, f.ids.project, f.binding).state,
    "closed",
  );
  steps.push({ step: "old_start_retry", state: "closed", restarted: false });
  f.g.state = "revoked";
  f.s.updateGrant(f.g);
  assert.throws(
    () => controller.read(f.token, f.ids.project, f.binding),
    /GRANT_REVOKED/,
  );
  steps.push({ step: "revoke", read: "denied" });
  report = {
    status: "REAL_DSH_INITIALIZE_LIFECYCLE_PASS",
    observed_at: new Date().toISOString(),
    platform_state: "synthetic isolated in-memory fixture",
    client_version: launcher.clientVersion,
    configuration_fingerprint: launcher.fingerprint,
    steps,
    model_requests: 0,
    sessions_created: 0,
    existing_desktop_attached: false,
    client_qualification: "UNVERIFIED",
    windows_isolation: "UNVERIFIED",
    coordinator_implemented: false,
  };
} catch (error) {
  report = {
    status: "FAIL",
    steps,
    error: { name: error.name, message: error.message },
  };
  process.exitCode = 1;
} finally {
  await controller.dispose();
  f.close();
}
writeFileSync(
  join(values.output, "report.json"),
  JSON.stringify(report, null, 2) + "\n",
  { flag: "wx" },
);
console.log(JSON.stringify(report, null, 2));
