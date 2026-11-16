// Compiled synthetic user-path acceptance; never launches Desktop or a model.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fixture } from "./helpers.ts";
import { CoreService } from "../dist/packages/service/src/service.js";
import { createServer } from "../dist/packages/service/src/http.js";
import { listenLoopback } from "../dist/packages/service/src/loopback-listener.js";

const output = resolve(
  process.env.CLAUDE_READ_EVIDENCE ??
    ".runtime/claude-read-walkthrough-" + Date.now(),
);
mkdirSync(resolve(output, ".."), { recursive: true });
mkdirSync(output);
const f = fixture();
const service = new CoreService(f.s, f.now);
const server = createServer(service);
await listenLoopback(server);
const config = {
  version: 1,
  target: "claude_desktop",
  service_origin: "http://127.0.0.1:" + server.address().port,
  project_id: f.ids.project,
  token: f.token,
  task_ids: [f.ids.task],
  execution_ids: [f.ids.execution],
  allow_message_poll: false,
  egress: {
    data_class: "synthetic_only",
    provider_fingerprint: "a".repeat(64),
    expires_at: new Date(Date.now() + 120000).toISOString(),
  },
};
const configPath = join(output, "config-local.json");
writeFileSync(configPath, JSON.stringify(config), { flag: "wx" });
const steps = [];

async function connection(index, afterRead) {
  const child = spawn(
    process.execPath,
    [resolve("dist/packages/service/src/mcp-entry.js"), "--config", configPath],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  const responses = new Map();
  let serial = 0,
    stderr = "";
  child.stderr.on("data", (b) => (stderr += b));
  child.stdin.on("error", () => {});
  const ended = new Promise((r) => child.once("close", r));
  const timer = setTimeout(() => child.kill(), 15000);
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const response = JSON.parse(line);
    responses.get(response.id)?.(response);
    responses.delete(response.id);
  });
  const send = (frame) => child.stdin.write(JSON.stringify(frame) + "\n");
  const request = async (method, params) => {
    const id = ++serial;
    const response = new Promise((r) => responses.set(id, r));
    send({ jsonrpc: "2.0", id, method, params });
    return await Promise.race([
      response,
      ended.then(() => {
        throw new Error("CONNECTOR_EXIT_BEFORE_RESPONSE");
      }),
    ]);
  };
  try {
    assert.equal(
      (
        await request("initialize", {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "synthetic-acceptance", version: "1" },
        })
      ).result.protocolVersion,
      "2025-06-18",
    );
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    const tools = await request("tools/list", {});
    assert.deepEqual(
      tools.result.tools.map((t) => t.name),
      ["task_get", "project_progress"],
    );
    const before = f.s.db.prepare("SELECT total_changes() AS n").get().n;
    const task = await request("tools/call", {
      name: "task_get",
      arguments: { task_id: f.ids.task },
    });
    assert.equal(task.result.isError, false);
    assert.equal(JSON.parse(task.result.content[0].text).data.status, "queued");
    for (let i = 0; i < 20; i++) {
      const result = await request("tools/call", {
        name: "project_progress",
        arguments: { plan_execution_id: f.ids.execution },
      });
      assert.equal(result.result.isError, false);
      assert.equal(
        JSON.parse(result.result.content[0].text).data.plan_execution_id,
        f.ids.execution,
      );
    }
    assert.equal(f.s.db.prepare("SELECT total_changes() AS n").get().n, before);
    steps.push({
      step: "connect_read_progress",
      connection: index,
      progress_reads: 20,
      db_mutations: 0,
    });
    await afterRead(request);
    child.stdin.end();
    assert.equal(await ended, 0, stderr);
    assert.equal(stderr, "");
    steps.push({ step: "connector_eof", connection: index, exit_code: 0 });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await ended;
    clearTimeout(timer);
    lines.close();
  }
}
try {
  assert.equal(service.execute(f.token, f.apply()).kind, "service_result");
  await connection(1, async () => {});
  await connection(2, async (request) => {
    f.s.updateGrant({ ...f.g, state: "revoked" });
    const denied = await request("tools/call", {
      name: "task_get",
      arguments: { task_id: f.ids.task },
    });
    assert.equal(denied.result.isError, true);
    assert.equal(denied.result.content[0].text, "MCP_SERVICE_DENIED");
    steps.push({ step: "revoke_after_reconnect", result: "DENIED" });
  });
  const report = {
    status: "COMPILED_SYNTHETIC_WALKTHROUGH_PASS",
    steps,
    native_clients_started: 0,
    model_calls: 0,
    ui_clicks: 0,
    real_client_qualification: "UNVERIFIED",
  };
  writeFileSync(
    join(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx" },
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  f.s.updateGrant({ ...f.g, state: "revoked" });
  config.token = "";
  writeFileSync(configPath, JSON.stringify(config));
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  f.close();
}
