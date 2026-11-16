import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store } from "../packages/service/src/store.ts";
import { WorkspaceService } from "../packages/service/src/workspace-service.ts";
import { CoreService } from "../packages/service/src/service.ts";
import { createServer } from "../packages/service/src/http.ts";
import { listenLoopback } from "../packages/service/src/loopback-listener.ts";
import { ConnectionRegistry } from "../packages/service/src/connection-registry.ts";
import { tempWorkspace } from "./temp.ts";
import { join } from "node:path";
import {
  createRecovery,
  restoreRecovery,
} from "../packages/service/src/recovery.ts";
import { gitExe } from "./broker-helpers.ts";

async function setup(t: TestContext) {
  let time = Date.now();
  const store = new Store(),
    now = () => time;
  const w = new WorkspaceService(store, now);
  const server = createServer(new CoreService(store, now), w);
  await listenLoopback(server);
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const session = w.auth.pair(w.auth.newPairing().code);
  const owner = {
    cookie: `team_owner=${session.token}`,
    "x-csrf-token": session.csrf,
  };
  const command = (kind: string, args: Record<string, unknown>) =>
    w.command(session.token, session.csrf, {
      kind,
      action_id: randomUUID(),
      ...args,
    }) as any;
  const project = command("create_project", {
    name: "Connections",
    description: "",
  });
  const member = command("add_member", {
    project_id: project.id,
    name: "Codex",
    client: "codex",
    role: "review",
  });
  const call = async (
    path: string,
    body?: unknown,
    headers: Record<string, string> = owner,
  ) => {
    const r = await fetch(origin + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { origin, "content-type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: r.status,
      body: (await r.json()) as any,
      headers: r.headers,
    };
  };
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
  });
  const request = () => ({
    project_id: project.id,
    member_id: member.id,
    action_id: randomUUID(),
    expected_member_revision: "1",
    configuration_fingerprint: "a".repeat(64),
  });
  return {
    store,
    w,
    owner,
    project,
    member,
    command,
    call,
    request,
    advance: (ms: number) => (time += ms),
  };
}
const bearer = (token: string) => ({ authorization: "Bearer " + token });
const invitePath = "/v1/console/connections/invite";
const redeemPath = "/v1/connections/redeem";

test("pending invite expiry is read-only and a replacement cannot revive the old invite", async (t) => {
  const f = await setup(t);
  const first = await f.call(invitePath, f.request());
  assert.equal(first.status, 200);
  f.advance(600000);
  const before = f.store.db.prepare("SELECT total_changes() n").get()!.n;
  const list = await f.call(`/v1/console/projects/${f.project.id}/connections`);
  assert.equal(list.body.data[0].state, "expired");
  assert.equal(f.store.db.prepare("SELECT total_changes() n").get()!.n, before);
  const replacement = await f.call(invitePath, f.request());
  assert.equal(replacement.status, 200);
  assert.notEqual(
    replacement.body.data.connection_id,
    first.body.data.connection_id,
  );
  assert.equal(
    (
      await f.call(
        redeemPath,
        {
          connection_id: first.body.data.connection_id,
          action_id: randomUUID(),
          configuration_fingerprint: "a".repeat(64),
        },
        bearer(first.body.data.invitation_token),
      )
    ).status,
    401,
  );
});

test("revoking an unused invite prevents redemption and permits explicit replacement", async (t) => {
  const f = await setup(t),
    request = f.request();
  const first = await f.call(invitePath, request);
  assert.equal(first.status, 200);
  const revoke = {
    project_id: f.project.id,
    connection_id: first.body.data.connection_id,
    action_id: randomUUID(),
    expected_revision: "1",
  };
  assert.equal(
    (await f.call("/v1/console/connections/revoke", revoke)).status,
    200,
  );
  assert.equal((await f.call(invitePath, request)).status, 409);
  assert.equal(
    (
      await f.call(
        redeemPath,
        {
          connection_id: revoke.connection_id,
          action_id: randomUUID(),
          configuration_fingerprint: "a".repeat(64),
        },
        bearer(first.body.data.invitation_token),
      )
    ).status,
    401,
  );
  assert.equal((await f.call(invitePath, f.request())).status, 200);
});
async function enroll(f: Awaited<ReturnType<typeof setup>>) {
  const invitation = await f.call(invitePath, f.request());
  assert.equal(invitation.status, 200);
  const q = {
    connection_id: invitation.body.data.connection_id,
    action_id: randomUUID(),
    configuration_fingerprint: "a".repeat(64),
  };
  const redeemed = await f.call(
    redeemPath,
    q,
    bearer(invitation.body.data.invitation_token),
  );
  assert.equal(redeemed.status, 200);
  return {
    invitation: invitation.body.data,
    q,
    connection: redeemed.body.data,
  };
}

