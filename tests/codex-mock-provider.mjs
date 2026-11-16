// Local, zero-cost Responses-API stub used only by the opt-in Codex acceptance run.
//
// It is a MODEL stub, not a client or platform stub: the real codex.exe,
// app-server protocol, real MCP stdio bridge and the real platform HTTP service
// all stay in the loop. It exists so the acceptance run can observe one native
// tool call without any provider credentials, network egress or model billing.
//
// Usage: node tests/codex-mock-provider.mjs <port-file> <state-file>
//   Writes "PORT=<port>" to <port-file> once listening and appends one JSON line
//   per request to <state-file>.
import { createServer } from "node:http";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";

const portFile = process.argv[2];
const stateFile = process.argv[3];
if (!portFile || !stateFile) {
  process.stderr.write(
    "usage: codex-mock-provider.mjs <port-file> <state-file>\n",
  );
  process.exit(64);
}
const requests = [];
const log = (entry) => appendFileSync(stateFile, JSON.stringify(entry) + "\n");

function sse(response, events) {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  for (const [name, data] of events)
    response.write(
      "event: " + name + "\ndata: " + JSON.stringify(data) + "\n\n",
    );
  response.end();
}
const base = () => ({
  id: "resp_" + Math.random().toString(36).slice(2, 10),
  object: "response",
  created_at: Math.floor(Date.now() / 1000),
  model: "agent-weave-mock",
});

/**
 * Codex advertises each MCP server as one namespace tool
 * ({type:"namespace", name:"mcp__server", tools:[{type:"function", name:"tool"}]}).
 * The callable identifier is resolved from that shape, never hard-coded.
 */
const strategy = process.env.MOCK_TOOL_STRATEGY ?? "namespaced";
function pickTool(tools) {
  if (!Array.isArray(tools)) return null;
  for (const tool of tools) {
    if (!tool || typeof tool.name !== "string") continue;
    if (tool.type === "namespace" && Array.isArray(tool.tools)) {
      const inner = tool.tools.find(
        (t) => t && /task_get/.test(String(t.name)) && t.type === "function",
      );
      if (inner)
        return {
          name: tool.name,
          namespace: tool.name,
          inner: inner.name,
          flat: tool.name + "__" + inner.name,
        };
    }
    if (/task_get/.test(tool.name))
      return { name: tool.name, namespace: null, inner: null, flat: tool.name };
  }
  return null;
}
function toolOutputs(input) {
  if (!Array.isArray(input)) return [];
  return input.filter(
    (item) =>
      item &&
      (item.type === "function_call_output" || item.type === "mcp_call_output"),
  );
}

function toolCallStream(tool, taskId, response) {
  const item =
    strategy === "namespaced"
      ? {
          type: "function_call",
          id: "fc_1",
          call_id: "call_1",
          namespace: tool.namespace,
          name: tool.inner,
          arguments: "",
          status: "in_progress",
        }
      : strategy === "dotted"
        ? {
            type: "function_call",
            id: "fc_1",
            call_id: "call_1",
            name: tool.name + "." + tool.inner,
            arguments: "",
            status: "in_progress",
          }
        : {
            type: "function_call",
            id: "fc_1",
            call_id: "call_1",
            name: tool.flat,
            arguments: "",
            status: "in_progress",
          };
  const args = JSON.stringify({ task_id: taskId });
  const done = { ...item, arguments: args, status: "completed" };
  sse(response, [
    [
      "response.created",
      {
        type: "response.created",
        response: { ...base(), status: "in_progress", output: [] },
      },
    ],
    [
      "response.output_item.added",
      { type: "response.output_item.added", output_index: 0, item },
    ],
    [
      "response.function_call_arguments.delta",
      {
        type: "response.function_call_arguments.delta",
        item_id: "fc_1",
        output_index: 0,
        delta: args,
      },
    ],
    [
      "response.function_call_arguments.done",
      {
        type: "response.function_call_arguments.done",
        item_id: "fc_1",
        output_index: 0,
        arguments: args,
      },
    ],
    [
      "response.output_item.done",
      { type: "response.output_item.done", output_index: 0, item: done },
    ],
    [
      "response.completed",
      {
        type: "response.completed",
        response: {
          ...base(),
          status: "completed",
          output: [done],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        },
      },
    ],
  ]);
}

