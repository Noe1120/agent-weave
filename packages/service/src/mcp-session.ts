import type { McpReadClient } from "./mcp-read-client.ts";
export class McpSession {
  private readonly client: McpReadClient;
  private state: "new" | "initializing" | "ready" = "new";
  readonly stats = {
    initialize_requests: 0,
    initialized: false,
    tools_list_requests: 0,
    tool_calls: 0,
    tool_errors: 0,
    resources_list_requests: 0,
    prompts_list_requests: 0,
  };
  constructor(client: McpReadClient) {
    this.client = client;
  }
  async receive(value: unknown): Promise<any> {
    const f = value as Record<string, any>;
    const validId = (id: unknown) =>
      Number.isSafeInteger(id) || (typeof id === "string" && id.length <= 128);
    const error = (code: number, message: string) => ({
      jsonrpc: "2.0",
      id: validId(f?.id) ? f.id : null,
      error: { code, message },
    });
    const ok = (result: unknown) => ({ jsonrpc: "2.0", id: f.id, result });
    if (
      !f ||
      typeof f !== "object" ||
      Array.isArray(f) ||
      f.jsonrpc !== "2.0" ||
      typeof f.method !== "string" ||
      "result" in f ||
      "error" in f
    )
      return error(-32600, "Invalid Request");
    if (f.id === undefined) {
      if (
        f.method === "notifications/initialized" &&
        this.state === "initializing"
      ) {
        this.state = "ready";
        this.stats.initialized = true;
        return null;
      }
      if (f.method === "notifications/cancelled") return null; // Bounded reads have no state-changing side effects.
      throw new Error("MCP_NOTIFICATION_INVALID");
    }
    if (!validId(f.id)) return error(-32600, "Invalid Request");
    if (f.method === "ping") return ok({});
    if (f.method === "initialize") {
      if (this.state !== "new") return error(-32600, "Already initialized");
      const p = f.params;
      if (
        !p ||
        typeof p !== "object" ||
        typeof p.protocolVersion !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(p.protocolVersion) ||
        !p.capabilities ||
        typeof p.capabilities !== "object" ||
        Array.isArray(p.capabilities) ||
        typeof p.clientInfo?.name !== "string" ||
        typeof p.clientInfo?.version !== "string"
      )
        return error(-32602, "Invalid params");
      this.state = "initializing";
      this.stats.initialize_requests++;
      return ok({
        protocolVersion: ["2024-11-05", "2025-03-26", "2025-06-18"].includes(
          p.protocolVersion,
        )
          ? p.protocolVersion
          : "2025-06-18",
        capabilities: { tools: {}, resources: {}, prompts: {} },
        serverInfo: { name: "agent-weave-read-connector", version: "0.1.0" },
      });
    }
    if (this.state !== "ready") return error(-32002, "Not initialized");
    if (f.method === "tools/list") {
      try {
        const tools = this.client.tools();
        this.stats.tools_list_requests++;
        return ok({ tools });
      } catch {
        return error(-32001, "Disclosure authorization expired");
      }
    }
    if (f.method === "resources/list") {
      this.stats.resources_list_requests++;
      return ok({ resources: [] });
    }
    if (f.method === "resources/templates/list")
      return ok({ resourceTemplates: [] });
    if (f.method === "prompts/list") {
      this.stats.prompts_list_requests++;
      return ok({ prompts: [] });
    }
    if (f.method !== "tools/call") return error(-32601, "Method not found");
    this.stats.tool_calls++;
    try {
      if (
        !f.params ||
        typeof f.params !== "object" ||
        typeof f.params.name !== "string" ||
        Object.keys(f.params).some(
          (k) => !["name", "arguments", "_meta"].includes(k),
        )
      )
        throw new Error("MCP_ARGUMENTS");
      const result = await this.client.call(f.params.name, f.params.arguments);
      return ok({
        content: [{ type: "text", text: JSON.stringify(result) }],
        isError: false,
      });
    } catch (e) {
      this.stats.tool_errors++;
      const message =
        e instanceof Error && /^MCP_[A-Z_]+$/.test(e.message)
          ? e.message
          : "MCP_INTERNAL";
      return ok({ content: [{ type: "text", text: message }], isError: true });
    }
  }
}