test("owner invitation exchanges once, reads without writes, then revokes without granting execution", async (t) => {
  const f = await setup(t);
  const e = await enroll(f);
  assert.equal(e.connection.state, "registered");
  assert.equal(e.connection.runtime_state, "not_connected");
  const auth = bearer(e.connection.connection_token),
    path = `/v1/connections/${e.q.connection_id}`;
  const before = f.store.db.prepare("SELECT total_changes() n").get()!.n;
  for (let i = 0; i < 100; i++) {
    const r = await f.call(path, undefined, auth);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.qualification, "UNVERIFIED");
    assert.ok(!JSON.stringify(r.body).includes("token"));
  }
  assert.equal(f.store.db.prepare("SELECT total_changes() n").get()!.n, before);
  assert.equal(
    (
      await f.call(
        "/v1/runtimes/codex/start",
        {
          project_id: f.project.id,
          runtime_id: randomUUID(),
          scope_id: randomUUID(),
          action_id: randomUUID(),
          expected_revision: "0",
          configuration_fingerprint: "a".repeat(64),
        },
        auth,
      )
    ).status,
    401,
  );
  assert.equal(f.store.grantForToken(e.connection.connection_token), undefined);
  const raw = JSON.stringify(
    f.store.db.prepare("SELECT * FROM resources").all(),
  );
  assert.ok(!raw.includes(e.invitation.invitation_token));
  assert.ok(!raw.includes(e.connection.connection_token));
  const revoke = {
    project_id: f.project.id,
    connection_id: e.q.connection_id,
    action_id: randomUUID(),
    expected_revision: "2",
  };
  assert.equal(
    (await f.call("/v1/console/connections/revoke", revoke)).status,
    200,
  );
  assert.equal((await f.call(path, undefined, auth)).status, 401);
  assert.equal(
    (await f.call(redeemPath, e.q, bearer(e.invitation.invitation_token)))
      .status,
    401,
  );
  assert.equal(
    (await f.call("/v1/console/connections/revoke", revoke)).status,
    200,
  );
});