function messageStream(text, response) {
  const item = {
    type: "message",
    id: "msg_1",
    role: "assistant",
    status: "completed",
    content: [],
  };
  const part = { type: "output_text", text, annotations: [] };
  const done = { ...item, content: [part] };
  sse(response, [
    [
      "response.created",
      {
        type: "response.created",
        response: { ...base(), status: "in_progress", output: [] },
      },
    ],
    [
      "response.output_item.added",
      { type: "response.output_item.added", output_index: 0, item },
    ],
    [
      "response.content_part.added",
      {
        type: "response.content_part.added",
        item_id: "msg_1",
        output_index: 0,
        content_index: 0,
        part: { ...part, text: "" },
      },
    ],
    [
      "response.output_text.delta",
      {
        type: "response.output_text.delta",
        item_id: "msg_1",
        output_index: 0,
        content_index: 0,
        delta: text,
      },
    ],
    [
      "response.output_text.done",
      {
        type: "response.output_text.done",
        item_id: "msg_1",
        output_index: 0,
        content_index: 0,
        text,
      },
    ],
    [
      "response.output_item.done",
      { type: "response.output_item.done", output_index: 0, item: done },
    ],
    [
      "response.completed",
      {
        type: "response.completed",
        response: {
          ...base(),
          status: "completed",
          output: [done],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        },
      },
    ],
  ]);
}

const server = createServer((request, response) => {
  const chunks = [];
  request.on("data", (c) => chunks.push(c));
  request.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    if (request.method === "GET" && request.url?.endsWith("/models")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          object: "list",
          data: [{ id: "agent-weave-mock", object: "model" }],
        }),
      );
      return;
    }
    appendFileSync(
      stateFile + ".access",
      JSON.stringify({ method: request.method, url: request.url }) + "\n",
    );
    if (
      request.method !== "POST" ||
      !(request.url ?? "").includes("/responses")
    ) {
      response.writeHead(404).end();
      return;
    }
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      response.writeHead(400).end();
      return;
    }
    const tools = body.tools;
    const outputs = toolOutputs(body.input);
    if (
      process.env.MOCK_DUMP_TOOLS === "1" &&
      !existsSync(stateFile + ".tools.json")
    )
      writeFileSync(
        stateFile + ".tools.json",
        JSON.stringify(tools, null, 2),
        "utf8",
      );
    const entry = {
      at: new Date().toISOString(),
      stream: body.stream === true,
      tool_names: Array.isArray(tools)
        ? tools.map((t) => t?.name).filter(Boolean)
        : [],
      tool_outputs: outputs.length,
      input_items: Array.isArray(body.input) ? body.input.length : 0,
    };
    requests.push(entry);
    try {
      if (outputs.length === 0) {
        const tool = pickTool(tools);
        if (!tool) {
          log({ ...entry, result: "no task_get tool advertised" });
          messageStream("no platform tool was advertised", response);
          return;
        }
        // The task id comes from the client's own instruction text, never invented.
        const flat = (value) => {
          if (typeof value === "string") return value;
          if (Array.isArray(value)) return value.map(flat).join(" ");
          if (value && typeof value === "object")
            return Object.values(value).map(flat).join(" ");
          return "";
        };
        const text = flat(body.input);
        // Tolerate every wording the platform may use: task_id <uuid>,
        // task_id: "<uuid>", "task_id": "<uuid>".
        const match =
          text.match(
            /task_id[^0-9a-f]{0,8}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
          ) ??
          text.match(
            /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
          );
        log({
          ...entry,
          result: "tool_call",
          tool: tool.name,
          call_name:
            strategy === "namespaced"
              ? tool.namespace + "/" + tool.inner
              : strategy === "dotted"
                ? tool.name + "." + tool.inner
                : tool.flat,
          task_id: match ? match[1] : null,
        });
        toolCallStream(
          tool,
          match
            ? (match[1] ?? match[0])
            : "00000000-0000-4000-8000-000000000000",
          response,
        );
        return;
      }
      // Second round: echo what the real bridge returned.
      const collect = (value, found = []) => {
        if (typeof value === "string") found.push(value);
        else if (Array.isArray(value)) value.forEach((v) => collect(v, found));
        else if (value && typeof value === "object")
          Object.values(value).forEach((v) => collect(v, found));
        return found;
      };
      let reply = "tool result unreadable";
      for (const candidate of collect(outputs[outputs.length - 1].output)) {
        try {
          const parsed = JSON.parse(candidate);
          if (parsed && parsed.ref && parsed.ref.id && parsed.data)
            reply = "task " + parsed.ref.id + " status " + parsed.data.status;
        } catch {}
      }
      log({ ...entry, result: "final_message", reply });
      messageStream(reply, response);
    } catch (error) {
      log({ ...entry, result: "error", message: String(error) });
      response.writeHead(500).end();
    }
  });
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  writeFileSync(portFile, "PORT=" + address.port + "\n", { flag: "w" });
  process.stdout.write("PORT=" + address.port + "\n");
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
