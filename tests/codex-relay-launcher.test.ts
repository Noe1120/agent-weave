import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { tempWorkspace } from "./temp.ts";
import { fixture } from "./helpers.ts";
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

for (const revoke of [false, true])
  test(`production lifecycle binds actual child relay and removes owned home after ${revoke ? "revocation" : "strict exit"}`, async (t) => {
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
    const bridge = await createOwnedBridgeFactory({
      dataRoot: temp.directory,
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
      new CodexAppServer(child, { workDirectory: work }),
      child,
    );
    try {
      await handle.ready;
      const thread = await handle.startThread(work);
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
      assert.equal(handle.statistics.generation, 0);
      assert.equal(bridge.snapshot().state, "closed");
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
  const before = readdirSync(bridgeData);
  writeFileSync(provider, "synthetic changed");
  await assert.rejects(
    reused.launch(() => true),
    /CODEX_CONFIG_CHANGED/,
  );
  assert.deepEqual(readdirSync(bridgeData), before);
});
