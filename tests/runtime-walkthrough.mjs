// Compiled HTTP user journey with a repository-owned protocol fixture, not a vendor client.
import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { adapterFixture } from "./adapter-helpers.ts";
import { id } from "./helpers.ts";
import { createServer } from "../dist/packages/service/src/http.js";
import { RuntimeGateway } from "../dist/packages/service/src/runtime-gateway.js";
import { CodexRuntimeController } from "../dist/packages/service/src/codex-runtime.js";
import { CodexAppServer } from "../dist/packages/service/src/codex-app-server.js";

const f = adapterFixture();
f.p.actions.push("runtime_control");
f.g.actions.push("runtime_control");
f.s.putPolicy(f.p);
f.s.updateGrant(f.g);
let launches = 0;
const controller = new CodexRuntimeController(
  f.s,
  {
    fingerprint: "a".repeat(64),
    clientVersion: "fixture-1",
    source: "development_fixture",
    async launch(allowed) {
      assert.equal(allowed(), true);
      launches++;
      return new CodexAppServer(
        spawn(
          process.execPath,
          [resolve("tests/fixtures/codex-app-server-fixture.mjs"), "success"],
          { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
        ),
        {
          requestMs: 5000,
          closeMs: 1500,
          workDirectory: resolve("tests/fixtures"),
        },
      );
    },
  },
  { now: f.now, monitorMs: 0 },
);
const server = createServer(
  f.service,
  undefined,
  new RuntimeGateway(f.s, { codex: controller }, f.now),
);
try {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const call = async (path, body) => {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        authorization: "Bearer " + f.token,
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  const read = () =>
    call(`/v1/projects/${f.ids.project}/runtimes/${f.binding}`);
  const request = {
    project_id: f.ids.project,
    runtime_id: f.binding,
    scope_id: f.ids.scope,
    action_id: id(),
    expected_revision: "0",
    configuration_fingerprint: "a".repeat(64),
  };
  const first = await call("/v1/runtimes/codex/start", request);
  assert.equal(first.status, 200);
  assert.deepEqual(await call("/v1/runtimes/codex/start", request), first);
  assert.equal(launches, 1);
  assert.equal((await read()).data.data.state, "ready");
  const changes = Number(f.s.db.prepare("SELECT total_changes() n").get().n);
  for (let i = 0; i < 100; i++) assert.equal((await read()).status, 200);
  const delta =
    Number(f.s.db.prepare("SELECT total_changes() n").get().n) - changes;
  assert.equal(delta, 0);
  f.g.state = "revoked";
  f.s.updateGrant(f.g);
  assert.equal((await read()).data.code, "GRANT_REVOKED");
  controller.reconcileAuthorization();
  await controller.dispose();
  const record = f.s.getResource(f.binding);
  assert.equal(record.data.state, "closed");
  assert.equal(record.data.exit.exit_observed, true);
  assert.equal(record.data.exit.forced, false);
  console.log(
    JSON.stringify(
      {
        qualification: "COMPILED_SYNTHETIC_HTTP_WALKTHROUGH",
        steps: [
          "start",
          "idempotent_retry",
          "ready",
          "100_read_only_queries",
          "revoke",
          "read_denied",
          "maintenance_close",
          "exit_observed",
        ],
        fixture_launches: launches,
        read_mutations: delta,
        native_clients_started: 0,
        model_calls: 0,
        ui_clicks: 0,
        windows_isolation: "UNVERIFIED",
      },
      null,
      2,
    ),
  );
} finally {
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
  await controller.dispose();
  f.close();
}
