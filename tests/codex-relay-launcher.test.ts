import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { tempWorkspace } from "./temp.ts";
import { fixture } from "./helpers.ts";
import { createServer } from "../packages/service/src/http.ts";
import { listenLoopback } from "../packages/service/src/loopback-listener.ts";
import { setTimeout as delay } from "node:timers/promises";
const modulePath = (name: string) =>
  process.env.W29_COMPILED === "1"
    ? `../dist/packages/service/src/${name}.js`
    : `../packages/service/src/${name}.ts`;
const { officialCodexRelayLauncher, createCodexRelayLifecycle } = (await import(
  modulePath("codex-relay-launcher")
)) as typeof import("../packages/service/src/codex-relay-launcher.ts");
const { CodexAppServer } = (await import(
  modulePath("codex-app-server")
)) as typeof import("../packages/service/src/codex-app-server.ts");
const { createOwnedBridgeFactory } = (await import(
  modulePath("owned-bridge")
)) as typeof import("../packages/service/src/owned-bridge.ts");

for (const scenario of [
  "strict exit",
  "revocation",
  "task read and revocation",
])
  test(`production lifecycle binds actual child relay and removes owned home after ${scenario}`, async (t) => {
    const business = scenario === "task read and revocation",
      revoke = scenario !== "strict exit";
    const temp = tempWorkspace(),
      f = fixture();
    t.after(() => {
      f.close();
      temp.dispose();
    });
    const home = join(temp.directory, "codex-init-fixture", "home"),
      work = join(temp.directory, "codex-init-fixture", "work");
    mkdirSync(home, { recursive: true });
    mkdirSync(work);
    writeFileSync(join(home, "config.toml"), "synthetic");
    let origin = "http://127.0.0.1:1";
    if (business) {
      const server = createServer(f.service);
      await listenLoopback(server);
      origin = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
      t.after(async () => {
        server.closeAllConnections();
        await new Promise<void>((r) => server.close(() => r()));
      });
    }
    const bridge = await createOwnedBridgeFactory({
      dataRoot: temp.directory,
      config: {
        version: 1,
        target: "codex",
        service_origin: origin,
        project_id: f.ids.project,
        token: f.token,
        task_ids: [f.ids.task],
        execution_ids: [],
        allow_message_poll: false,
        egress: {
          data_class: "synthetic_only",
          provider_fingerprint: "a".repeat(64),
          expires_at: new Date(Date.now() + 60000).toISOString(),
        },
      },
    }).prepareClient(() => true);
    let authorized = true;
    const lifecycle = await createCodexRelayLifecycle(
      bridge,
      temp.directory,
      () => authorized,
    ).prepare(work);
    const child = spawn(
      process.execPath,
      [resolve("tests/fixtures/codex-relay-host.mjs"), bridge.launch.args[0]],
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          SystemRoot: process.env.SystemRoot!,
          CODEX_HOME: home,
          ...bridge.launch.env,
        },
      },
    );
    const handle = lifecycle.attach(
      new CodexAppServer(child, { workDirectory: work, requestMs: 5000 }),
      child,
    );
    try {
      await handle.ready;
      const thread = await handle.startThread(work);
      if (business) {
        const changes = () =>
          f.s.db.prepare("SELECT total_changes() AS n").get()!.n;
        const baseline = changes();
        await handle.startTurn(thread, f.ids.task);
        const end = Date.now() + 5000;
        while (handle.statistics.turn?.state === "running" && Date.now() < end)
          await delay(10);
        assert.equal(handle.statistics.turn?.state, "completed");
        assert.equal(
          handle.statistics.turn?.last_agent_message,
          `${f.ids.task}: draft`,
        );
        assert.equal(changes(), baseline);
        f.s.updateGrant({ ...f.g, state: "revoked" });
        const res = await fetch(
          `${origin}/v1/projects/${f.ids.project}/task/${f.ids.task}`,
          { headers: { authorization: `Bearer ${f.token}` } },
        );
        assert.equal(res.status, 404);
        assert.equal((await res.json()).code, "NOT_FOUND_OR_DENIED");
      }
      if (revoke) {
        authorized = false;
        await assert.rejects(
          handle.startTurn(thread, "must not send"),
          /CODEX_RELAY_AUTHORIZATION_CHANGED/,
        );
      } else handle.close();
      const exit = await handle.closed;
      assert.equal(
        exit.fault,
        revoke ? "CODEX_RELAY_AUTHORIZATION_CHANGED" : null,
      );
      assert.equal(exit.code, 0);
      assert.equal(exit.forced, false);
      assert.equal(handle.statistics.generation, business ? 1 : 0);
      assert.equal(bridge.snapshot().state, "closed");
      if (business) {
        const reports = readdirSync(temp.directory).filter((name) =>
          name.startsWith("owned-bridge-"),
        );
        assert.equal(reports.length, 1);
        const final = JSON.parse(
          readFileSync(
            join(temp.directory, reports[0]!, "report.json"),
            "utf8",
          ),
        );
        assert.equal(final.tool_calls, 1);
        assert.equal(final.tool_errors, 0);
        assert.equal(final.stdin_eof, true);
      }
      assert.equal(existsSync(join(home, "config.toml")), false);
    } finally {
      handle.close();
      await handle.closed;
      await bridge.abort();
    }
  });

