// All production modules are compiled JS; no native client or model is used.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store } from "../dist/packages/service/src/store.js";
import { WorkspaceService } from "../dist/packages/service/src/workspace-service.js";
import { CoreService } from "../dist/packages/service/src/service.js";
import { createServer } from "../dist/packages/service/src/http.js";
import { listenLoopback } from "../dist/packages/service/src/loopback-listener.js";

const store = new Store(),
  workspace = new WorkspaceService(store);
const server = createServer(new CoreService(store), workspace);
try {
  await listenLoopback(server);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, body, headers = {}) => {
    const r = await fetch(origin + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { origin, "content-type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, headers: r.headers, body: await r.json() };
  };
  const pair = await call("/v1/console/pair", {
    code: workspace.auth.newPairing().code,
  });
  assert.equal(pair.status, 200);
  const owner = {
    cookie: pair.headers.get("set-cookie").split(";")[0],
    "x-csrf-token": pair.body.data.csrf,
  };
  const command = async (kind, args) =>
    (
      await call(
        "/v1/console/commands",
        { kind, action_id: randomUUID(), ...args },
        owner,
      )
    ).body.data;
  const project = await command("create_project", {
    name: "Connection journey",
    description: "synthetic",
  });
  const member = await command("add_member", {
    project_id: project.id,
    name: "Codex",
    client: "codex",
    role: "review",
  });
  const request = {
    project_id: project.id,
    member_id: member.id,
    action_id: randomUUID(),
    expected_member_revision: "1",
    configuration_fingerprint: "a".repeat(64),
  };
  const invitation = await call(
    "/v1/console/connections/invite",
    request,
    owner,
  );
  assert.equal(invitation.status, 200);
  assert.deepEqual(
    (await call("/v1/console/connections/invite", request, owner)).body,
    invitation.body,
  );
  const id = invitation.body.data.connection_id;
  const redeem = await call(
    "/v1/connections/redeem",
    {
      connection_id: id,
      action_id: randomUUID(),
      configuration_fingerprint: "a".repeat(64),
    },
    { authorization: "Bearer " + invitation.body.data.invitation_token },
  );
  assert.equal(redeem.status, 200);
  const auth = { authorization: "Bearer " + redeem.body.data.connection_token };
  const before = Number(store.db.prepare("SELECT total_changes() n").get().n);
  for (let i = 0; i < 100; i++) {
    const r = await call(`/v1/connections/${id}`, undefined, auth);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.runtime_state, "not_connected");
  }
  const delta =
    Number(store.db.prepare("SELECT total_changes() n").get().n) - before;
  assert.equal(delta, 0);
  const list = await call(
    `/v1/console/projects/${project.id}/connections`,
    undefined,
    owner,
  );
  assert.equal(list.body.data.length, 1);
  assert.ok(!JSON.stringify(list.body).includes("token"));
  assert.equal(
    (
      await call(
        "/v1/console/connections/revoke",
        {
          project_id: project.id,
          connection_id: id,
          action_id: randomUUID(),
          expected_revision: "2",
        },
        owner,
      )
    ).status,
    200,
  );
  assert.equal(
    (await call(`/v1/connections/${id}`, undefined, auth)).status,
    401,
  );
  assert.equal(
    (await call(`/v1/console/projects/${project.id}`, undefined, owner)).body
      .data.progress.connected_members,
    0,
  );
  console.log(
    JSON.stringify(
      {
        qualification: "COMPILED_SYNTHETIC_CONNECTION_JOURNEY",
        steps: [
          "pair",
          "create_project",
          "add_member",
          "invite",
          "retry_same_invite",
          "redeem",
          "100_read_only_queries",
          "list",
          "revoke",
          "old_credential_denied",
        ],
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
  await new Promise((r) => server.close(r));
  store.close();
}
