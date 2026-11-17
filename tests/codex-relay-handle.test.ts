import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tempWorkspace } from "./temp.ts";
import { fixture } from "./helpers.ts";
import { CodexAppServer } from "../packages/service/src/codex-app-server.ts";
import { createOwnedBridgeFactory } from "../packages/service/src/owned-bridge.ts";
import {
  readFrames,
  writeFrame,
} from "../packages/service/src/bridge-relay-io.ts";
import { composeCodexRelayHandle } from "../packages/service/src/codex-relay-handle.ts";
import { captureCodexHomeCleanup } from "../packages/service/src/codex-home-cleanup.ts";

async function setup(
  t: TestContext,
  options: {
    proof?: string;
    cleanupFail?: boolean;
    unknownHost?: boolean;
    observeGate?: Promise<void>;
    onObserve?: () => void;
    deadlineMs?: number;
  } = {},
) {
  const temp = tempWorkspace(),
    f = fixture();
  const home = resolve(temp.directory, "codex-init-fixture", "home");
  const work = resolve(temp.directory, "codex-init-fixture", "work");
  mkdirSync(home, { recursive: true });
  mkdirSync(work);
  const config = resolve(home, "config.toml");
  writeFileSync(config, "synthetic-only");
  const cleanHome = await captureCodexHomeCleanup(temp.directory, work);
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
  const child = spawn(
    process.execPath,
    [resolve("tests/fixtures/codex-app-server-fixture.mjs"), "success"],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  const raw = new CodexAppServer(child);
  const host = options.unknownHost
    ? new Proxy(raw, {
        get(target, key) {
          if (key === "closed")
            return target.closed.then((exit) => ({
              ...exit,
              exit_observed: false,
              code: null,
            }));
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      })
    : raw;
  const relay = spawn(bridge.launch.command, bridge.launch.args, {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: { SystemRoot: process.env.SystemRoot!, ...bridge.launch.env },
  });
  const ended = once(relay, "close");
  relay.stderr.resume();
  const frames = readFrames(relay.stdout, 131072, 1048576);
  await writeFrame(
    relay.stdin,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "w26", version: "1" },
      },
    },
    3000,
  );
  assert.ok((await frames.next()).value.result);
  await writeFrame(
    relay.stdin,
    { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
    3000,
  );
  await writeFrame(
    relay.stdin,
    { jsonrpc: "2.0", id: 2, method: "ping", params: {} },
    3000,
  );
  await frames.next();
  let cleaned = 0,
    released = 0,
    authorized = true;
  const handle = composeCodexRelayHandle({
    host,
    bridge,
    deadlineMs: options.deadlineMs ?? 3000,
    stillAuthorized: () => authorized,
    observeRelay: async () => {
      options.onObserve?.();
      if (options.observeGate) await options.observeGate;
      if (options.proof === "error") throw new Error("private diagnostic");
      return {
        waitExit: async () => {
          const [code] = await ended;
          return {
            code,
            exit_observed: options.proof !== "unknown",
            forced: options.proof === "forced",
          };
        },
        dispose: async () => {
          released++;
        },
      };
    },
    cleanup: async () => {
      assert.equal(child.exitCode, 0);
      cleaned++;
      if (options.cleanupFail) throw new Error("secret detail");
      await cleanHome();
    },
  });
  t.after(async () => {
    handle.close();
    await handle.closed;
    await bridge.abort();
    if (relay.exitCode === null && relay.signalCode === null) relay.kill();
    await ended;
    f.close();
    temp.dispose();
  });
  await handle.ready;
  return {
    handle,
    raw,
    child,
    bridge,
    config,
    cleaned: () => cleaned,
    released: () => released,
    revoke: () => {
      authorized = false;
    },
  };
}
test("composed handle closes bridge then relay then host, cleans once and returns immutable projections", async (t) => {
  const f = await setup(t);
  await f.handle.startThread(process.cwd());
  const stats = f.handle.statistics;
  stats.generation = 999;
  assert.equal(f.raw.statistics.generation, 0);
  f.handle.close();
  f.handle.close();
  await assert.rejects(f.handle.startThread(process.cwd()));
  const exit = await f.handle.closed;
  assert.equal(exit.code, 0);
  assert.equal(exit.fault, null);
  assert.equal(f.bridge.snapshot().state, "closed");
  assert.equal(f.cleaned(), 1);
  assert.equal(f.released(), 1);
  assert.equal(f.handle.status.state, "closed");
  assert.equal(existsSync(f.config), false);
});
for (const proof of ["unknown", "forced", "error"])
  test(`external relay ${proof} cannot become successful host exit`, async (t) => {
    const f = await setup(t, { proof });
    if (proof === "error")
      await assert.rejects(f.handle.startThread(process.cwd()));
    else await f.handle.startThread(process.cwd());
    f.handle.close();
    const exit = await f.handle.closed;
    assert.ok(exit.fault);
    assert.doesNotMatch(exit.fault!, /private/);
    assert.equal(f.bridge.snapshot().state, "failed");
  });
