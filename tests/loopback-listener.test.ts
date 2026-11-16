import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import { test } from "node:test";
import { createServer as httpServer } from "node:http";
import { listenLoopback } from "../packages/service/src/loopback-listener.ts";

test("automatic service binding remains fetch-compatible when OS ephemeral allocation selects port10080", async () => {
  const root = await mkdtemp(join(tmpdir(), "team-port-allocation-"));
  const preload = join(root, "allocator.mjs");
  await writeFile(
    preload,
    `import {Server} from 'node:net';const listen=Server.prototype.listen;Server.prototype.listen=function(...args){if(args[0]===0)args[0]=10080;else if(args[0]&&typeof args[0]==='object'&&args[0].port===0)args[0]={...args[0],port:10080};return listen.apply(this,args);};`,
  );
  const child = spawn(
    process.execPath,
    [
      "--import",
      pathToFileURL(preload).href,
      resolve("packages/service/src/main.ts"),
    ],
    {
      env: { ...process.env, PORT: "0", CORE_DB: join(root, "core.sqlite") },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const ended = once(child, "exit");
  let text = "";
  const timer = setTimeout(() => child.kill(), 10000);
  try {
    const info = await new Promise<any>((res, rej) => {
      child.stdout.on("data", (b) => {
        text += b;
        const line = text.split(/\r?\n/).find((l) => l.startsWith("{"));
        if (line) res(JSON.parse(line));
      });
      child.once("exit", () => rej(Error("Service exited before readiness")));
      child.once("error", rej);
    });
    const response = await fetch(
      `http://127.0.0.1:${info.port}/v1/core/read_wait`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      kind: "transport_error",
      code: "UNAUTHENTICATED",
    });
  } finally {
    child.kill();
    await ended;
    clearTimeout(timer);
  }
});
test("automatic binding retries actual port collisions before serving while explicit occupied ports fail", async () => {
  const blocker = httpServer();
  await listenLoopback(blocker);
  const occupied = (blocker.address() as import("node:net").AddressInfo).port;
  const server = httpServer((_req, res) => res.end("ready"));
  const original = server.listen;
  let tries = 0;
  server.listen = function (this: typeof server, ...args: any[]) {
    tries++;
    if (tries === 1) args[0] = occupied;
    return (original as any).apply(this, args);
  } as typeof server.listen;
  const explicit = httpServer();
  const existingListeners = explicit.rawListeners("listening");
  try {
    await listenLoopback(server);
    assert.equal(tries, 2);
    const port = (server.address() as import("node:net").AddressInfo).port;
    assert.equal(
      await (await fetch(`http://127.0.0.1:${port}`)).text(),
      "ready",
    );
    await assert.rejects(listenLoopback(explicit, occupied), {
      code: "EADDRINUSE",
    });
    assert.equal(explicit.listening, false);
    assert.equal(explicit.listenerCount("error"), 0);
    assert.deepEqual(explicit.rawListeners("listening"), existingListeners);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await new Promise<void>((r) => blocker.close(() => r()));
  }
});
test("automatic binding exhausts collisions visibly without publishing a listener or leaking listeners", async () => {
  const blocker = httpServer();
  await listenLoopback(blocker);
  const occupied = (blocker.address() as import("node:net").AddressInfo).port;
  const server = httpServer();
  const existingListeners = server.rawListeners("listening");
  const original = server.listen;
  let tries = 0;
  server.listen = function (this: typeof server, ...args: any[]) {
    tries++;
    args[0] = occupied;
    return (original as any).apply(this, args);
  } as typeof server.listen;
  try {
    await assert.rejects(listenLoopback(server), { code: "EADDRINUSE" });
    assert.equal(tries, 32);
    assert.equal(server.listening, false);
    assert.equal(server.listenerCount("error"), 0);
    assert.deepEqual(server.rawListeners("listening"), existingListeners);
  } finally {
    await new Promise<void>((r) => blocker.close(() => r()));
  }
});
