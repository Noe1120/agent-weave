import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { fixture } from "./helpers.ts";
import { tempWorkspace } from "./temp.ts";
import { listenLoopback } from "../packages/service/src/loopback-listener.ts";
import { BridgeSupervisor } from "./bridge-supervisor.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function setup(t: TestContext, mode = "real", deadlineMs = 3000) {
  const temp = tempWorkspace(),
    f = fixture(),
    entered = deferred(),
    release = deferred();
  let gated = false,
    reads = 0;
  const service = createServer(async (req, res) => {
    entered.resolve();
    if (gated) await release.promise;
    try {
      assert.equal(req.method, "GET");
      assert.equal(req.url, `/v1/projects/${f.ids.project}/task/${f.ids.task}`);
      const token = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
      const data = f.service.readResource(
        token,
        f.ids.project,
        "task",
        f.ids.task,
      );
      reads++;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ code: "NOT_FOUND_OR_DENIED" }));
    }
  });
  await listenLoopback(service);
  const address = service.address();
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
            process.env.W21_COMPILED === "1"
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
  const supervisor = new BridgeSupervisor(child, { reportPath, deadlineMs });
  t.after(async () => {
    release.resolve();
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await ended;
    service.closeAllConnections();
    await new Promise<void>((r) => service.close(() => r()));
    f.close();
    temp.dispose();
  });
  const initialize = async () => {
    await supervisor.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "w21-fixture", version: "1" },
    });
    supervisor.notify("notifications/initialized", {});
    await supervisor.request("ping", {});
  };
  const task = () =>
    supervisor.request("tools/call", {
      name: "task_get",
      arguments: { task_id: f.ids.task },
    });
  return {
    ...f,
    supervisor,
    child,
    ended,
    initialize,
    task,
    reportPath,
    entered,
    release,
    gate: () => {
      gated = true;
    },
    reads: () => reads,
  };
}

test("stop fences admission, drains real authorized task read, proves bridge EOF/exit before closing owned host", async (t) => {
  const f = await setup(t);
  await f.initialize();
  f.gate();
  const before = f.s.db.prepare("SELECT total_changes() n").get()!.n;
  const pending = f.task();
  await f.entered.promise;
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
  let hostCloses = 0;
  const stop = f.supervisor.stop(async () => {
    hostCloses++;
    assert.equal(f.child.exitCode, 0);
    const evidence = JSON.parse(readFileSync(f.reportPath, "utf8"));
    assert.equal(evidence.stdin_eof, true);
    assert.equal(evidence.fault, null);
    host.stdin.end();
    const [code] = await hostEnded;
    return { code: code as number, exit_observed: true, forced: false };
  });
  assert.equal(
    f.supervisor.stop(async () => {
      throw new Error("duplicate host close");
    }),
    stop,
  );
  assert.equal(f.supervisor.snapshot().state, "draining");
  await assert.rejects(f.supervisor.request("ping", {}), /BRIDGE_NOT_OPEN/);
  assert.throws(
    () => f.supervisor.notify("notifications/initialized", {}),
    /BRIDGE_NOT_OPEN/,
  );
  for (let i = 0; i < 1000; i++)
    assert.equal(f.supervisor.snapshot().pending, 1);
  assert.equal(hostCloses, 0);
  f.release.resolve();
  const result = await pending;
  assert.equal(result.isError, false);
  const data = JSON.parse(result.content[0].text);
  assert.equal(data.ref.id, f.ids.task);
  assert.equal(data.data.status, "draft");
  await stop;
  assert.equal(f.supervisor.snapshot().state, "closed");
  assert.equal(hostCloses, 1);
  assert.equal(f.reads(), 1);
  assert.equal(f.s.db.prepare("SELECT total_changes() n").get()!.n, before);
});

for (const [mode, reason] of [
  ["hang", "BRIDGE_DRAIN_TIMEOUT"],
  ["exit", "BRIDGE_EARLY_EXIT"],
  ["foreign", "BRIDGE_PROTOCOL"],
  ["invalid", "BRIDGE_PROTOCOL"],
  ["oversized", "BRIDGE_OUTPUT_LIMIT"],
])
  test(`fault ${mode} never closes the host or reports clean shutdown`, async (t) => {
    const f = await setup(t, mode, 300);
    let closes = 0;
    const call = f.supervisor.request("ping", {});
    const rejected = assert.rejects(call, new RegExp(reason!));
    const stop = f.supervisor.stop(async () => {
      closes++;
      return { code: 0, exit_observed: true, forced: false };
    });
    await assert.rejects(stop, new RegExp(reason!));
    await rejected;
    assert.equal(f.supervisor.snapshot().state, "failed");
    assert.equal(closes, 0);
  });
