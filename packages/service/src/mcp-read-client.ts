import { randomUUID } from "node:crypto";
import { uuid } from "./adapter-contract.ts";
import { validateCore, validateResource } from "../../contracts/src/index.ts";

interface Config {
  version: 1;
  target: "claude_desktop" | "codex";
  service_origin: string;
  project_id: string;
  token: string;
  task_ids: string[];
  execution_ids: string[];
  allow_message_poll: boolean;
  egress: {
    data_class: "synthetic_only";
    provider_fingerprint: string;
    expires_at: string;
  };
}
/** Each original client keeps its own configuration and evidence, never a shared identity. */
export const mcpTargets = ["claude_desktop", "codex"] as const;
function record(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function keys(v: Record<string, unknown>, expected: string[]) {
  return (
    Object.keys(v).length === expected.length &&
    expected.every((k) => Object.hasOwn(v, k))
  );
}
const ids = (v: unknown): v is string[] =>
  Array.isArray(v) &&
  v.length <= 100 &&
  new Set(v).size === v.length &&
  v.every(uuid);
export class McpReadClient {
  private readonly config: Config;
  private readonly now: () => number;
  /** The original client this connection is configured for; never inferred. */
  readonly target: Config["target"];
  constructor(config: unknown, now: () => number = Date.now) {
    if (
      !record(config) ||
      !keys(config, [
        "version",
        "target",
        "service_origin",
        "project_id",
        "token",
        "task_ids",
        "execution_ids",
        "allow_message_poll",
        "egress",
      ]) ||
      config.version !== 1 ||
      !mcpTargets.includes(config.target as (typeof mcpTargets)[number]) ||
      typeof config.service_origin !== "string" ||
      !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(config.service_origin) ||
      Number(config.service_origin.split(":").at(-1)) > 65535 ||
      !uuid(config.project_id) ||
      typeof config.token !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(config.token) ||
      !ids(config.task_ids) ||
      !ids(config.execution_ids) ||
      typeof config.allow_message_poll !== "boolean" ||
      !record(config.egress) ||
      !keys(config.egress, [
        "data_class",
        "provider_fingerprint",
        "expires_at",
      ]) ||
      config.egress.data_class !== "synthetic_only" ||
      typeof config.egress.provider_fingerprint !== "string" ||
      !/^[a-f0-9]{64}$/.test(config.egress.provider_fingerprint) ||
      typeof config.egress.expires_at !== "string" ||
      !Number.isFinite(Date.parse(config.egress.expires_at))
    )
      throw new Error("MCP_CONFIG");
    this.config = structuredClone(config) as unknown as Config;
    this.target = this.config.target;
    this.now = now;
  }
  checkDisclosure() {
    if (Date.parse(this.config.egress.expires_at) <= this.now())
      throw new Error("MCP_DISCLOSURE_EXPIRED");
  }
  tools() {
    this.checkDisclosure();
    const schema = (
      properties: Record<string, unknown>,
      required: string[],
    ) => ({
      type: "object",
      properties,
      required,
      additionalProperties: false,
    });
    const tool = (name: string, description: string, inputSchema: unknown) => ({
      name,
      description,
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    });
    return [
      tool(
        "task_get",
        "Read a task in this connector's fixed synthetic acceptance scope.",
        schema({ task_id: { type: "string", format: "uuid" } }, ["task_id"]),
      ),
      tool(
        "project_progress",
        "Read persisted plan progress; never prompt, resume or interrupt an agent.",
        schema({ plan_execution_id: { type: "string", format: "uuid" } }, [
          "plan_execution_id",
        ]),
      ),
      ...(this.config.allow_message_poll
        ? [
            tool(
              "message_poll",
              "Read the current execution grant's ordinary-message feed; not an input reply or approval.",
              schema(
                {
                  cursor: { type: ["string", "null"], maxLength: 2048 },
                  limit: { type: "integer", minimum: 1, maximum: 50 },
                },
                ["cursor", "limit"],
              ),
            ),
          ]
        : []),
    ];
  }
  async call(name: string, args: unknown): Promise<unknown> {
    this.checkDisclosure();
    if (!this.tools().some((t) => t.name === name))
      throw new Error("MCP_TOOL_UNAVAILABLE");
    if (!record(args)) throw new Error("MCP_ARGUMENTS");
    const c = this.config;
    let path: string, body: unknown;
    if (name === "task_get") {
      if (!keys(args, ["task_id"]) || !uuid(args.task_id))
        throw new Error("MCP_ARGUMENTS");
      if (!c.task_ids.includes(args.task_id))
        throw new Error("MCP_SCOPE_DENIED");
      path = `/v1/projects/${c.project_id}/task/${args.task_id}`;
    } else if (name === "project_progress") {
      if (!keys(args, ["plan_execution_id"]) || !uuid(args.plan_execution_id))
        throw new Error("MCP_ARGUMENTS");
      if (!c.execution_ids.includes(args.plan_execution_id))
        throw new Error("MCP_SCOPE_DENIED");
      path = "/v1/core/get_plan_progress";
      body = {
        contract_version: "core/1.0",
        kind: "get_plan_progress",
        request_id: randomUUID(),
        project_id: c.project_id,
        plan_execution_id: args.plan_execution_id,
      };
    } else {
      if (
        !keys(args, ["cursor", "limit"]) ||
        !(
          args.cursor === null ||
          (typeof args.cursor === "string" && args.cursor.length <= 2048)
        ) ||
        !Number.isInteger(args.limit) ||
        Number(args.limit) < 1 ||
        Number(args.limit) > 50
      )
        throw new Error("MCP_ARGUMENTS");
      path = "/v1/feed";
      body = { project_id: c.project_id, ...args };
    }
    let response: Response;
    try {
      response = await fetch(c.service_origin + path, {
        method: body ? "POST" : "GET",
        headers: {
          authorization: "Bearer " + c.token,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new Error("MCP_SERVICE_UNAVAILABLE");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("MCP_SERVICE_DENIED");
    }
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      if (
        !response.body ||
        !response.headers.get("content-type")?.startsWith("application/json")
      )
        throw new Error();
      for await (const chunk of response.body) {
        length += chunk.length;
        if (length > 65536) throw new Error();
        chunks.push(chunk);
      }
    } catch {
      throw new Error("MCP_SERVICE_RESPONSE");
    }
    let result: unknown;
    try {
      result = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
      );
    } catch {
      throw new Error("MCP_SERVICE_RESPONSE");
    }
    if (name === "task_get") {
      if (
        !validateResource(result) ||
        !record(result) ||
        result.project_id !== c.project_id ||
        result.resource_type !== "task" ||
        !record(result.ref) ||
        result.ref.id !== args.task_id
      )
        throw new Error("MCP_SERVICE_RESPONSE");
    } else if (name === "project_progress") {
      if (
        !validateCore(result) ||
        !record(result) ||
        result.kind !== "service_result" ||
        result.project_id !== c.project_id ||
        result.operation !== "get_plan_progress" ||
        !record(result.data) ||
        result.data.plan_execution_id !== args.plan_execution_id
      )
        throw new Error("MCP_SERVICE_RESPONSE");
    } else if (
      !record(result) ||
      !keys(result, ["contract_version", "items", "next_cursor"]) ||
      result.contract_version !== "feed/0.1" ||
      !Array.isArray(result.items) ||
      result.items.length > Number(args.limit) ||
      typeof result.next_cursor !== "string" ||
      result.next_cursor.length > 2048 ||
      !result.items.every(
        (item) =>
          record(item) &&
          keys(item, [
            "id",
            "body",
            "audience",
            "recipient_id",
            "created_at",
            "input_kind",
            "dispatch_state",
          ]) &&
          uuid(item.id) &&
          typeof item.body === "string" &&
          item.body.length <= 20000 &&
          ["public", "direct"].includes(String(item.audience)) &&
          (item.audience === "public"
            ? item.recipient_id === null
            : uuid(item.recipient_id)) &&
          typeof item.created_at === "string" &&
          Number.isFinite(Date.parse(item.created_at)) &&
          item.input_kind === "ordinary_instruction" &&
          item.dispatch_state === "not_dispatched",
      )
    )
      throw new Error("MCP_SERVICE_RESPONSE");
    this.checkDisclosure();
    return result;
  }
}
