import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { connect, createServer as createTcpServer } from "node:net";
import { PassThrough, Writable } from "node:stream";
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fixture } from "./helpers.ts";
import { tempWorkspace } from "./temp.ts";
import { listenLoopback } from "../packages/service/src/loopback-listener.ts";
import { BridgeSupervisor } from "../packages/service/src/bridge-supervisor.ts";
import {
  openRelayEndpoint,
  runRelay,
} from "../packages/service/src/bridge-relay.ts";
import {
  readFrames,
  writeFrame,
} from "../packages/service/src/bridge-relay-io.ts";

async function setup(
  t: TestContext,
  ttlMs = 30000,
  mode = "real",
  deadlineMs = 3000,
) {
  const temp = tempWorkspace(),
    f = fixture();
  let gate = false;
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((r) => (enter = r)),
    released = new Promise<void>((r) => (release = r));
  const http = createServer(async (req, res) => {
    if (gate) {
      enter();
      await released;
    }
    try {
      assert.equal(req.url, `/v1/projects/${f.ids.project}/task/${f.ids.task}`);
      const data = f.service.readResource(
        req.headers.authorization?.slice(7) ?? "",
        f.ids.project,
        "task",
        f.ids.task,
      );
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(404);
      res.end(JSON.stringify({ code: "NOT_FOUND_OR_DENIED" }));
    }
  });
  await listenLoopback(http);
  const address = http.address();
  assert.ok(address && typeof address !== "string");
  const config = join(temp.directory, "bridge.json"),
    reportPath = join(temp.directory, "report.json");
  writeFileSync(
    config,
    JSON.stringify({
      version: 1,
      target: "codex",
      service_origin: `http://127.0.0.1:${address.port}`,
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
    }),
  );
  const child = spawn(
    process.execPath,
    mode === "real"
      ? [
          resolve(
            process.env.W22_COMPILED === "1"
              ? "dist/packages/service/src/mcp-entry.js"
              : "packages/service/src/mcp-entry.ts",
          ),
          "--config",
          config,
          "--report",
          reportPath,
        ]
      : [resolve("tests/fixtures/bridge-fault.mjs"), mode, reportPath],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  const ended = once(child, "close");
  const supervisor = new BridgeSupervisor(child, {
    reportPath,
    deadlineMs: 5000,
  });
  let endpoint: Awaited<ReturnType<typeof openRelayEndpoint>> | undefined;
  t.after(async () => {
    release();
    await endpoint?.dispose();
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await ended;
    http.closeAllConnections();
    await new Promise<void>((r) => http.close(() => r()));
    f.close();
    temp.dispose();
  });
  endpoint = await openRelayEndpoint(supervisor, { deadlineMs, ttlMs });
  return {
    ...f,
    endpoint,
    supervisor,
    child,
    entered,
    release,
    gate: () => {
      gate = true;
    },
  };
}
async function peer(t: TestContext, descriptor: any) {
  const socket = connect({ host: "127.0.0.1", port: descriptor.port });
  socket.on("error", () => {});
  t.after(() => socket.destroy());
  await once(socket, "connect");
  const frames = readFrames(socket, 131072, 1048576);
  await writeFrame(socket, { type: "auth", ...descriptor }, 3000);
  return { socket, frames };
}
async function launch(t: TestContext, descriptor: any) {
  const child = spawn(
    process.execPath,
    [resolve("tests/fixtures/bridge-relay.mjs")],
    {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        SystemRoot: process.env.SystemRoot!,
        TEAM_RELAY: JSON.stringify(descriptor),
      },
    },
  );
  const ended = once(child, "close");
  child.stderr.resume();
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await ended;
  });
  const frames = readFrames(child.stdout, 131072, 1048576);
  let id = 0;
  const rpc = async (method: string, params: unknown = {}) => {
    const current = ++id;
    await writeFrame(
      child.stdin,
      { jsonrpc: "2.0", id: current, method, params },
      3000,
    );
    const next = await frames.next();
    assert.equal(next.done, false);
    assert.equal(next.value.id, current);
    return next.value;
  };
  return { child, ended, rpc };
}
const init = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "w22", version: "1" },
};
const normal = async () => ({ code: 0, exit_observed: true, forced: false });