test("credential cleanup failure is not a successful close", async (t) => {
  const f = await setup(t, { cleanupFail: true });
  await f.handle.startThread(process.cwd());
  f.handle.close();
  assert.equal((await f.handle.closed).fault, "CODEX_RELAY_CLEANUP");
});
test("authorization loss rejects new turn and closes without model requests", async (t) => {
  const f = await setup(t);
  const thread = await f.handle.startThread(process.cwd());
  f.revoke();
  await assert.rejects(f.handle.startTurn(thread, "must not send"));
  assert.equal(
    (await f.handle.closed).fault,
    "CODEX_RELAY_AUTHORIZATION_CHANGED",
  );
  assert.equal(f.raw.statistics.generation, 0);
});
test("host early exit cannot masquerade as coordinated shutdown", async (t) => {
  const f = await setup(t);
  await f.handle.startThread(process.cwd());
  f.raw.close();
  assert.equal((await f.handle.closed).fault, "CODEX_RELAY_HOST_EARLY_EXIT");
  assert.equal(f.bridge.snapshot().state, "failed");
});

test("unknown host exit blocks credential cleanup and does not advertise stopped", async (t) => {
  const f = await setup(t, { unknownHost: true });
  await f.handle.startThread(process.cwd());
  f.handle.close();
  const exit = await f.handle.closed;
  assert.equal(exit.exit_observed, false);
  assert.equal(f.cleaned(), 0);
  assert.equal(existsSync(f.config), true);
  assert.notEqual(f.handle.status.state, "closed");
});

test("close while observer is pending releases its OS handle exactly once", async (t) => {
  let release!: () => void, observed!: () => void;
  const gate = new Promise<void>((r) => {
      release = r;
    }),
    entered = new Promise<void>((r) => {
      observed = r;
    });
  const f = await setup(t, { observeGate: gate, onObserve: observed });
  const starting = f.handle.startThread(process.cwd());
  const rejected = assert.rejects(starting);
  await entered;
  f.handle.close();
  release();
  await rejected;
  await f.handle.closed;
  assert.equal(f.released(), 1);
});

test("observer timeout is bounded and a late observation still gets disposed", async (t) => {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const f = await setup(t, { observeGate: gate, deadlineMs: 150 });
  await assert.rejects(f.handle.startThread(process.cwd()));
  await f.handle.closed;
  release();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(f.released(), 1);
});

test("closing before thread setup cannot claim coordinated relay exit", async (t) => {
  const f = await setup(t);
  f.handle.close();
  const exit = await f.handle.closed;
  assert.equal(exit.fault, "CODEX_RELAY_CLOSE");
  assert.equal(f.cleaned(), 1);
  assert.equal(f.released(), 0);
  assert.equal(f.raw.statistics.generation, 0);
});

test("host exit during observer setup disposes the late handle exactly once", async (t) => {
  let release!: () => void, observed!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const entered = new Promise<void>((r) => {
    observed = r;
  });
  const f = await setup(t, { observeGate: gate, onObserve: observed });
  const starting = assert.rejects(f.handle.startThread(process.cwd()));
  await entered;
  f.raw.close();
  await f.handle.closed;
  release();
  await starting;
  assert.equal(f.released(), 1);
});
