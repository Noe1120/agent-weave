import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { adapterFixture } from "./adapter-helpers.ts";
import { id } from "./helpers.ts";
import { AdapterRegistry } from "../dist/packages/service/src/adapter-registry.js";
const output = resolve(
  process.env.ADAPTER_EVIDENCE ?? ".runtime/adapter-walkthrough-" + Date.now(),
);
mkdirSync(output, { recursive: true });
const f = adapterFixture();
const registry = new AdapterRegistry(f.s, f.now);
const steps = [];
try {
  const q = f.request();
  registry.register(f.token, q);
  let view = registry.read(f.token, f.ids.project, f.binding);
  assert.equal(view.capabilities.progress.reason, "UNVERIFIED");
  steps.push({ step: "register", reason: view.capabilities.progress.reason });
  f.observe();
  view = registry.read(f.token, f.ids.project, f.binding);
  assert.equal(view.capabilities.progress.enabled, false);
  assert.equal(view.capabilities.progress.qualification, "UNVERIFIED");
  steps.push({
    step: "synthetic_observation",
    qualification: view.capabilities.progress.qualification,
  });
  const before = f.s.db.prepare("SELECT total_changes() n").get().n;
  for (let i = 0; i < 100; i++)
    registry.read(f.token, f.ids.project, f.binding);
  const readDelta =
    Number(f.s.db.prepare("SELECT total_changes() n").get().n) - Number(before);
  assert.equal(readDelta, 0);
  registry.register(
    f.token,
    f.request({ expected_revision: "1", session_id: "new-synthetic-session" }),
  );
  assert.equal(
    registry.read(f.token, f.ids.project, f.binding).capabilities.progress
      .reason,
    "CONFIG_CHANGED",
  );
  steps.push({ step: "configuration_change", reason: "CONFIG_CHANGED" });
  registry.invalidate(f.token, f.ids.project, f.binding, "2", id());
  registry.register(f.token, q);
  assert.equal(
    registry.read(f.token, f.ids.project, f.binding).state,
    "invalidated",
  );
  steps.push({ step: "invalidate_and_old_retry", state: "invalidated" });
  f.g.state = "revoked";
  f.s.updateGrant(f.g);
  assert.throws(
    () => registry.read(f.token, f.ids.project, f.binding),
    /GRANT_REVOKED/,
  );
  steps.push({ step: "revoke", reason: "GRANT_REVOKED" });
  const report = {
    qualification: "COMPILED_SYNTHETIC_WALKTHROUGH",
    steps,
    read_count: 100,
    read_mutations: readDelta,
    native_clients_started: 0,
    model_calls: 0,
    real_client_qualification: "UNVERIFIED",
  };
  writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2), {
    flag: "wx",
  });
  console.log(JSON.stringify(report, null, 2));
} finally {
  f.close();
}
