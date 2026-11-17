import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  existsSync,
  readdirSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  cpSync,
  linkSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fixture } from "./helpers.ts";
import { tempWorkspace } from "./temp.ts";
import { listenLoopback } from "../packages/service/src/loopback-listener.ts";
import {
  readFrames,
  writeFrame,
} from "../packages/service/src/bridge-relay-io.ts";
import { createOwnedBridgeFactory } from "../packages/service/src/owned-bridge.ts";

async function setup(t: TestContext) {
  const temp = tempWorkspace(),
    f = fixture();
  const dataRoot = join(temp.directory, "data");
  mkdirSync(dataRoot);
  let reads = 0;
  const server = createServer((req, res) => {
    try {
      assert.equal(req.method, "GET");
      assert.equal(req.url, `/v1/projects/${f.ids.project}/task/${f.ids.task}`);
      const data = f.service.readResource(
        req.headers.authorization?.slice(7) ?? "",
        f.ids.project,
        "task",
        f.ids.task,
      );
      reads++;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(404);
      res.end(JSON.stringify({ code: "NOT_FOUND_OR_DENIED" }));
    }
  });
  await listenLoopback(server);
  const addr = server.address();
  assert.ok(addr && typeof addr !== "string");
  const config = {
    version: 1,
    target: "codex",
    service_origin: `http://127.0.0.1:${addr.port}`,
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
  };
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    f.close();
    temp.dispose();
  });
  return { ...f, config, dataRoot, temp, reads: () => reads };
}
async function factoryAtRuntime(input: unknown) {
  if (process.env.W23_COMPILED !== "1") return createOwnedBridgeFactory(input);
  const mod = await import(
    pathToFileURL(resolve("dist/packages/service/src/owned-bridge.js")).href
  );
  return mod.createOwnedBridgeFactory(input);
}
async function start(t: TestContext) {
  const f = await setup(t),
    factory = await factoryAtRuntime({
      dataRoot: f.dataRoot,
      config: f.config,
    });
  const handle = await factory.launch(() => true);
  t.after(() => handle.abort());
  const frames = readFrames(handle.output, 131072, 1048576);
  let id = 0;
  const rpc = async (method: string, params: unknown = {}) => {
    await writeFrame(
      handle.input,
      { jsonrpc: "2.0", id: ++id, method, params },
      3000,
    );
    const r = await frames.next();
    assert.equal(r.done, false);
    assert.equal(r.value.id, id);
    return r.value;
  };
  await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "w23", version: "1" },
  });
  await writeFrame(
    handle.input,
    { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
    3000,
  );
  await rpc("ping");
  return { ...f, factory, handle, rpc };
}
const normal = async () => ({ code: 0, exit_observed: true, forced: false });

