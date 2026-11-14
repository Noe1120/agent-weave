import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { fixture, success, id } from "./helpers.ts";
import { Store } from "../packages/service/src/store.ts";
import { CoreService } from "../packages/service/src/service.ts";
import type { CoreError, CoreResult } from "../packages/contracts/src/index.ts";
import { tempWorkspace } from "./temp.ts";
async function worker() {
  const child = fork(
    fileURLToPath(new URL("./fixtures/durable-worker.ts", import.meta.url)),
    [],
    { silent: true, windowsHide: true },
  );
  const [ready] = await once(child, "message", {
    signal: AbortSignal.timeout(10000),
  });
  assert.deepEqual(ready, { ready: true });
  return child;
}
async function stop(child: ReturnType<typeof fork>, abrupt = false) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const ended = once(child, "exit", { signal: AbortSignal.timeout(10000) });
  if (abrupt) child.kill("SIGTERM");
  else child.disconnect();
  await ended;
}
test("two real processes race a plan CAS; only one commits budget/tasks/outbox", async () => {
  const tmp = tempWorkspace();
  const f = fixture(tmp.db);
  const a = f.apply(),
    b = { ...a, action_id: id() };
  f.close();
  const children: ReturnType<typeof fork>[] = [];
  try {
    children.push(await worker(), await worker());
    const results = children.map((child) =>
      once(child, "message", { signal: AbortSignal.timeout(10000) }),
    );
    children.forEach((child, index) =>
      child.send({
        db: tmp.db,
        token: f.token,
        request: index === 0 ? a : b,
        now: f.now(),
      }),
    );
    const replies = (await Promise.all(results)).map(([m]) => {
      const value = m as { result?: CoreResult | CoreError; error?: string };
      assert.equal(value.error, undefined);
      return value.result!;
    });
    assert.equal(replies.filter((r) => r.kind === "service_result").length, 1);
    assert.equal(
      replies.filter(
        (r) => r.kind === "service_error" && r.code === "PLAN_STALE",
      ).length,
      1,
    );
    for (const child of children) await stop(child);
    const db = new Store(tmp.db);
    try {
      assert.equal(db.db.prepare("SELECT count(*) n FROM actions").get()!.n, 1);
      assert.equal(db.db.prepare("SELECT count(*) n FROM outbox").get()!.n, 1);
      assert.equal(db.getResource(f.ids.root)!.data.budget_reserved, "10");
    } finally {
      db.close();
    }
  } finally {
    for (const child of children) await stop(child, true);
    tmp.dispose();
  }
});
test("abrupt process termination after COMMIT does not duplicate the committed action on restart", async () => {
  const tmp = tempWorkspace();
  const f = fixture(tmp.db);
  const q = f.apply();
  f.close();
  let child: ReturnType<typeof fork> | undefined;
  try {
    child = await worker();
    const reply = once(child, "message", {
      signal: AbortSignal.timeout(10000),
    });
    child.send({ db: tmp.db, token: f.token, request: q, now: f.now() });
    const [message] = await reply;
    const first = (message as { result: CoreResult }).result;
    assert.equal(first.kind, "service_result");
    await stop(child, true);
    const db = new Store(tmp.db);
    try {
      const result = success(
        new CoreService(db, f.now).execute(f.token, { ...q, request_id: id() }),
      );
      assert.deepEqual(result.data, first.data);
      assert.equal(db.db.prepare("SELECT count(*) n FROM actions").get()!.n, 1);
      assert.equal(db.db.prepare("SELECT count(*) n FROM outbox").get()!.n, 1);
    } finally {
      db.close();
    }
  } finally {
    if (child) await stop(child, true);
    tmp.dispose();
  }
});
