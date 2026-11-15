import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
const openapi = JSON.parse(readFileSync("generated/openapi.json", "utf8"));
const source = JSON.parse(
  readFileSync("plan/contracts/core.schema.json", "utf8"),
);
const bindings = JSON.parse(
  readFileSync("plan/contracts/transport-bindings.json", "utf8"),
);
test("generated artifacts match authoritative source without rewriting", () => {
  const r = spawnSync(
    process.execPath,
    ["scripts/generate-contracts.mjs", "--check"],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
test("OpenAPI has all eight request operations, seven resource projections and full error mapping", () => {
  assert.equal(openapi.openapi, "3.1.1");
  assert.equal(Object.keys(openapi.paths).length, 24);
  assert.deepEqual(
    Object.keys(openapi["x-error-mapping"]).sort(),
    source.$defs.service_error.properties.code.enum.slice().sort(),
  );
  for (const b of bindings.core) {
    const op = openapi.paths[b.path].post;
    assert.equal(op.operationId, b.operation);
    assert.equal(
      op.requestBody.content["application/json"].schema.$ref,
      "#/components/schemas/core_" + b.operation,
    );
    assert.ok(op.responses["200"]);
    assert.ok(op.responses["401"]);
    assert.deepEqual(op.security, [{ bearerAuth: [] }]);
  }
  for (const b of bindings.resources) {
    assert.deepEqual(openapi.paths[b.path].get.security, [{ bearerAuth: [] }]);
    assert.equal(
      openapi.paths[b.path].get.responses["200"].content["application/json"]
        .schema.$ref,
      "#/components/schemas/resource_result_" + b.resource_type,
    );
  }
  const task = openapi.components.schemas.resource_result_task;
  assert.equal(task.additionalProperties, false);
  assert.equal(task.properties.data.$ref, "#/components/schemas/resource_task");
  const data = openapi.components.schemas.resource_task;
  assert.equal(data.additionalProperties, false);
  assert.deepEqual(data.required, [
    "status",
    "candidate_ref",
    "inputs_valid",
    "acceptance_ref",
  ]);
});
test("every OpenAPI schema reference resolves and wire cases retain strict validity", () => {
  function visit(value: unknown) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, val] of Object.entries(value)) {
        if (key === "$ref") {
          assert.equal(typeof val, "string");
          assert.ok((val as string).startsWith("#/components/schemas/"));
          assert.ok(
            openapi.components.schemas[(val as string).slice(21)],
            String(val),
          );
        } else visit(val);
      }
    }
  }
  visit(openapi);
  const ajv = new Ajv2020({ strict: false });
  (addFormats as unknown as (a: Ajv2020) => void)(ajv);
  ajv.addSchema({ ...openapi, $id: "urn:agent-group:openapi-baseline" });
  const wire = JSON.parse(
    readFileSync("plan/contracts/wire-examples.json", "utf8"),
  );
  for (const sample of wire.examples) {
    const kind = sample.payload.kind;
    if (!openapi.components.schemas["core_" + kind]) continue;
    const validator = ajv.compile({
      $ref: "urn:agent-group:openapi-baseline#/components/schemas/core_" + kind,
    });
    assert.equal(
      validator(sample.payload),
      sample.expected_schema_valid,
      sample.id,
    );
  }
});

test("workspace OpenAPI separates owner cookie/CSRF from execution feed Bearer", () => {
  const cookie = openapi.components.securitySchemes.ownerSession;
  assert.deepEqual(cookie, {
    type: "apiKey",
    in: "cookie",
    name: "team_owner",
  });
  assert.deepEqual(openapi.paths["/v1/console/pair"].post.security, []);
  for (const [path, item] of Object.entries(openapi.paths) as [string, any][]) {
    if (!path.startsWith("/v1/console/") || path.endsWith("/pair")) continue;
    const op = item.get ?? item.post;
    assert.deepEqual(op.security, [{ ownerSession: [] }]);
    if (item.post) {
      assert.ok(
        op.parameters.some((p: any) => p.name === "Origin" && p.required),
      );
      assert.ok(
        op.parameters.some((p: any) => p.name === "X-CSRF-Token" && p.required),
      );
    }
  }
  const feed = openapi.paths["/v1/feed"].post;
  assert.deepEqual(feed.security, [{ bearerAuth: [] }]);
  assert.equal(
    feed.requestBody.content["application/json"].schema.$ref,
    "#/components/schemas/workspace_feed_request",
  );
  assert.equal(
    openapi.components.schemas.workspace_feed_request.additionalProperties,
    false,
  );
  assert.equal(openapi.components.schemas.WorkspaceCommand.oneOf.length, 9);
});
