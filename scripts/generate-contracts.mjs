import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = async (p) => JSON.parse(await readFile(resolve(root, p), "utf8"));
const core = await read("plan/contracts/core.schema.json");
const resources = await read("plan/contracts/resource.schema.json");
const workspace = await read("plan/contracts/workspace.schema.json");
const workspaceBindings = await read("plan/contracts/workspace-bindings.json");
const bindings = await read("plan/contracts/transport-bindings.json");
const errors = await read("plan/contracts/error-mapping.json");
const outputs = new Map();
const json = (v) => JSON.stringify(v, null, 2) + "\n";
const banner = "/* Generated from plan/contracts. Do not edit. */";
for (const [name, schema] of [
  ["core", core],
  ["resources", resources],
  ["workspace", workspace],
]) {
  const renamed = {
    ...schema,
    title:
      name === "core"
        ? "CoreWire"
        : name === "workspace"
          ? "WorkspaceCommand"
          : "ResourceResult",
  };
  outputs.set(
    "packages/contracts/src/generated/" + name + ".ts",
    await compile(renamed, renamed.title, {
      bannerComment: banner,
      unreachableDefinitions: true,
      additionalProperties: false,
      format: true,
    }),
  );
  outputs.set(
    "packages/contracts/src/generated/" + name + ".schema.json",
    json(schema),
  );
}
outputs.set(
  "packages/contracts/src/generated/error-mapping.json",
  json(errors),
);
outputs.set(
  "packages/contracts/src/generated/transport-bindings.json",
  json(bindings),
);
const schemas = {};
function relocate(value, prefix) {
  if (Array.isArray(value)) return value.map((v) => relocate(v, prefix));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !["$id", "$schema"].includes(k))
        .map(([k, v]) => [
          k,
          k === "$ref" && v.startsWith("#/$defs/")
            ? "#/components/schemas/" + prefix + v.slice(8)
            : relocate(v, prefix),
        ]),
    );
  return value;
}
for (const [k, v] of Object.entries(core.$defs))
  schemas["core_" + k] = relocate(v, "core_");
for (const [k, v] of Object.entries(resources.$defs))
  schemas["resource_" + k] = relocate(v, "resource_");
schemas.ResourceResult = relocate(resources, "resource_");
schemas.TransportError = {
  type: "object",
  properties: {
    kind: { const: "transport_error" },
    code: { type: "string", enum: Object.values(bindings.transport_errors) },
  },
  required: ["kind", "code"],
  additionalProperties: false,
};
const response = (description, name) => ({
  description,
  content: {
    "application/json": { schema: { $ref: "#/components/schemas/" + name } },
  },
});
const transport = () =>
  Object.fromEntries(
    Object.entries(bindings.transport_errors).map(([status, code]) => [
      status,
      response(code, "TransportError"),
    ]),
  );
const paths = {};
for (const b of bindings.core) {
  const responses = {
    ...transport(),
    200: response("Operation-specific core result", "core_service_result"),
  };
  schemas["result_" + b.operation] = relocate(
    core.$defs.service_result.oneOf.find(
      (s) => s.properties.operation.const === b.operation,
    ),
    "core_",
  );
  responses[200] = response(
    "Validated " + b.operation + " result",
    "result_" + b.operation,
  );
  for (const status of new Set(
    Object.values(errors.errors).map((e) => e.http_status),
  )) {
    responses[status] = {
      description: "Core or transport rejection",
      content: {
        "application/json": {
          schema: {
            oneOf: [
              { $ref: "#/components/schemas/core_service_error" },
              { $ref: "#/components/schemas/TransportError" },
            ],
          },
        },
      },
    };
  }
  paths[b.path] = {
    post: {
      operationId: b.operation,
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/core_" + b.operation },
          },
        },
      },
      responses,
    },
  };
}
for (const b of bindings.resources) {
  schemas["resource_result_" + b.resource_type] = relocate(
    resources.oneOf.find(
      (s) => s.properties.resource_type.const === b.resource_type,
    ),
    "resource_",
  );
  paths[b.path] = {
    get: {
      operationId: "read_" + b.resource_type,
      security: [{ bearerAuth: [] }],
      parameters: ["project_id", "id"].map((name) => ({
        name,
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      })),
      responses: {
        ...transport(),
        200: response(
          "Authorized safe projection",
          "resource_result_" + b.resource_type,
        ),
      },
    },
  };
}

for (const [k, v] of Object.entries(workspace.$defs))
  schemas["workspace_" + k] = relocate(v, "workspace_");