for (const [mode, reason] of [
  ["no-eof", "BRIDGE_EVIDENCE"],
  ["nonzero", "BRIDGE_EXIT"],
  ["missing-report", "BRIDGE_EVIDENCE"],
  ["exit-hang", "BRIDGE_EXIT_TIMEOUT"],
])
  test(`bridge ${mode} cannot become graceful from host or exit-code alone`, async (t) => {
    const f = await setup(t, mode, 1000);
    await f.supervisor.request("ping", {});
    let closes = 0;
    await assert.rejects(
      f.supervisor.stop(async () => {
        closes++;
        return { code: 0, exit_observed: true, forced: false };
      }),
      new RegExp(reason!),
    );
    assert.equal(closes, 0);
    assert.equal(f.supervisor.snapshot().state, "failed");
  });

test("pending and frame limits reject excess without silently sending or closing the host", async (t) => {
  const f = await setup(t, "hang", 300);
  await assert.rejects(
    f.supervisor.request("ping", { text: "a".repeat(65536) }),
    /BRIDGE_INPUT_LIMIT/,
  );
  assert.equal(f.supervisor.snapshot().pending, 0);
  const calls = Array.from({ length: 64 }, () =>
    f.supervisor.request("ping", {}),
  );
  const checks = calls.map((p) => assert.rejects(p, /BRIDGE_DRAIN_TIMEOUT/));
  await assert.rejects(
    f.supervisor.request("ping", {}),
    /BRIDGE_PENDING_LIMIT/,
  );
  assert.equal(f.supervisor.snapshot().pending, 64);
  await assert.rejects(
    f.supervisor.stop(async () => {
      throw new Error("must not close host");
    }),
    /BRIDGE_DRAIN_TIMEOUT/,
  );
  await Promise.all(checks);
});

test("host timeout remains failed even if the owned host reports success later", async (t) => {
  // Leave normal OS bridge shutdown room; the deliberately unresolved host,
  // not scheduler contention during bridge exit, is the injected fault.
  const f = await setup(t, "real", 3000);
  await f.initialize();
  const entered = deferred(),
    release = deferred();
  const stop = f.supervisor.stop(async () => {
    entered.resolve();
    await release.promise;
    return { code: 0, exit_observed: true, forced: false };
  });
  const rejected = assert.rejects(stop, /HOST_EXIT_TIMEOUT/);
  await Promise.race([entered.promise, rejected]);
  await rejected;
  release.resolve();
  await new Promise((r) => setImmediate(r));
  assert.equal(f.supervisor.snapshot().state, "failed");
  assert.equal(f.supervisor.snapshot().fault, "HOST_EXIT_TIMEOUT");
});

test("unknown host exit remains failed after a genuinely clean bridge exit", async (t) => {
  const f = await setup(t);
  await f.initialize();
  await assert.rejects(
    f.supervisor.stop(async () => ({
      code: null,
      exit_observed: false,
      forced: false,
    })),
    /HOST_EXIT_UNPROVEN/,
  );
  assert.equal(f.child.exitCode, 0);
  assert.equal(f.supervisor.snapshot().state, "failed");
});

test("draining never extends revoked task access or masks tool errors", async (t) => {
  const f = await setup(t);
  await f.initialize();
  f.gate();
  const call = f.task();
  await f.entered.promise;
  f.s.updateGrant({ ...f.g, state: "revoked" });
  const stop = f.supervisor.stop(async () => ({
    code: 0,
    exit_observed: true,
    forced: false,
  }));
  const stopped = assert.rejects(stop, /BRIDGE_EVIDENCE/);
  f.release.resolve();
  assert.equal((await call).isError, true);
  await stopped;
  assert.equal(f.reads(), 0);
  assert.equal(f.supervisor.snapshot().state, "failed");
});
