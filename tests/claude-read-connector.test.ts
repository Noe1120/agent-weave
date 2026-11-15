import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "../packages/service/src/http.ts";
import { fixture, id } from "./helpers.ts";
import { McpReadClient } from "../packages/service/src/mcp-read-client.ts";
import { McpSession } from "../packages/service/src/mcp-session.ts";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { ExecutionFeed } from "../packages/service/src/workspace-feed.ts";
import { createServer as stubServer } from "node:http";

async function setup() {
  const f = fixture();
  const server = createServer(f.service);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const config = {
    version: 1,
    target: "claude_desktop",
    service_origin: `http://127.0.0.1:${address.port}`,
    project_id: f.ids.project,
    token: f.token,
    task_ids: [f.ids.task],
    execution_ids: [],
    allow_message_poll: false,
    egress: {
      data_class: "synthetic_only",
      provider_fingerprint: "a".repeat(64),
      expires_at: "2026-11-15T00:00:00Z",
    },
  };
  const client = new McpReadClient(config, f.now);
  const session = new McpSession(client);
  return {
    f,
    config,
    client,
    session,
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      f.close();
    },
  };
}
const frame = (id: number, method: string, params?: unknown) => ({
  jsonrpc: "2.0",
  id,
  method,
  ...(params === undefined ? {} : { params }),
});
async function initialize(session: McpSession) {
  const result = await session.receive(
    frame(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "synthetic-client", version: "1" },
    }),
  );
  assert.equal(result?.result.protocolVersion, "2025-06-18");
  assert.equal(
    await session.receive({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
    null,
  );
}
test("Claude MCP exposes only bounded read tools and calls the real authorized service", async () => {
  const x = await setup();
  try {
    await initialize(x.session);
    const tools = await x.session.receive(frame(2, "tools/list"));
    assert.deepEqual(
      tools?.result.tools.map((t: any) => t.name),
      ["task_get", "project_progress"],
    );
    const result = await x.session.receive(
      frame(3, "tools/call", {
        name: "task_get",
        arguments: { task_id: x.f.ids.task },
      }),
    );
    assert.equal(result?.result.isError, false);
    const data = JSON.parse(result?.result.content[0].text);
    assert.equal(data.resource_type, "task");
    assert.equal(data.data.status, "draft");
    assert.doesNotMatch(JSON.stringify(result), new RegExp(x.f.token));
    const changes = x.f.s.db.prepare("SELECT total_changes() AS n").get()!.n;
    for (let i = 0; i < 20; i++)
      await x.client.call("task_get", { task_id: x.f.ids.task });
    assert.equal(
      x.f.s.db.prepare("SELECT total_changes() AS n").get()!.n,
      changes,
    );
  } finally {
    await x.close();
  }
});
test("MCP authorization is rechecked after revocation, not cached at initialization", async () => {
  const x = await setup();
  try {
    await initialize(x.session);
    x.f.s.updateGrant({ ...x.f.g, state: "revoked" });
    const result = await x.session.receive(
      frame(2, "tools/call", {
        name: "task_get",
        arguments: { task_id: x.f.ids.task },
      }),
    );
    assert.equal(result?.result.isError, true);
    assert.doesNotMatch(JSON.stringify(result), /"status":"draft"/);
  } finally {
    await x.close();
  }
});
test("MCP refuses unbound resources and caller-supplied URL, token, project or author", async () => {
  const x = await setup();
  try {
    for (const args of [
      { task_id: id() },
      { task_id: x.f.ids.task, project_id: id() },
      { task_id: x.f.ids.task, token: x.f.token },
      { task_id: x.f.ids.task, url: "http://evil.invalid" },
      { task_id: x.f.ids.task, author: "owner" },
    ])
      await assert.rejects(
        x.client.call("task_get", args),
        /MCP_SCOPE_DENIED|MCP_ARGUMENTS/,
      );
    await assert.rejects(
      x.client.call("workspace_apply_patch", {}),
      /MCP_TOOL_UNAVAILABLE/,
    );
    await assert.rejects(
      x.client.call("message_poll", { cursor: null, limit: 10 }),
      /MCP_TOOL_UNAVAILABLE/,
    );
  } finally {
    await x.close();
  }
});
test("MCP refuses wrong origin, extra configuration and non-synthetic disclosure", async () => {
  const x = await setup();
  try {
    for (const config of [
      { ...x.config, service_origin: "https://provider.invalid" },
      { ...x.config, service_origin: x.config.service_origin + "/redirect" },
      { ...x.config, service_origin: "http://localhost:4317" },
      { ...x.config, arbitrary_command: "node" },
      { ...x.config, egress: { ...x.config.egress, data_class: "private" } },
      { ...x.config, egress: { ...x.config.egress, expires_at: "invalid" } },
    ])
      assert.throws(() => new McpReadClient(config, x.f.now), /MCP_CONFIG/);
  } finally {
    await x.close();
  }
});
test("MCP disclosure expiry stops reads and discovery without extending itself", async () => {
  const x = await setup();
  try {
    await initialize(x.session);
    x.f.advance(86400000);
    await assert.rejects(
      x.client.call("task_get", { task_id: x.f.ids.task }),
      /MCP_DISCLOSURE_EXPIRED/,
    );
    assert.equal(
      (await x.session.receive(frame(2, "tools/list")))?.error.code,
      -32001,
    );
  } finally {
    await x.close();
  }
});
test("MCP does not bypass dependency ACL just because task id is allowed locally", async () => {
  const x = await setup();
  try {
    const r = x.f.s.getResource(x.f.ids.acceptance)!;
    r.acl = [];
    x.f.s.putResource(r);
    await assert.rejects(
      x.client.call("task_get", { task_id: x.f.ids.task }),
      /MCP_SERVICE_DENIED/,
    );
  } finally {
    await x.close();
  }
});

test("progress uses persisted execution state and repeated reads do not mutate or start work", async () => {
  const x = await setup();
  try {
    const applied = x.f.service.execute(x.f.token, x.f.apply());
    assert.equal(applied.kind, "service_result");
    const client = new McpReadClient(
      { ...x.config, execution_ids: [x.f.ids.execution] },
      x.f.now,
    );
    const before = x.f.s.db.prepare("SELECT total_changes() AS n").get()!.n;
    const first: any = await client.call("project_progress", {
      plan_execution_id: x.f.ids.execution,
    });
    assert.equal(first.operation, "get_plan_progress");
    for (let i = 0; i < 20; i++) {
      const next: any = await client.call("project_progress", {
        plan_execution_id: x.f.ids.execution,
      });
      assert.deepEqual(next.data, first.data);
    }
    assert.equal(
      x.f.s.db.prepare("SELECT total_changes() AS n").get()!.n,
      before,
    );
  } finally {
    await x.close();
  }
});

test("message polling keeps grant-bound pagination and refuses revoked member", async () => {
  const x = await setup();
  try {
    const channel = id();
    const s = x.f.s;
    s.db
      .prepare("INSERT INTO workspace_projects VALUES(?,?,?,?,?,?)")
      .run(
        x.f.ids.project,
        "synthetic",
        "",
        channel,
        "1",
        new Date(x.f.now()).toISOString(),
      );
    s.db
      .prepare("INSERT INTO workspace_members VALUES(?,?,?,?,?,?,?,?)")
      .run(
        x.f.ids.member,
        x.f.ids.project,
        "claude_desktop",
        "Claude acceptance",
        "",
        "active",
        "1",
        new Date(x.f.now()).toISOString(),
      );
    s.putResource({
      id: channel,
      project_id: x.f.ids.project,
      kind: "channel",
      revision: "1",
      domain: x.f.g.domain,
      acl: [x.f.g.id],
      dependencies: [],
      data: { audience: "public", recipient_id: null },
    });
    x.f.p.actions.push("read_feed");
    x.f.p.resource_ids.push(channel);
    s.putPolicy(x.f.p);
    x.f.g.actions.push("read_feed");
    x.f.g.resource_ids.push(channel);
    s.updateGrant(x.f.g);
    new ExecutionFeed(s, x.f.now).bind(x.f.g.id, channel);
    for (let n = 1; n <= 2; n++) {
      const message = id();
      s.db
        .prepare(
          "INSERT INTO workspace_messages(id,project_id,channel_id,body,audience,recipient_id,created_at) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          message,
          x.f.ids.project,
          channel,
          "synthetic-" + n,
          "public",
          null,
          new Date(x.f.now()).toISOString(),
        );
      s.db
        .prepare("INSERT INTO message_deliveries VALUES(?,?,?)")
        .run(x.f.g.id, n, message);
    }
    const client = new McpReadClient(
      { ...x.config, allow_message_poll: true },
      x.f.now,
    );
    assert.equal(client.tools().at(-1)!.name, "message_poll");
    const before = s.db.prepare("SELECT total_changes() AS n").get()!.n;
    const first: any = await client.call("message_poll", {
      cursor: null,
      limit: 1,
    });
    assert.equal(first.items[0].body, "synthetic-1");
    const next: any = await client.call("message_poll", {
      cursor: first.next_cursor,
      limit: 1,
    });
    assert.equal(next.items[0].body, "synthetic-2");
    assert.equal(s.db.prepare("SELECT total_changes() AS n").get()!.n, before);
    await assert.rejects(
      client.call("message_poll", { cursor: "wrong", limit: 1 }),
      /MCP_SERVICE_DENIED/,
    );
    s.db
      .prepare("UPDATE workspace_members SET state='inactive' WHERE id=?")
      .run(x.f.ids.member);
    await assert.rejects(
      client.call("message_poll", { cursor: null, limit: 1 }),
      /MCP_SERVICE_DENIED/,
    );
  } finally {
    await x.close();
  }
});
test("MCP rejects early calls, duplicate initialize and unsupported operations", async () => {
  const x = await setup();
  try {
    assert.equal(
      (await x.session.receive(frame(1, "tools/list")))?.error.code,
      -32002,
    );
    await initialize(x.session);
    assert.equal(
      (await x.session.receive(frame(3, "initialize", {})))?.error.code,
      -32600,
    );
    assert.equal(
      (
        await x.session.receive(
          frame(4, "sampling/createMessage", { secret: "do-not-echo" }),
        )
      )?.error.code,
      -32601,
    );
    for (const method of ["resources/list", "prompts/list"])
      assert.deepEqual((await x.session.receive(frame(5, method)))?.result, {
        [method.split("/")[0]!]: [],
      });
    const reply = await x.session.receive(
      frame(6, "tools/call", {
        name: "task_get",
        arguments: { task_id: "private-secret" },
      }),
    );
    assert.equal(reply?.result.isError, true);
    assert.doesNotMatch(JSON.stringify(reply), /private-secret/);
  } finally {
    await x.close();
  }
});

test("connector rejects malformed or extra feed fields instead of disclosing raw upstream JSON", async () => {
  const x = await setup();
  const stub = stubServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        contract_version: "feed/0.1",
        items: [{ body: "secret-invalid-item" }],
        next_cursor: "cursor",
        untrusted_field: "secret-extra-field",
      }),
    );
  });
  await new Promise<void>((r) => stub.listen(0, "127.0.0.1", r));
  try {
    const a = stub.address();
    assert.ok(a && typeof a !== "string");
    const client = new McpReadClient(
      {
        ...x.config,
        service_origin: `http://127.0.0.1:${a.port}`,
        allow_message_poll: true,
      },
      x.f.now,
    );
    await assert.rejects(
      client.call("message_poll", { cursor: null, limit: 1 }),
      /MCP_SERVICE_RESPONSE/,
    );
  } finally {
    await new Promise<void>((r) => stub.close(() => r()));
    await x.close();
  }
});
test("connector refuses redirects without forwarding its grant to another destination", async () => {
  const x = await setup();
  let calls = 0;
  const receiver = stubServer((_req, res) => {
    calls++;
    res.end("{}");
  });
  await new Promise<void>((r) => receiver.listen(0, "127.0.0.1", r));
  const a = receiver.address();
  assert.ok(a && typeof a !== "string");
  const redirect = stubServer((_req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${a.port}/leak` });
    res.end();
  });
  await new Promise<void>((r) => redirect.listen(0, "127.0.0.1", r));
  try {
    const b = redirect.address();
    assert.ok(b && typeof b !== "string");
    const client = new McpReadClient(
      { ...x.config, service_origin: `http://127.0.0.1:${b.port}` },
      x.f.now,
    );
    await assert.rejects(
      client.call("task_get", { task_id: x.f.ids.task }),
      /MCP_SERVICE_UNAVAILABLE/,
    );
    assert.equal(calls, 0);
  } finally {
    await new Promise<void>((r) => redirect.close(() => r()));
    await new Promise<void>((r) => receiver.close(() => r()));
    await x.close();
  }
});

