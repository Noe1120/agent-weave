import test from "node:test";
import assert from "node:assert/strict";
import { listenLoopback } from "../packages/service/src/loopback-listener.ts";
import { randomUUID } from "node:crypto";
import { Store } from "../packages/service/src/store.ts";
import { CoreService } from "../packages/service/src/service.ts";
import { WorkspaceService } from "../packages/service/src/workspace-service.ts";
import { createServer } from "../packages/service/src/http.ts";
async function setup() {
  const s = new Store(),
    w = new WorkspaceService(s),
    server = createServer(new CoreService(s), w);
  await listenLoopback(server);
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("missing address");
  const origin = "http://127.0.0.1:" + address.port;
  const call = async (
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const res = await fetch(origin + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body === undefined
          ? {}
          : { "content-type": "application/json", origin }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    return {
      status: res.status,
      headers: res.headers,
      text,
      json: () => JSON.parse(text),
    };
  };
  return {
    s,
    w,
    server,
    origin,
    call,
    stop: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
      s.close();
    },
  };
}
test("browser serves a real local workspace shell without exposing credentials or granting access", async () => {
  const f = await setup();
  try {
    const r = await f.call("/");
    assert.equal(r.status, 200);
    assert.match(r.text, /群组工作台/);
    assert.match(
      r.headers.get("content-security-policy")!,
      /frame-ancestors 'none'/,
    );
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal((await f.call("/app.js")).status, 200);
    assert.equal((await f.call("/v1/console/projects")).status, 401);
    assert.equal((await f.call("/../package.json")).status, 401);
  } finally {
    await f.stop();
  }
});
test("browser pairing uses HttpOnly Strict cookie and CSRF, logout revokes session", async () => {
  const f = await setup();
  try {
    const pair = await f.call("/v1/console/pair", {
      code: f.w.auth.newPairing().code,
    });
    assert.equal(pair.status, 200);
    const cookie = pair.headers.get("set-cookie")!;
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.ok(cookie.includes("Path=/v1/console"));
    const auth = {
      cookie: cookie.split(";")[0]!,
      "x-csrf-token": pair.json().data.csrf,
    };
    const q = {
      kind: "create_project",
      action_id: randomUUID(),
      name: "HTTP project",
      description: "",
    };
    assert.equal((await f.call("/v1/console/commands", q, auth)).status, 200);
    assert.equal(
      (
        await f.call(
          "/v1/console/commands",
          { ...q, action_id: randomUUID() },
          { cookie: auth.cookie },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.call("/v1/console/commands", q, {
          ...auth,
          origin: "https://evil.invalid",
        })
      ).status,
      403,
    );
    assert.equal(
      (await f.call("/v1/console/projects", undefined, auth)).json().data
        .length,
      1,
    );
    assert.equal((await f.call("/v1/console/logout", {}, auth)).status, 200);
    assert.equal(
      (await f.call("/v1/console/session", undefined, auth)).status,
      401,
    );
  } finally {
    await f.stop();
  }
});
test("console mutation refuses missing Origin, malformed envelopes and query credential injection", async () => {
  const f = await setup();
  try {
    assert.equal(
      (
        await f.call(
          "/v1/console/pair",
          { code: f.w.auth.newPairing().code },
          { origin: "" },
        )
      ).status,
      403,
    );
    assert.equal(
      (await f.call("/v1/console/pair", { code: "x".repeat(43), extra: true }))
        .status,
      400,
    );
    assert.equal(
      (await f.call("/v1/console/session?token=secret")).status,
      400,
    );
  } finally {
    await f.stop();
  }
});
