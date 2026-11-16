import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createServer } from "../packages/service/src/http.ts";
import { CodexAppServer } from "../packages/service/src/codex-app-server.ts";
import { CodexRuntimeController } from "../packages/service/src/codex-runtime.ts";
import { adapterFixture } from "./adapter-helpers.ts";
import { id } from "./helpers.ts";
import { RuntimeGateway } from "../packages/service/src/runtime-gateway.ts";
import { DshRuntimeController } from "../packages/service/src/dsh-runtime.ts";
import { InitializeOnlyAcp } from "../packages/service/src/dsh-acp.ts";

async function setup(
  t: TestContext,
  live = false,
  target: "codex" | "deepseek_harness" = "codex",
) {
  const f = adapterFixture();
  let launches = 0;
  const controller =
    target === "codex"
      ? new CodexRuntimeController(
          f.s,
          {
            fingerprint: "a".repeat(64),
            clientVersion: "fixture-1",
            source: "development_fixture",
            async launch() {
              launches++;
              return new CodexAppServer(
                spawn(
                  process.execPath,
                  [
                    resolve("tests/fixtures/codex-app-server-fixture.mjs"),
                    "success",
                  ],
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
        )
      : new DshRuntimeController(
          f.s,
          {
            fingerprint: "a".repeat(64),
            clientVersion: "fixture-1",
            source: "development_fixture",
            async launch(allowed) {
              assert.equal(allowed(), true);
              launches++;
              return new InitializeOnlyAcp(
                spawn(
                  process.execPath,
                  [resolve("tests/fixtures/dsh-acp-fixture.mjs"), "success"],
                  { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
                ),
                { initializeMs: 5000, closeMs: 1500 },
              );
            },
          },
          { now: f.now, monitorMs: 0 },
        );
  const start = () => ({
    project_id: f.ids.project,
    runtime_id: f.binding,
    scope_id: f.ids.scope,
    action_id: id(),
    expected_revision: "0",
    configuration_fingerprint: "a".repeat(64),
  });
  if (!live) {
    await controller.start(f.token, start());
    // Dispose before closing the database; the detached reader must not trust
    // persisted ready state when it does not hold this controller.
    await controller.dispose();
    const resource = f.s.getResource(f.binding)!;
    resource.data.state = "ready";
    resource.data.exit = null;
    f.s.putResource(resource);
  }
  const controllers = !live
    ? {}
    : controller instanceof CodexRuntimeController
      ? { codex: controller }
      : { deepseek_harness: controller };
  const gateway = new RuntimeGateway(f.s, controllers, f.now);
  const server = createServer(f.service, undefined, gateway);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await controller.dispose();
    f.close();
  });
  const call = async (
    path = `/v1/projects/${f.ids.project}/runtimes/${f.binding}`,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const res = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: "Bearer " + f.token,
        "content-type": "application/json",
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  return { ...f, call, start, launches: () => launches };
}

test("HTTP runtime reads report unknown after controller loss without database writes", async (t) => {
  const f = await setup(t);
  const before = f.s.db.prepare("SELECT total_changes() AS n").get()!.n;
  for (let i = 0; i < 100; i++) {
    const r = await f.call();
    assert.equal(r.status, 200);
    assert.equal(r.body.data.state, "unknown");
    assert.equal(r.body.data.fault, "RUNTIME_OWNER_UNAVAILABLE");
    assert.equal(r.body.data.member_id, f.ids.member);
    assert.equal(r.body.data.run_id, f.ids.run);
    assert.equal(r.body.data.execution_stop_proven, false);
    const raw = JSON.stringify(r.body);
    assert.ok(
      !raw.includes("controller_id") &&
        !raw.includes('"thread":') &&
        !raw.includes(f.token),
    );
  }
  assert.equal(f.s.db.prepare("SELECT total_changes() AS n").get()!.n, before);
});

test("runtime control needs a separate grant action and supports idempotent owned lifecycle", async (t) => {
  const f = await setup(t, true);
  const request = f.start();
  const path = "/v1/runtimes/codex/start";
  assert.equal((await f.call(path, request)).status, 404);
  assert.equal(f.launches(), 0);
  // The new permission is not implicitly granted by adapter_configure.
  f.p.actions.push("runtime_control");
  f.g.actions.push("runtime_control");
  f.s.putPolicy(f.p);
  f.s.updateGrant(f.g);
  const first = await f.call(path, request);
  assert.equal(first.status, 200);
  assert.equal(f.launches(), 1);
  assert.deepEqual((await f.call(path, request)).body, first.body);
  assert.equal(f.launches(), 1);
  const ready = await f.call();
  assert.equal(ready.body.data.state, "ready");
  const close = {
    project_id: f.ids.project,
    runtime_id: f.binding,
    action_id: id(),
    expected_revision: ready.body.data.revision,
  };
  assert.equal(
    (await f.call("/v1/runtimes/deepseek_harness/close", close)).status,
    404,
  );
  assert.equal((await f.call()).body.data.state, "ready");
  assert.equal(
    (
      await f.call("/v1/runtimes/codex/close", {
        ...close,
        expected_revision: "0",
      })
    ).status,
    409,
  );
  assert.equal((await f.call("/v1/runtimes/codex/close", close)).status, 200);
  const closed = await f.call();
  assert.equal(closed.body.data.state, "closed");
  assert.equal(closed.body.data.exit_observed, true);
  assert.equal(closed.body.data.execution_stop_proven, false);
});

test("runtime commands reject dynamic launch configuration, unsupported methods and untrusted callers", async (t) => {
  const f = await setup(t, true);
  f.p.actions.push("runtime_control");
  f.g.actions.push("runtime_control");
  f.s.putPolicy(f.p);
  f.s.updateGrant(f.g);
  for (const patch of [
    { program: "untrusted.exe" },
    { prompt: "do work" },
    { binding_mode: "attached_session" },
    { token: "secret" },
  ]) {
    assert.equal(
      (await f.call("/v1/runtimes/codex/start", { ...f.start(), ...patch }))
        .status,
      400,
    );
  }
  assert.equal(
    (await f.call("/v1/runtimes/codex/turn", f.start())).status,
    404,
  );
  assert.equal((await f.call("/v1/runtimes/codex/start")).status, 405);
  assert.equal(
    (
      await f.call("/v1/runtimes/codex/start", f.start(), {
        origin: "https://attacker.invalid",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call("/v1/runtimes/codex/start", f.start(), {
        cookie: "team_owner=wrong",
      })
    ).status,
    400,
  );
  assert.equal(f.launches(), 0);
});

test("HTTP runtime reads enforce grant, policy, project and dependency scope", async (t) => {
  const f = await setup(t);
  assert.equal(
    (await f.call(`/v1/projects/${id()}/runtimes/${f.binding}`)).status,
    404,
  );
  f.p.resource_ids = f.p.resource_ids.filter((x) => x !== f.ids.acceptance);
  f.s.putPolicy(f.p);
  assert.equal((await f.call()).status, 404);
  f.p.resource_ids.push(f.ids.acceptance);
  f.s.putPolicy(f.p);
  f.g.state = "revoked";
  f.s.updateGrant(f.g);
  const r = await f.call();
  assert.equal(r.body.code, "GRANT_REVOKED");
  assert.notEqual(r.status, 500);
});

test("runtime endpoint defaults to no launcher and refuses expired grants", async (t) => {
  const f = await setup(t);
  f.p.actions.push("runtime_control");
  f.g.actions.push("runtime_control");
  f.s.putPolicy(f.p);
  f.s.updateGrant(f.g);
  const response = await f.call("/v1/runtimes/codex/start", f.start());
  assert.equal(response.status, 503);
  assert.equal(response.body.code, "RUNTIME_NOT_CONFIGURED");
  f.g.expires_at = new Date(f.now() - 1).toISOString();
  f.s.updateGrant(f.g);
  assert.equal((await f.call()).body.code, "GRANT_REVOKED");
});

test("runtime projection cannot leak an instruction task removed from the current scope", async (t) => {
  const f = await setup(t);
  const resource = f.s.getResource(f.binding)!;
  resource.data.instruction_task_id = id();
  f.s.putResource(resource);
  assert.equal((await f.call()).status, 404);
});

test("DSH HTTP lifecycle remains initialize-only and never pretends to have a native session", async (t) => {
  const f = await setup(t, true, "deepseek_harness");
  f.p.actions.push("runtime_control");
  f.g.actions.push("runtime_control");
  f.s.putPolicy(f.p);
  f.s.updateGrant(f.g);
  assert.equal(
    (await f.call("/v1/runtimes/deepseek_harness/start", f.start())).status,
    200,
  );
  const ready = (await f.call()).body.data;
  assert.equal(ready.target, "deepseek_harness");
  assert.equal(ready.state, "ready");
  assert.equal(ready.session_id, null);
  assert.equal(ready.native_thread_sha256, null);
  assert.equal(ready.task_id, null);
  assert.equal(ready.qualification, "UNVERIFIED");
  assert.equal(
    (
      await f.call("/v1/runtimes/deepseek_harness/close", {
        project_id: f.ids.project,
        runtime_id: f.binding,
        action_id: id(),
        expected_revision: ready.revision,
      })
    ).status,
    200,
  );
  assert.equal((await f.call()).body.data.state, "closed");
  assert.equal(f.launches(), 1);
});