async function entry(config: unknown, bytes: string | Buffer) {
  const root = await mkdtemp(join(tmpdir(), "team-claude-read-entry-"));
  const configPath = join(root, "config.json"),
    reportPath = join(root, "report.json");
  await writeFile(configPath, JSON.stringify(config));
  const child = spawn(
    process.execPath,
    [
      resolve("packages/service/src/mcp-entry.ts"),
      "--config",
      configPath,
      "--report",
      reportPath,
    ],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (b) => (stdout += b));
  child.stderr.on("data", (b) => (stderr += b));
  const ended = new Promise<number | null>((r) => child.once("close", r));
  child.stdin.on("error", () => {});
  child.stdin.end(bytes);
  const timer = setTimeout(() => child.kill(), 10000);
  const code = await ended;
  clearTimeout(timer);
  return {
    code,
    stdout,
    stderr,
    report: JSON.parse(await readFile(reportPath, "utf8")),
  };
}
const init = frame(1, "initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "synthetic", version: "1" },
});
test("stdio connector handles real HTTP tool read followed by EOF with safe diagnostics", async () => {
  const x = await setup();
  try {
    x.config.egress.expires_at = new Date(Date.now() + 60000).toISOString();
    const r = await entry(
      x.config,
      [
        init,
        { jsonrpc: "2.0", method: "notifications/initialized" },
        frame(2, "tools/list"),
        frame(3, "tools/call", {
          name: "task_get",
          arguments: { task_id: x.f.ids.task },
        }),
      ]
        .map((f) => JSON.stringify(f) + "\n")
        .join(""),
    );
    assert.equal(r.code, 0, r.stderr);
    const frames = r.stdout
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
    assert.equal(frames.at(-1).result.isError, false);
    assert.equal(r.report.tool_calls, 1);
    assert.equal(r.report.stdin_eof, true);
    assert.equal(r.report.fault, null);
    assert.doesNotMatch(
      JSON.stringify(r.report) + r.stderr,
      new RegExp(x.f.token),
    );
  } finally {
    await x.close();
  }
});
for (const [name, bytes] of [
  ["invalid JSON", "{bad\n"],
  ["oversized frame", "x".repeat(65537)],
  ["truncated JSON", '{"jsonrpc":'],
  ["invalid UTF8", Buffer.from([255, 10])],
] as const)
  test("stdio connector visibly rejects " + name, async () => {
    const x = await setup();
    try {
      const r = await entry(x.config, bytes);
      assert.equal(r.code, 1);
      assert.match(r.report.fault, /MCP_/);
      assert.doesNotMatch(r.stderr, new RegExp(x.f.token));
    } finally {
      await x.close();
    }
  });
