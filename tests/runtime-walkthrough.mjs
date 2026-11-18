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
import { WorkspaceService } from "../dist/packages/service/src/workspace-service.js";

const f = adapterFixture();
f.p.actions.push("runtime_control");
f.g.actions.push("runtime_control");
f.s.putPolicy(f.p);
f.s.updateGrant(f.g);
let launches = 0;
const guarded = process.argv[2] === "--owner-task";
const w = new WorkspaceService(f.s, f.now),
  route = "http://127.0.0.1:15721/v1",
  model = "offline-fixture";
const controller = new CodexRuntimeController(
  f.s,
  {
    fingerprint: "a".repeat(64),
    clientVersion: "fixture-1",
    // Exercise the official-source admission branch with a repository-owned Node child only.
    source: guarded ? "official_codex" : "development_fixture",
    ...(guarded
      ? {
          taskProfile: {
            project_id: f.ids.project,
            task_id: f.ids.task,
            route,
            model,
          },
        }
      : {}),
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
  w,
  new RuntimeGateway(f.s, { codex: controller }, f.now),
);
try {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const call = async (
    path,
    body,
    auth = { authorization: "Bearer " + f.token },
  ) => {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        ...auth,
        origin: `http://127.0.0.1:${address.port}`,
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
  let receipt;
  if (guarded) {
    f.s.db
      .prepare("INSERT INTO workspace_projects VALUES(?,?,?,?,?,?)")
      .run(
        f.ids.project,
        "fixture",
        "",
        id(),
        "1",
        new Date(f.now()).toISOString(),
      );
    f.s.db
      .prepare("INSERT INTO workspace_members VALUES(?,?,?,?,?,?,?,?)")
      .run(
        f.ids.member,
        f.ids.project,
        "codex",
        "Codex",
        "read",
        "active",
        "1",
        new Date(f.now()).toISOString(),
      );
    const session = w.auth.pair(w.auth.newPairing().code),
      owner = {
        cookie: `team_owner=${session.token}`,
        "x-csrf-token": session.csrf,
      };
    const invite = await call(
      "/v1/console/connections/invite",
      {
        project_id: f.ids.project,
        member_id: f.ids.member,
        action_id: id(),
        expected_member_revision: "1",
        configuration_fingerprint: request.configuration_fingerprint,
      },
      owner,
    );
    assert.equal(invite.status, 200);
    const { connection_id, invitation_token } = invite.data.data;
    assert.equal(
      (
        await call(
          "/v1/connections/redeem",
          {
            connection_id,
            action_id: id(),
            configuration_fingerprint: request.configuration_fingerprint,
          },
          { authorization: "Bearer " + invitation_token },
        )
      ).status,
      200,
    );
    assert.equal((await call("/v1/runtimes/codex/start", request)).status, 404);
    assert.equal(launches, 0);
    const approval = await call(
      "/v1/console/task-authorizations/approve",
      {
        project_id: f.ids.project,
        runtime_id: f.binding,
        task_id: f.ids.task,
        connection_id,
        target: "codex",
        configuration_fingerprint: request.configuration_fingerprint,
        route,
        model,
        soft_tokens: 1000,
        expires_at: new Date(f.now() + 60000).toISOString(),
      },
      owner,
    );
    assert.equal(approval.status, 200);
    receipt = () =>
      call(
        `/v1/console/projects/${f.ids.project}/task-authorizations/${f.binding}`,
        undefined,
        owner,
      );
  }
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
  if (guarded) {
    const turn = {
      project_id: f.ids.project,
      runtime_id: f.binding,
      task_id: f.ids.task,
      expected_revision: (await read()).data.data.revision,
      action_id: id(),
      instruction_profile: "synthetic_task_get/1",
    };
    assert.equal(
      (await call("/v1/runtimes/codex/approved-turn", turn)).status,
      200,
    );
    const end = Date.now() + 6000;
    while ((await receipt()).data.data.execution?.state !== "closed") {
      assert.ok(Date.now() < end, "owner exit receipt deadline");
      await new Promise((r) => setTimeout(r, 10));
    }
    const final = (await receipt()).data.data;
    assert.equal(final.state, "consumed");
    assert.equal(final.execution.turn_state, "completed");
    assert.equal(final.execution.tokens, 120);
    assert.equal(final.execution.exit_observed, true);
    assert.equal(
      (
        await call("/v1/runtimes/codex/approved-turn", {
          ...turn,
          action_id: id(),
        })
      ).status,
      404,
    );
  }
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
        owner_single_task: guarded,
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