test("owned bridge factory rejects unauthorized before directory/process creation", async (t) => {
  const f = await setup(t),
    factory = await factoryAtRuntime({
      dataRoot: f.dataRoot,
      config: f.config,
    });
  await assert.rejects(
    factory.launch(() => false),
    /BRIDGE_AUTHORIZATION_CHANGED/,
  );
  assert.deepEqual(readdirSync(f.dataRoot), []);
});
test("owned bridge validates config and does not mutate or read user settings", async (t) => {
  const f = await setup(t);
  assert.throws(
    () =>
      createOwnedBridgeFactory({
        dataRoot: f.dataRoot,
        config: { ...f.config, target: "sdk" },
      }),
    /MCP_CONFIG/,
  );
  assert.throws(
    () => createOwnedBridgeFactory({ dataRoot: "relative", config: f.config }),
    /BRIDGE_CONFIG/,
  );
  assert.throws(
    () =>
      createOwnedBridgeFactory({
        dataRoot: f.dataRoot,
        config: f.config,
        command: "arbitrary",
      }),
    /BRIDGE_CONFIG/,
  );
  assert.deepEqual(readdirSync(f.dataRoot), []);
});
test("authorization loss after preflight starts no bridge and clears temporary credentials", async (t) => {
  const f = await setup(t),
    factory = await factoryAtRuntime({
      dataRoot: f.dataRoot,
      config: f.config,
    });
  let calls = 0;
  await assert.rejects(
    factory.launch(() => ++calls < 3),
    /BRIDGE_AUTHORIZATION_CHANGED/,
  );
  for (const dir of readdirSync(f.dataRoot))
    assert.equal(existsSync(join(f.dataRoot, dir, "bridge.json")), false);
});
test("owned factory reads actual authorized task, then validates exits and removes only its credential file", async (t) => {
  const f = await start(t);
  const before = f.s.db.prepare("SELECT total_changes() n").get()!.n;
  const task = await f.rpc("tools/call", {
    name: "task_get",
    arguments: { task_id: f.ids.task },
  });
  assert.equal(task.result.isError, false);
  const data = JSON.parse(task.result.content[0].text);
  assert.equal(data.ref.id, f.ids.task);
  assert.equal(data.data.status, "draft");
  for (let i = 0; i < 1000; i++)
    assert.equal(f.handle.snapshot().state, "open");
  assert.equal(f.s.db.prepare("SELECT total_changes() n").get()!.n, before);
  assert.equal(f.reads(), 1);
  const [dir] = readdirSync(f.dataRoot);
  assert.ok(dir);
  const root = join(f.dataRoot, dir);
  writeFileSync(join(root, "keep.txt"), "user marker");
  let closes = 0;
  const stop = f.handle.stop(async () => {
    closes++;
    return normal();
  });
  assert.equal(f.handle.stop(normal), stop);
  await stop;
  const state = f.handle.snapshot();
  assert.equal(state.state, "closed");
  assert.equal(state.credentials_cleared, true);
  assert.equal(state.bridge_exit.code, 0);
  assert.equal(state.relay_exit.code, 0);
  assert.equal(closes, 1);
  assert.equal(existsSync(join(root, "bridge.json")), false);
  assert.equal(readFileSync(join(root, "keep.txt"), "utf8"), "user marker");
  assert.equal(
    JSON.parse(readFileSync(join(root, "report.json"), "utf8")).stdin_eof,
    true,
  );
  assert.doesNotMatch(JSON.stringify(state), new RegExp(f.token));
});
test("revoked business grant cannot become a successful owned stop", async (t) => {
  const f = await start(t);
  f.s.updateGrant({ ...f.g, state: "revoked" });
  assert.equal(
    (
      await f.rpc("tools/call", {
        name: "task_get",
        arguments: { task_id: f.ids.task },
      })
    ).result.isError,
    true,
  );
  let host = 0;
  await assert.rejects(
    f.handle.stop(async () => {
      host++;
      return normal();
    }),
    /BRIDGE_EVIDENCE/,
  );
  assert.equal(host, 0);
  assert.equal(f.handle.snapshot().state, "failed");
  assert.equal(f.handle.snapshot().credentials_cleared, true);
});
test("abort retains failed status and does not fabricate graceful success", async (t) => {
  const f = await start(t);
  await f.handle.abort();
  assert.equal(f.handle.snapshot().state, "failed");
  assert.equal(f.handle.snapshot().credentials_cleared, true);
  await assert.rejects(f.handle.stop(normal));
});
test("host unknown after clean bridge and relay remains failed, credentials still cleaned", async (t) => {
  const f = await start(t);
  await assert.rejects(
    f.handle.stop(async () => ({
      code: null,
      exit_observed: false,
      forced: false,
    })),
    /HOST_EXIT_UNPROVEN/,
  );
  assert.equal(f.handle.snapshot().state, "failed");
  assert.equal(f.handle.snapshot().credentials_cleared, true);
});
test("pinned runtime changes reject launch before process creation", async (t) => {
  const f = await setup(t);
  const parent = resolve(".runtime", "w23");
  mkdirSync(parent, { recursive: true });
  const copy = mkdtempSync(join(parent, "runtime-"));
  const tree = join(copy, "packages", "service", "src");
  mkdirSync(join(copy, "packages", "service"), { recursive: true });
  cpSync(resolve("packages/service/src"), tree, { recursive: true });
  cpSync(resolve("packages/contracts"), join(copy, "packages", "contracts"), {
    recursive: true,
  });
  const entry = join(tree, "owned-bridge.ts");
  // Copied module's contracts are only loaded once launch validates MCP config.
  const { createOwnedBridgeFactory: make } = await import(
    pathToFileURL(entry).href
  );
  const factory = make({ dataRoot: f.dataRoot, config: f.config });
  writeFileSync(
    join(tree, "bridge-relay-entry.ts"),
    'throw new Error("tampered")',
  );
  await assert.rejects(
    factory.launch(() => true),
    /BRIDGE_CONFIG_CHANGED/,
  );
  assert.deepEqual(readdirSync(f.dataRoot), []);
});

test("ambient Node injection is never inherited by owned bridge or relay", async (t) => {
  const old = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = "--require=does-not-exist-private-injection";
  try {
    const f = await start(t);
    assert.ok((await f.rpc("ping")).result);
    await f.handle.stop(normal);
    assert.equal(f.handle.snapshot().state, "closed");
  } finally {
    if (old === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = old;
  }
});
test("simultaneous abort cannot be overwritten by successful stop", async (t) => {
  const f = await start(t);
  let entered!: () => void, release!: () => void;
  const hostEntered = new Promise<void>((r) => (entered = r)),
    hostReleased = new Promise<void>((r) => (release = r));
  const stop = f.handle.stop(async () => {
    entered();
    await hostReleased;
    return normal();
  });
  const rejected = assert.rejects(stop, /BRIDGE_ABORTED/);
  await hostEntered;
  await f.handle.abort();
  release();
  await rejected;
  assert.equal(f.handle.snapshot().state, "failed");
});

test("launch returns only after relay authentication is ready for immediate stop", async (t) => {
  const f = await setup(t),
    factory = await factoryAtRuntime({
      dataRoot: f.dataRoot,
      config: f.config,
    });
  const h = await factory.launch(() => true);
  t.after(() => h.abort());
  await assert.rejects(h.stop(normal), /BRIDGE_EXIT/); // MCP not initialized, never RELAY_NOT_OPEN.
  assert.equal(h.snapshot().credentials_cleared, true);
});
test("authorization revoked after bridge creation still cleans its owned resources", async (t) => {
  const f = await setup(t),
    factory = await factoryAtRuntime({
      dataRoot: f.dataRoot,
      config: f.config,
    });
  let checks = 0;
  await assert.rejects(
    factory.launch(() => ++checks < 4),
    /BRIDGE_AUTHORIZATION_CHANGED/,
  );
  for (const dir of readdirSync(f.dataRoot))
    assert.equal(existsSync(join(f.dataRoot, dir, "bridge.json")), false);
});
