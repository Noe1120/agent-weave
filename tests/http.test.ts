import test from "node:test";
import assert from "node:assert/strict";
import { request as requestHttp } from "node:http";
import { once } from "node:events";
import { createServer } from "../packages/service/src/http.ts";
import { fixture, id } from "./helpers.ts";
import {
  validateCore,
  validateResource,
  errorMapping,
} from "../packages/contracts/src/index.ts";
async function setup() {
  const f = fixture();
  const server = createServer(f.service);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("bad address");
  const call = (
    url: string,
    body: unknown,
    headers: Record<string, string> = {},
    method = "POST",
  ) =>
    new Promise<{
      status: number;
      headers: import("node:http").IncomingHttpHeaders;
      body: any;
    }>((resolve, reject) => {
      const raw =
        body === undefined
          ? undefined
          : typeof body === "string"
            ? body
            : JSON.stringify(body);
      const req = requestHttp(
        {
          host: "127.0.0.1",
          port: address.port,
          path: url,
          method,
          headers: {
            authorization: "Bearer " + f.token,
            "content-type": "application/json",
            ...headers,
          },
        },
        (res) => {
          const parts: Buffer[] = [];
          res.on("data", (c) => parts.push(c));
          res.on("end", () => {
            try {
              resolve({
                status: res.statusCode!,
                headers: res.headers,
                body: JSON.parse(Buffer.concat(parts).toString()),
              });
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      req.on("error", reject);
      req.end(raw);
    });
  return {
    ...f,
    call,
    port: address.port,
    stop: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
      f.close();
    },
  };
}
test("HTTP applies strict core request, validates response and emits no-store", async () => {
  const f = await setup();
  try {
    const r = await f.call("/v1/core/apply_plan", f.apply());
    assert.equal(r.status, 200);
    assert.equal(validateCore(r.body), true);
    assert.equal(r.headers["cache-control"], "no-store");
  } finally {
    await f.stop();
  }
});
for (const [name, status, headers] of [
  ["missing bearer", 401, { authorization: "" }],
  ["invalid bearer", 401, { authorization: "Bearer wrong" }],
  ["host", 403, { host: "attacker.invalid" }],
  ["origin", 403, { origin: "https://attacker.invalid" }],
  ["null origin", 403, { origin: "null" }],
  ["content type", 415, { "content-type": "text/plain" }],
] as [string, number, Record<string, string>][])
  test("HTTP rejects " + name, async () => {
    const f = await setup();
    try {
      const r = await f.call("/v1/core/apply_plan", f.apply(), headers);
      assert.equal(r.status, status);
      assert.equal(r.body.kind, "transport_error");
      assert.equal(JSON.stringify(r.body).includes(f.token), false);
    } finally {
      await f.stop();
    }
  });
test("HTTP rejects malformed JSON, unknown fields, version, route mismatch and oversize", async () => {
  const f = await setup();
  try {
    for (const body of [
      "{",
      { ...f.apply(), actor_id: id() },
      { ...f.apply(), contract_version: "core/99" },
    ])
      assert.equal((await f.call("/v1/core/apply_plan", body)).status, 400);
    assert.equal((await f.call("/v1/core/read_wait", f.apply())).status, 400);
    assert.equal(
      (await f.call("/v1/core/apply_plan", "x".repeat(65537))).status,
      413,
    );
    assert.equal(
      (await f.call("/v1/core/apply_plan", undefined, {}, "GET")).status,
      405,
    );
    assert.equal(
      (await f.call("/v1/core/apply_plan?token=" + f.token, f.apply())).status,
      400,
    );
  } finally {
    await f.stop();
  }
});
test("HTTP core errors use explicit status/retry mapping, no raw failures", async () => {
  const f = await setup();
  try {
    const q = f.apply();
    await f.call("/v1/core/apply_plan", q);
    const stale = await f.call("/v1/core/apply_plan", f.apply());
    assert.equal(stale.status, errorMapping.PLAN_STALE.http_status);
    assert.equal(stale.body.retry_class, "after_refresh");
    assert.equal(validateCore(stale.body), true);
    f.s.db.exec(
      "CREATE TRIGGER fail_register BEFORE INSERT ON waits BEGIN SELECT RAISE(ABORT, 'synthetic private exception'); END;",
    );
    const result = await f.call("/v1/core/register_wait", f.register());
    assert.equal(result.status, 500);
    assert.deepEqual(result.body, {
      kind: "transport_error",
      code: "INTERNAL_ERROR",
    });
  } finally {
    await f.stop();
  }
});
test("six resource reads are projections; denied/missing are indistinguishable", async () => {
  const f = await setup();
  try {
    for (const [kind, key] of [
      ["grant", "grant"],
      ["input_request", "input"],
      ["changeset", "candidate"],
      ["root", "root"],
      ["environment", "environment"],
      ["acceptance", "acceptance"],
    ] as const) {
      const r = await f.call(
        "/v1/projects/" + f.ids.project + "/" + kind + "/" + f.ids[key],
        undefined,
        {},
        "GET",
      );
      assert.equal(r.status, 200);
      assert.equal(validateResource(r.body), true);
      assert.equal(JSON.stringify(r.body).includes("native_binding"), false);
      assert.equal(JSON.stringify(r.body).includes("token_hash"), false);
    }
    const resource = f.s.getResource(f.ids.root)!;
    resource.acl = [];
    f.s.putResource(resource);
    const a = await f.call(
      "/v1/projects/" + f.ids.project + "/root/" + f.ids.root,
      undefined,
      {},
      "GET",
    );
    const b = await f.call(
      "/v1/projects/" + f.ids.project + "/root/" + id(),
      undefined,
      {},
      "GET",
    );
    assert.equal(a.status, 404);
    assert.deepEqual(a.body, b.body);
  } finally {
    await f.stop();
  }
});