test("connection transport rejects wrong origin, cookie mixing and forged identity fields", async (t) => {
  const f = await setup(t),
    e = await enroll(f),
    auth = bearer(e.invitation.invitation_token);
  assert.equal(
    (
      await f.call(redeemPath, e.q, {
        ...auth,
        origin: "https://attacker.invalid",
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.call(redeemPath, e.q, { ...auth, cookie: f.owner.cookie })).status,
    400,
  );
  assert.equal(
    (await f.call(redeemPath, { ...e.q, member_id: randomUUID() }, auth))
      .status,
    400,
  );
  const list = await f.call(`/v1/console/projects/${f.project.id}/connections`);
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 1);
  assert.equal(list.body.data[0].state, "registered");
  assert.ok(!JSON.stringify(list.body).includes("hash"));
  assert.ok(!JSON.stringify(list.body).includes("token"));
  assert.equal(list.headers.get("cache-control"), "no-store");
});

test("revocation CAS and member reactivation cannot resurrect old credentials", async (t) => {
  const f = await setup(t),
    e = await enroll(f);
  const q = {
    project_id: f.project.id,
    connection_id: e.q.connection_id,
    action_id: randomUUID(),
    expected_revision: "1",
  };
  assert.equal((await f.call("/v1/console/connections/revoke", q)).status, 409);
  f.command("set_member_state", {
    project_id: f.project.id,
    member_id: f.member.id,
    expected_revision: "1",
    state: "inactive",
  });
  f.command("set_member_state", {
    project_id: f.project.id,
    member_id: f.member.id,
    expected_revision: "2",
    state: "active",
  });
  assert.equal(
    (
      await f.call(
        `/v1/connections/${e.q.connection_id}`,
        undefined,
        bearer(e.connection.connection_token),
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await f.call(invitePath, {
        ...f.request(),
        expected_member_revision: "3",
      })
    ).status,
    200,
  );
});

test("durable registration retries survive reopen but real backup restore invalidates credentials", async () => {
  const temp = tempWorkspace();
  let s = new Store(temp.db);
  try {
    let w = new WorkspaceService(s);
    const session = w.auth.pair(w.auth.newPairing().code);
    const project = w.command(session.token, session.csrf, {
      kind: "create_project",
      action_id: randomUUID(),
      name: "persist",
      description: "",
    }) as any;
    const member = w.command(session.token, session.csrf, {
      kind: "add_member",
      action_id: randomUUID(),
      project_id: project.id,
      client: "codex",
      name: "Codex",
      role: "review",
    }) as any;
    const q = {
      project_id: project.id,
      member_id: member.id,
      action_id: randomUUID(),
      expected_member_revision: "1",
      configuration_fingerprint: "a".repeat(64),
    };
    const registry = new ConnectionRegistry(w);
    const invitation = registry.invite(session.token, session.csrf, q);
    const redeem = {
      connection_id: invitation.connection_id,
      action_id: randomUUID(),
      configuration_fingerprint: "a".repeat(64),
    };
    const connection = registry.redeem(invitation.invitation_token, redeem);
    s.close();
    s = new Store(temp.db);
    w = new WorkspaceService(s);
    const reopened = new ConnectionRegistry(w);
    assert.deepEqual(
      reopened.redeem(invitation.invitation_token, redeem),
      connection,
    );
    assert.equal(
      reopened.read(connection.connection_token, connection.connection_id)
        .state,
      "registered",
    );
    const backup = join(temp.directory, "backup");
    await createRecovery({
      database: temp.db,
      destination: backup,
      git: gitExe,
    });
    const result = restoreRecovery(
      backup,
      join(temp.directory, "restore"),
      gitExe,
    );
    const restored = new Store(result.database);
    try {
      const restoredRegistry = new ConnectionRegistry(
        new WorkspaceService(restored),
      );
      assert.throws(
        () =>
          restoredRegistry.read(
            connection.connection_token,
            connection.connection_id,
          ),
        /CONNECTION_CREDENTIAL_INVALID/,
      );
      assert.throws(
        () => restoredRegistry.redeem(invitation.invitation_token, redeem),
        /CONNECTION_CREDENTIAL_INVALID/,
      );
    } finally {
      restored.close();
    }
    assert.equal(
      reopened.read(connection.connection_token, connection.connection_id)
        .state,
      "registered",
    );
  } finally {
    s.close();
    temp.dispose();
  }
});

test("invitation and redemption retries are idempotent but competing claims cannot mint another credential", async (t) => {
  const f = await setup(t),
    q = f.request();
  const first = await f.call(invitePath, q);
  assert.equal(first.status, 200);
  assert.deepEqual((await f.call(invitePath, q)).body, first.body);
  assert.equal(
    (
      await f.call(invitePath, {
        ...q,
        configuration_fingerprint: "b".repeat(64),
      })
    ).status,
    409,
  );
  assert.equal((await f.call(invitePath, f.request())).status, 409);
  const redeem = {
    connection_id: first.body.data.connection_id,
    action_id: randomUUID(),
    configuration_fingerprint: "a".repeat(64),
  };
  const auth = bearer(first.body.data.invitation_token);
  assert.equal(
    (
      await f.call(
        redeemPath,
        { ...redeem, configuration_fingerprint: "b".repeat(64) },
        auth,
      )
    ).status,
    401,
  );
  const results = await Promise.all([
    f.call(redeemPath, redeem, auth),
    f.call(redeemPath, { ...redeem, action_id: randomUUID() }, auth),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
  const winner = results.find((r) => r.status === 200)!;
  if (results[0]!.status === 200)
    assert.deepEqual(
      (await f.call(redeemPath, redeem, auth)).body,
      winner.body,
    );
});

test("owner APIs enforce session, CSRF, member project and strict fields", async (t) => {
  const f = await setup(t),
    q = f.request();
  assert.equal((await f.call(invitePath, q, {})).status, 401);
  assert.equal(
    (await f.call(invitePath, q, { cookie: f.owner.cookie })).status,
    403,
  );
  assert.equal(
    (await f.call(invitePath, { ...q, project_id: randomUUID() })).status,
    404,
  );
  assert.equal(
    (await f.call(invitePath, { ...q, expected_member_revision: "0" })).status,
    409,
  );
  assert.equal(
    (await f.call(invitePath, { ...q, actions: ["runtime_control"] })).status,
    400,
  );
});

for (const scenario of [
  "expiry",
  "member_change",
  "member_inactive",
  "key_rotation",
] as const)
  test(`connection is invalid after ${scenario}`, async (t) => {
    const f = await setup(t),
      e = await enroll(f);
    if (scenario === "expiry") f.advance(8 * 3600000);
    if (scenario === "member_change")
      f.command("update_member", {
        project_id: f.project.id,
        member_id: f.member.id,
        expected_revision: "1",
        name: "Codex",
        role: "changed",
      });
    if (scenario === "member_inactive")
      f.command("set_member_state", {
        project_id: f.project.id,
        member_id: f.member.id,
        expected_revision: "1",
        state: "inactive",
      });
    if (scenario === "key_rotation")
      f.store.db
        .prepare("UPDATE console_secrets SET value=? WHERE name='signing_key'")
        .run("b".repeat(64));
    assert.equal(
      (
        await f.call(
          `/v1/connections/${e.q.connection_id}`,
          undefined,
          bearer(e.connection.connection_token),
        )
      ).status,
      401,
    );
  });

test("expired invitation and cross-connection token cannot be used", async (t) => {
  const f = await setup(t),
    e = await enroll(f);
  assert.equal(
    (
      await f.call(
        `/v1/connections/${randomUUID()}`,
        undefined,
        bearer(e.connection.connection_token),
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await f.call(
        `/v1/connections/${e.q.connection_id}`,
        undefined,
        bearer(e.invitation.invitation_token),
      )
    ).status,
    401,
  );
  f.advance(600000);
  assert.equal(
    (await f.call(redeemPath, e.q, bearer(e.invitation.invitation_token)))
      .status,
    401,
  );
  assert.equal(
    (
      await f.call(
        `/v1/connections/${e.q.connection_id}`,
        undefined,
        bearer(e.connection.connection_token),
      )
    ).status,
    200,
  );
});
