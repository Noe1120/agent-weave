import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { observeWindowsChildExit } from "../packages/service/src/windows-exit-observer.ts";

const entry = resolve("tests/fixtures/observed-child.mjs");
async function parent(count = 1) {
  const child = spawn(
    process.execPath,
    [resolve("tests/fixtures/observed-parent.mjs"), entry, String(count)],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  const closed = once(child, "close");
  let received = "";
  await new Promise<void>((r) =>
    child.stdout.on("data", (b) => {
      received += b.toString();
      if (received.split("\n").length - 1 === count) r();
    }),
  );
  return {
    child,
    async cleanup() {
      child.stdin.end();
      await closed;
    },
  };
}
test("unique child observation binds held parent and exact entry to actual exit", async (t) => {
  const f = await parent();
  t.after(() => f.cleanup());
  const observer = await observeWindowsChildExit(f.child, entry);
  t.after(() => observer.dispose());
  f.child.stdin.write("close");
  assert.deepEqual(await observer.waitExit(), {
    code: 0,
    exit_observed: true,
    forced: false,
  });
});
test("wrong entry does not attach to some other child", async (t) => {
  const f = await parent();
  t.after(() => f.cleanup());
  await assert.rejects(
    observeWindowsChildExit(f.child, resolve("tests/fixtures/other.mjs")),
    /WINDOWS_EXIT_/,
  );
  assert.equal(f.child.exitCode, null);
});
test("multiple identical children are ambiguous and cannot produce a proof", async (t) => {
  const f = await parent(2);
  t.after(() => f.cleanup());
  await assert.rejects(
    observeWindowsChildExit(f.child, entry),
    /WINDOWS_EXIT_/,
  );
  assert.equal(f.child.exitCode, null);
});