schemas.WorkspaceCommand = { oneOf: relocate(workspace.oneOf, "workspace_") };
schemas.EmptyObject = { type: "object", additionalProperties: false };
schemas.ConsoleResult = {
  type: "object",
  required: ["contract_version", "kind", "data"],
  additionalProperties: false,
  properties: {
    contract_version: { const: "workspace/0.1" },
    kind: { const: "console_result" },
    data: {
      description:
        "Owner-only local projection; varies by route and command. Not an execution grant or native-client receipt.",
      type: ["object", "array"],
    },
  },
};
schemas.WorkspaceError = {
  type: "object",
  required: ["kind", "code"],
  additionalProperties: false,
  properties: {
    kind: { const: "workspace_error" },
    code: { type: "string" },
    incident_id: { type: "string", format: "uuid" },
  },
};
schemas.FeedResult = {
  type: "object",
  required: ["contract_version", "items", "next_cursor"],
  additionalProperties: false,
  properties: {
    contract_version: { const: "feed/0.1" },
    next_cursor: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "body",
          "audience",
          "recipient_id",
          "created_at",
          "input_kind",
          "dispatch_state",
        ],
        properties: {
          id: { type: "string", format: "uuid" },
          body: { type: "string" },
          audience: { enum: ["public", "direct"] },
          recipient_id: { type: ["string", "null"], format: "uuid" },
          created_at: { type: "string", format: "date-time" },
          input_kind: { const: "ordinary_instruction" },
          dispatch_state: { const: "not_dispatched" },
        },
      },
    },
  },
};
for (const b of workspaceBindings.endpoints) {
  const parameters = [];
  if (b.path.includes("{project_id}"))
    parameters.push({
      name: "project_id",
      in: "path",
      required: true,
      schema: { type: "string", format: "uuid" },
    });
  if (b.query)
    parameters.push({
      name: b.query,
      in: "query",
      required: b.query === "q",
      schema: {
        type: "string",
        ...(b.query === "before"
          ? { format: "uuid" }
          : { minLength: 1, maxLength: 200 }),
      },
    });
  if (b.method === "post" && b.auth !== "bearerAuth")
    parameters.push({
      name: "Origin",
      in: "header",
      required: true,
      schema: { type: "string" },
      description:
        "Exact loopback server origin; injected by browser, rejects missing/cross-origin.",
    });
  if (b.method === "post" && b.auth === "ownerSession")
    parameters.push({
      name: "X-CSRF-Token",
      in: "header",
      required: true,
      schema: { type: "string" },
    });
  const failureSchema =
    b.auth === "bearerAuth"
      ? {
          oneOf: [
            { $ref: "#/components/schemas/WorkspaceError" },
            { $ref: "#/components/schemas/core_service_error" },
            { $ref: "#/components/schemas/TransportError" },
          ],
        }
      : {
          oneOf: [
            { $ref: "#/components/schemas/WorkspaceError" },
            { $ref: "#/components/schemas/TransportError" },
          ],
        };
  const responses = {
    200: response(
      b.auth === "bearerAuth"
        ? "Authorized ordinary-message feed, never a continuation"
        : "Single-owner workspace result",
      b.auth === "bearerAuth" ? "FeedResult" : "ConsoleResult",
    ),
  };
  for (const status of [400, 401, 403, 404, 405, 409, 413, 415, 429, 500])
    responses[status] = {
      description:
        "Explicit safe rejection; no hidden fallback or native dispatch",
      content: { "application/json": { schema: failureSchema } },
    };
  paths[b.path] = {
    [b.method]: {
      operationId: b.path.replace(/[^a-zA-Z0-9]+/g, "_").slice(1),
      security: b.auth === "none" ? [] : [{ [b.auth]: [] }],
      parameters,
      description:
        b.auth === "bearerAuth"
          ? "Trusted binding required. Cookie forbidden. Every read rechecks current execution/member/channel authorization. No HTTP grant/binding creation."
          : "Loopback single owner only. Bearer forbidden. Cookie HttpOnly; SameSite=Strict; Path=/v1/console. Not a multi-user or OS isolation boundary.",
      ...(b.request
        ? {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/" + b.request },
                },
              },
            },
          }
        : {}),
      responses,
    },
  };
}

outputs.set(
  "generated/openapi.json",
  json({
    openapi: "3.1.1",
    info: {
      title: "Agent Group local workspace and deterministic core",
      version: "0.2.0",
      description:
        "Not full domain API; no native-client execution or G0/G1 qualification.",
    },
    servers: [{ url: "http://127.0.0.1:4317" }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
        ownerSession: { type: "apiKey", in: "cookie", name: "team_owner" },
      },
      schemas,
    },
    "x-error-mapping": errors.errors,
  }),
);
let dirty = false;
for (const [p, content] of outputs) {
  if (process.argv.includes("--check")) {
    let actual;
    try {
      actual = await readFile(resolve(root, p), "utf8");
    } catch {}
    if (actual !== content) {
      console.error("DRIFT " + p);
      dirty = true;
    }
  } else {
    await mkdir(dirname(resolve(root, p)), { recursive: true });
    await writeFile(resolve(root, p), content);
  }
}
if (dirty) process.exitCode = 1;
else
  console.log(
    (process.argv.includes("--check") ? "Checked " : "Generated ") +
      outputs.size +
      " contract artifacts.",
  );