test("authenticated relay carries real task read then bridge EOF before relay and owned host exit", async (t) => {
  const f = await setup(t),
    relay = await launch(t, f.endpoint.descriptor);
  await relay.rpc("initialize", init);
  await writeFrame(
    relay.child.stdin,
    { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
    3000,
  );
  const before = f.s.db.prepare("SELECT total_changes() n").get()!.n;
  const task = await relay.rpc("tools/call", {
    name: "task_get",
    arguments: { task_id: f.ids.task },
  });
  assert.equal(task.result.isError, false);
  const data = JSON.parse(task.result.content[0].text);
  assert.equal(data.ref.id, f.ids.task);
  assert.equal(data.data.status, "draft");
  for (let i = 0; i < 1000; i++)
    assert.equal(f.endpoint.snapshot().state, "open");
  assert.equal(f.s.db.prepare("SELECT total_changes() n").get()!.n, before);
  const host = spawn(
    process.execPath,
    [
      "-e",
      "process.stdin.resume();process.stdin.on('end',()=>process.exit(0))",
    ],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  const hostEnded = once(host, "close");
  t.after(async () => {
    if (host.exitCode === null) host.kill();
    await hostEnded;
  });
  let calls = 0;
  relay.child.stdin.end();
  const stop = f.endpoint.stop(
    async () => {
      assert.equal(f.child.exitCode, 0);
      const [code] = await relay.ended;
      return { code, exit_observed: true, forced: false };
    },
    async () => {
      calls++;
      assert.equal(relay.child.exitCode, 0);
      host.stdin.end();
      const [code] = await hostEnded;
      return { code, exit_observed: true, forced: false };
    },
  );
  assert.equal(f.endpoint.snapshot().state, "draining");
  await stop;
  assert.equal(f.endpoint.snapshot().state, "closed");
  assert.equal(calls, 1);
  assert.equal(f.supervisor.snapshot().state, "closed");
});
for (const change of ["token", "instance", "expired"] as const)
  test(`relay rejects ${change} before bridge access`, async (t) => {
    const f = await setup(t, change === "expired" ? 1 : 30000);
    if (change === "expired") await new Promise((r) => setTimeout(r, 10));
    const d = { ...f.endpoint.descriptor };
    if (change !== "expired") d[change] = "0".repeat(64);
    const p = await peer(t, d);
    assert.equal((await p.frames.next()).done, true);
    assert.equal(f.supervisor.snapshot().pending, 0);
  });
test("single binding rejects second peer and disconnect cannot reopen consumed capability", async (t) => {
  const f = await setup(t);
  const p = await peer(t, f.endpoint.descriptor);
  assert.equal((await p.frames.next()).value.type, "ready");
  const other = await peer(t, f.endpoint.descriptor);
  assert.equal((await other.frames.next()).done, true);
  p.socket.end();
  await once(p.socket, "close");
  await new Promise((r) => setImmediate(r));
  await assert.rejects(f.endpoint.stop(normal, normal), /RELAY_DISCONNECTED/);
  const retry = await peer(t, f.endpoint.descriptor);
  assert.equal((await retry.frames.next()).done, true);
});
test("old endpoint identity is rejected after restart and never replays requests", async (t) => {
  const old = await setup(t),
    fresh = await setup(t);
  await old.endpoint.dispose();
  const p = await peer(t, {
    ...old.endpoint.descriptor,
    port: fresh.endpoint.descriptor.port,
  });
  assert.equal((await p.frames.next()).done, true);
  assert.equal(fresh.supervisor.snapshot().pending, 0);
});
test("relay process exits nonzero when supervisor transport disappears", async (t) => {
  const f = await setup(t),
    relay = await launch(t, f.endpoint.descriptor);
  await relay.rpc("initialize", init);
  await f.endpoint.dispose();
  const [code] = await relay.ended;
  assert.equal(code, 1);
});
test("unanswered bridge request fails endpoint without closing owned host", async (t) => {
  const f = await setup(t, 30000, "hang", 100);
  const p = await peer(t, f.endpoint.descriptor);
  await p.frames.next();
  await writeFrame(
    p.socket,
    {
      type: "rpc",
      frame: { jsonrpc: "2.0", id: 1, method: "ping", params: {} },
    },
    3000,
  );
  assert.equal((await p.frames.next()).done, true);
  let closed = 0;
  await assert.rejects(
    f.endpoint.stop(normal, async () => {
      closed++;
      return normal();
    }),
    /RELAY_REQUEST_TIMEOUT/,
  );
  assert.equal(closed, 0);
});
test("revoked task cannot read through authenticated relay or be counted clean", async (t) => {
  const f = await setup(t),
    relay = await launch(t, f.endpoint.descriptor);
  await relay.rpc("initialize", init);
  await writeFrame(
    relay.child.stdin,
    { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
    3000,
  );
  await relay.rpc("ping");
  f.s.updateGrant({ ...f.g, state: "revoked" });
  const response = await relay.rpc("tools/call", {
    name: "task_get",
    arguments: { task_id: f.ids.task },
  });
  assert.equal(response.result.isError, true);
  await assert.rejects(f.endpoint.stop(normal, normal), /BRIDGE_EVIDENCE/);
  assert.equal(f.endpoint.snapshot().state, "failed");
});

test("relay forwards original string ids and protocol errors, rejects id replay", async (t) => {
  const f = await setup(t),
    p = await peer(t, f.endpoint.descriptor);
  await p.frames.next();
  const frame = {
    jsonrpc: "2.0",
    id: "original-id",
    method: "not-supported",
    params: {},
  };
  await writeFrame(p.socket, { type: "rpc", frame }, 3000);
  const response = (await p.frames.next()).value.frame;
  assert.equal(response.id, "original-id");
  assert.equal(typeof response.error.code, "number");
  assert.equal(response.result, undefined);
  await writeFrame(p.socket, { type: "rpc", frame }, 3000);
  assert.equal((await p.frames.next()).done, true);
  await assert.rejects(f.endpoint.stop(normal, normal), /RELAY_REPLAY/);
});
test("auth silence times out without consuming capability", async (t) => {
  const f = await setup(t, 30000, "real", 100);
  const socket = connect({
    host: "127.0.0.1",
    port: f.endpoint.descriptor.port,
  });
  socket.on("error", () => {});
  t.after(() => socket.destroy());
  await once(socket, "connect");
  const ended = once(socket, "close");
  socket.resume();
  await ended;
  assert.equal(f.endpoint.snapshot().consumed, false);
  const p = await peer(t, f.endpoint.descriptor);
  assert.equal((await p.frames.next()).value.type, "ready");
});
for (const [name, payload, fault] of [
  ["oversized", "x".repeat(65537), "RELAY_FRAME_LIMIT"],
  ["malformed", "no\n", "RELAY_PROTOCOL"],
  ["truncated", '{"type":', "RELAY_TRUNCATED"],
] as const)
  test(`authenticated ${name} data cannot reach bridge`, async (t) => {
    const f = await setup(t),
      p = await peer(t, f.endpoint.descriptor);
    await p.frames.next();
    p.socket.end(payload);
    await p.frames.next();
    await assert.rejects(f.endpoint.stop(normal, normal), new RegExp(fault));
    assert.equal(f.supervisor.snapshot().pending, 0);
  });
test("owned relay crash is failure, not a bridge or host close proof", async (t) => {
  const f = await setup(t),
    relay = await launch(t, f.endpoint.descriptor);
  await relay.rpc("initialize", init);
  relay.child.kill();
  await relay.ended;
  // Drain one event-loop turn for TCP EOF observation, then read-only state.
  for (let i = 0; i < 100 && f.endpoint.snapshot().state !== "failed"; i++)
    await new Promise((r) => setTimeout(r, 10));
  await assert.rejects(f.endpoint.stop(normal, normal), /RELAY_DISCONNECTED/);
  assert.notEqual(f.supervisor.snapshot().state, "closed");
});
test("actual endpoint process crash forces relay failure without reconnect or stdout data", async (t) => {
  const owner = spawn(
    process.execPath,
    [resolve("tests/fixtures/bridge-relay-crash.mjs")],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe", "ipc"] },
  );
  const ended = once(owner, "close");
  owner.stdout!.resume();
  owner.stderr!.resume();
  t.after(async () => {
    if (owner.exitCode === null && owner.signalCode === null) owner.kill();
    await ended;
  });
  const [descriptor] = await once(owner, "message");
  const relay = await launch(t, descriptor);
  await once(owner, "message");
  owner.kill();
  await ended;
  const [code] = await relay.ended;
  assert.equal(code, 1);
});

test("stop drains accepted HTTP request and rejects later admission without duplicate host close", async (t) => {
  const f = await setup(t),
    relay = await launch(t, f.endpoint.descriptor);
  await relay.rpc("initialize", init);
  await writeFrame(
    relay.child.stdin,
    { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
    3000,
  );
  await relay.rpc("ping");
  f.gate();
  const request = relay.rpc("tools/call", {
    name: "task_get",
    arguments: { task_id: f.ids.task },
  });
  await f.entered;
  let closed = 0;
  const stop = f.endpoint.stop(
    async () => {
      const [code] = await relay.ended;
      return { code, exit_observed: true, forced: false };
    },
    async () => {
      closed++;
      return normal();
    },
  );
  assert.equal(f.endpoint.stop(normal, normal), stop);
  assert.equal(closed, 0);
  f.release();
  assert.equal((await request).result.isError, false);
  await stop;
  assert.equal(closed, 1);
  assert.equal(f.endpoint.snapshot().state, "closed");
});
test("unproven relay exit cannot close owned host or mark endpoint closed", async (t) => {
  const f = await setup(t),
    relay = await launch(t, f.endpoint.descriptor);
  await relay.rpc("initialize", init);
  await writeFrame(
    relay.child.stdin,
    { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
    3000,
  );
  await relay.rpc("ping");
  let closed = 0;
  await assert.rejects(
    f.endpoint.stop(
      async () => ({ code: null, exit_observed: false, forced: false }),
      async () => {
        closed++;
        return normal();
      },
    ),
    /RELAY_EXIT_UNPROVEN/,
  );
  assert.equal(closed, 0);
  assert.equal(f.endpoint.snapshot().state, "failed");
});

test("closed control frame cannot hide failed final client output", async (t) => {
  const token = "a".repeat(64),
    instance = "b".repeat(32);
  let writing!: () => void, failWrite!: () => void;
  const entered = new Promise<void>((r) => (writing = r));
  const output = new Writable({
    write(_c, _e, cb) {
      failWrite = () => cb(new Error("disk closed"));
      writing();
    },
  });
  const input = new PassThrough();
  const server = createTcpServer((socket) => {
    socket.on("error", () => {});
    void (async () => {
      const frames = readFrames(socket, 65536, 1048576);
      await frames.next();
      await writeFrame(socket, { type: "ready" }, 3000);
      await frames.next();
      await writeFrame(
        socket,
        { type: "ack", frame: { jsonrpc: "2.0", id: 1, result: {} } },
        3000,
      );
      await entered;
      await writeFrame(socket, { type: "closed" }, 3000);
      socket.end();
    })().catch(() => socket.destroy());
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  assert.ok(addr && typeof addr !== "string");
  t.after(async () => {
    input.destroy();
    output.destroy();
    await new Promise<void>((r) => server.close(() => r()));
  });
  const running = runRelay({ port: addr.port, token, instance }, input, output);
  const rejected = assert.rejects(running, /RELAY_WRITE/);
  await writeFrame(
    input,
    { jsonrpc: "2.0", id: 1, method: "ping", params: {} },
    3000,
  );
  await entered;
  await new Promise((r) => setTimeout(r, 30));
  failWrite();
  await rejected;
});

test("request arriving after stop fence fails instead of reaching bridge", async (t) => {
  const f = await setup(t),
    p = await peer(t, f.endpoint.descriptor);
  await p.frames.next();
  await writeFrame(
    p.socket,
    {
      type: "rpc",
      frame: { jsonrpc: "2.0", id: 1, method: "initialize", params: init },
    },
    3000,
  );
  await p.frames.next();
  await writeFrame(
    p.socket,
    {
      type: "rpc",
      frame: {
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      },
    },
    3000,
  );
  await p.frames.next();
  f.gate();
  await writeFrame(
    p.socket,
    {
      type: "rpc",
      frame: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "task_get", arguments: { task_id: f.ids.task } },
      },
    },
    3000,
  );
  await f.entered;
  let host = 0;
  const stop = f.endpoint.stop(normal, async () => {
    host++;
    return normal();
  });
  const rejected = assert.rejects(stop, /RELAY_NOT_OPEN/);
  await writeFrame(
    p.socket,
    {
      type: "rpc",
      frame: { jsonrpc: "2.0", id: 3, method: "ping", params: {} },
    },
    3000,
  );
  f.release();
  await rejected;
  assert.equal(host, 0);
  assert.equal(f.endpoint.snapshot().state, "failed");
});
