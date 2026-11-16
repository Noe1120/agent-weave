import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "../packages/service/src/http.ts";
import { fixture } from "./helpers.ts";
import {
  McpReadClient,
  mcpTargets,
} from "../packages/service/src/mcp-read-client.ts";
import { McpSession } from "../packages/service/src/mcp-session.ts";
import { listenLoopback } from "../packages/service/src/loopback-listener.ts";

// The same fixed-scope read bridge, now explicitly labelled for the Codex
// original client. The target is validated, never inferred or reported as another
// client's identity.
async function setup(target: string = "codex") {
  const f = fixture();
  const server = createServer(f.service);
  await listenLoopback(server);
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const config = {
    version: 1,
    target,
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
  const build = (patch: Record<string, unknown> = {}) => {
    const client = new McpReadClient({ ...config, ...patch }, f.now);
    return { client, session: new McpSession(client) };
  };
  return {
    f,
    config,
    build,
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
      clientInfo: { name: "synthetic-codex-client", version: "1" },
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
test("the codex target is accepted and exposes the same bounded read tools", async () => {
  const x = await setup("codex");
  try {
    const { client, session } = x.build();
    assert.equal(client.target, "codex");
    assert.equal(session.stats.target, "codex");
    await initialize(session);
    const tools = await session.receive(frame(2, "tools/list"));
    assert.deepEqual(
      tools?.result.tools.map((t: any) => t.name),
      ["task_get", "project_progress"],
    );
    const result = await session.receive(
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
  } finally {
    await x.close();
  }
});
test("every other target value is refused instead of being relabelled", async () => {
  const x = await setup("claude_desktop");
  try {
    assert.deepEqual([...mcpTargets], ["claude_desktop", "codex"]);
    for (const target of [
      "deepseek_harness",
      "codex_cli",
      "Codex",
      "",
      "claude",
      "cursor",
    ])
      assert.throws(() => x.build({ target }), /MCP_CONFIG/, target);
    assert.throws(
      () => new McpReadClient({ ...x.config, target: undefined }, x.f.now),
      /MCP_CONFIG/,
    );
    assert.throws(
      () => new McpReadClient({ ...x.config, target: 1 }, x.f.now),
      /MCP_CONFIG/,
    );
    // The previous client's configuration still works unchanged.
    const claude = x.build();
    assert.equal(claude.client.target, "claude_desktop");
    assert.equal(claude.session.stats.target, "claude_desktop");
  } finally {
    await x.close();
  }
});
test("codex target keeps scope, revocation and disclosure checks", async () => {
  const x = await setup("codex");
  try {
    const { session } = x.build();
    await initialize(session);
    const denied = await session.receive(
      frame(4, "tools/call", {
        name: "task_get",
        arguments: { task_id: "00000000-0000-4000-8000-000000000000" },
      }),
    );
    assert.equal(denied?.result.isError, true);
    assert.match(denied?.result.content[0].text, /MCP_SCOPE_DENIED/);
    const unknown = await session.receive(
      frame(5, "tools/call", { name: "turn_start", arguments: {} }),
    );
    assert.equal(unknown?.result.isError, true);
    assert.match(unknown?.result.content[0].text, /MCP_TOOL_UNAVAILABLE/);
    x.f.s.updateGrant({ ...x.f.g, state: "revoked" });
    const revoked = await session.receive(
      frame(6, "tools/call", {
        name: "task_get",
        arguments: { task_id: x.f.ids.task },
      }),
    );
    assert.equal(revoked?.result.isError, true);
    assert.doesNotMatch(JSON.stringify(revoked), /"status":"draft"/);
  } finally {
    await x.close();
  }
});
test("an expired disclosure stops codex discovery and reads", async () => {
  const x = await setup("codex");
  try {
    let now = Date.parse("2026-11-14T09:00:00Z");
    const expired = new McpReadClient(x.config, () => now);
    assert.doesNotThrow(() => expired.tools());
    now = Date.parse("2026-11-16T00:00:00Z");
    assert.throws(() => expired.tools(), /MCP_DISCLOSURE_EXPIRED/);
  } finally {
    await x.close();
  }
});