test("trusted relay launcher remains inert and unauthorized launch creates no attempt", async (t) => {
  const temp = tempWorkspace(),
    f = fixture();
  t.after(() => {
    f.close();
    temp.dispose();
  });
  const data = join(temp.directory, "data"),
    bridgeData = join(temp.directory, "bridge");
  mkdirSync(data);
  mkdirSync(bridgeData);
  const installation = join(temp.directory, "installation");
  mkdirSync(installation);
  const profile = {
    installation_root: installation,
    data_root: data,
    client_version: "synthetic",
    executable_sha256: "a".repeat(64),
  };
  const bridge = {
    dataRoot: bridgeData,
    config: {
      version: 1,
      target: "codex",
      service_origin: "http://127.0.0.1:1",
      project_id: f.ids.project,
      token: f.token,
      task_ids: [f.ids.task],
      execution_ids: [],
      allow_message_poll: false,
      egress: {
        data_class: "synthetic_only",
        provider_fingerprint: "a".repeat(64),
        expires_at: new Date(Date.now() + 60000).toISOString(),
      },
    },
  };
  const launcher = officialCodexRelayLauncher(profile, bridge);
  assert.equal(launcher.source, "official_codex");
  assert.equal(
    launcher.fingerprint,
    officialCodexRelayLauncher(profile, bridge).fingerprint,
  );
  await assert.rejects(
    launcher.launch(() => false),
    /CODEX_AUTHORIZATION_CHANGED/,
  );
  assert.deepEqual(readdirSync(data), []);
  assert.deepEqual(readdirSync(bridgeData), []);
  await assert.rejects(
    launcher.launch(() => true),
    {
      name: "AdapterFault",
      code: "CODEX_INSTALLATION_MISSING",
    },
  );
  assert.deepEqual(readdirSync(bridgeData), []);
  writeFileSync(
    join(installation, "codex.exe"),
    "changed fixture, never executed",
  );
  await assert.rejects(
    launcher.launch(() => true),
    { name: "AdapterFault", code: "CODEX_CONFIG_CHANGED" },
  );
  assert.deepEqual(readdirSync(bridgeData), []);
  assert.deepEqual(readdirSync(data), []);
  assert.throws(
    () => officialCodexRelayLauncher({ ...profile, relay_binding: {} }, bridge),
    /CODEX_RELAY_PROFILE/,
  );
  assert.throws(
    () =>
      officialCodexRelayLauncher(profile, {
        ...bridge,
        config: { ...bridge.config, target: "claude_desktop" },
      }),
    /CODEX_RELAY_PROFILE/,
  );

  const provider = join(temp.directory, "provider.toml");
  writeFileSync(provider, "synthetic original");
  const reused = officialCodexRelayLauncher(
    {
      ...profile,
      provider_reuse: { source_config: provider, provider_id: "test" },
    },
    bridge,
  );
  const validRoute =
    'model_provider = "test"\nmodel = "fixture-model"\n[model_providers.test]\nbase_url = "http://127.0.0.1:15721/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nexperimental_bearer_token = "synthetic-local-only"';
  writeFileSync(provider, validRoute);
  const p = {
    ...profile,
    provider_reuse: { source_config: provider, provider_id: "test" },
  };
  const bounded = officialCodexRelayLauncher(p, bridge);
  assert.deepEqual(bounded.taskProfile, {
    route: "http://127.0.0.1:15721/v1",
    model: "fixture-model",
    project_id: f.ids.project,
    task_id: f.ids.task,
  });
  assert.equal(
    officialCodexRelayLauncher(p, {
      ...bridge,
      config: { ...bridge.config, allow_message_poll: true },
    }).taskProfile,
    undefined,
  );
  const before = readdirSync(bridgeData);
  writeFileSync(provider, "synthetic changed");
  await assert.rejects(
    reused.launch(() => true),
    /CODEX_CONFIG_CHANGED/,
  );
  assert.deepEqual(readdirSync(bridgeData), before);
});
