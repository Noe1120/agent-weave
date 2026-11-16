// All production modules are compiled JS; no native client or model is used.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ConnectionTaskAccess } from "../dist/packages/service/src/connection-task-access.js";
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
  // Explicit synthetic trusted provisioning; no owner HTTP grant minting exists.
  const task = randomUUID(),
    acceptance = randomUUID(),
    run = randomUUID(),
    policy = randomUUID();
  const grant = {
    id: randomUUID(),
    project_id: project.id,
    member_id: member.id,
    policy_id: policy,
    policy_revision: "1",
    run_id: run,
    run_epoch: "1",
    native_binding: "synthetic/native/session",
    domain: "synthetic-task",
    actions: ["read_resource"],
    resource_ids: [task, acceptance],
    state: "active",
    expires_at: new Date(Date.now() + 300000).toISOString(),
  };
  store.putPolicy({
    id: policy,
    project_id: project.id,
    member_id: member.id,
    revision: "1",
    active: true,
    actions: ["read_resource"],
    resource_ids: [task, acceptance],
  });
  store.putRun({
    id: run,
    project_id: project.id,
    epoch: "1",
    native_binding: grant.native_binding,
    state: "active",
  });
  for (const r of [
    {
      id: acceptance,
      kind: "acceptance",
      dependencies: [],
      data: { state: "confirmed", criteria_refs: [] },
    },
    {
      id: task,
      kind: "task",
      dependencies: [acceptance],
      data: {
        status: "draft",
        candidate_ref: null,
        inputs_valid: true,
        acceptance_ref: { id: acceptance, revision: "1" },
      },
    },
  ])
    store.putResource({
      ...r,
      project_id: project.id,
      revision: "1",
      domain: grant.domain,
      acl: [grant.id],
    });
  const observation = {
    connection_id: id,
    project_id: project.id,
    member_id: member.id,
    target: "codex",
    configuration_fingerprint: "a".repeat(64),
    run_id: run,
    run_epoch: "1",
    native_binding: grant.native_binding,
    mode: "owned_process",
    data_class: "synthetic_only",
    state: "active",
    observed_at: Date.now(),
  };
  const manager = new ConnectionTaskAccess(workspace, () => observation);
  const access = manager.issue(
    redeem.body.data.connection_token,
    id,
    grant,
    task,
  );
  const taskAuth = { authorization: "Bearer " + access.token };
  const taskPath = `/v1/projects/${project.id}/task/${task}`;
  assert.equal((await call(taskPath, undefined, auth)).status, 401);
  assert.equal(
    (await call("/v1/connections/issue", { ...observation }, auth)).status,
    404,
  );
  assert.equal(
    (
      await call(
        "/v1/runtimes/codex/start",
        { project_id: project.id, runtime_id: randomUUID() },
        taskAuth,
      )
    ).status,
    404,
  );
  const before = Number(store.db.prepare("SELECT total_changes() n").get().n);
  for (let i = 0; i < 100; i++) {
    const r = await call(`/v1/connections/${id}`, undefined, auth);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.runtime_state, "not_connected");
    const taskRead = await call(taskPath, undefined, taskAuth);
    assert.equal(taskRead.status, 200);
    assert.equal(taskRead.body.data.status, "draft");
    assert.equal(taskRead.body.ref.id, task);
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
  const reinvite = {
    project_id: project.id,
    connection_id: id,
    expected_revision: "2",
    expected_member_revision: "1",
    configuration_fingerprint: "b".repeat(64),
    action_id: randomUUID(),
  };
  const nextInvite = await call(
    "/v1/console/connections/reinvite",
    reinvite,
    owner,
  );
  assert.equal(nextInvite.status, 200);
  assert.equal(nextInvite.body.data.replaces_connection_id, id);
  assert.deepEqual(
    (await call("/v1/console/connections/reinvite", reinvite, owner)).body,
    nextInvite.body,
  );
  const next = await call(
    "/v1/connections/redeem",
    {
      connection_id: nextInvite.body.data.connection_id,
      action_id: randomUUID(),
      configuration_fingerprint: "b".repeat(64),
    },
    { authorization: "Bearer " + nextInvite.body.data.invitation_token },
  );
  assert.equal(next.status, 200);
  assert.equal(
    (
      await call(taskPath, undefined, {
        authorization: "Bearer " + next.body.data.connection_token,
      })
    ).status,
    401,
  );
  const diagnosed = await call(
    `/v1/console/projects/${project.id}/connections`,
    undefined,
    owner,
  );
  assert.equal(
    diagnosed.body.data.find((x) => x.connection_id === id).reason,
    "REPLACED",
  );
  assert.equal(
    diagnosed.body.data.find(
      (x) => x.connection_id === nextInvite.body.data.connection_id,
    ).reason,
    "REGISTERED_NOT_CONNECTED",
  );
  assert.equal((await call(taskPath, undefined, taskAuth)).status, 404);
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
        qualification: "COMPILED_SYNTHETIC_REINVITE_JOURNEY",
        steps: [
          "pair",
          "create_project",
          "add_member",
          "invite",
          "retry_same_invite",
          "redeem",
          "trusted_synthetic_grant",
          "100_connection_and_task_reads",
          "list",
          "reinvite",
          "retry_reinvite",
          "redeem_new_registration_without_task_access",
          "old_credential_denied",
          "old_task_access_denied_after_reinvite",
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
