import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { observeWindowsExit } from "../packages/service/src/windows-exit-observer.ts";

const ps = "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";
async function owned() {
  const child = spawn(
    process.execPath,
    [
      "-e",
      "process.stdin.resume();process.stdin.on('end',()=>process.exit(7));process.stdout.write('ready')",
    ],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  const closed = once(child, "close");
  await once(child.stdout, "data");
  const startedTicks = execFileSync(
    ps,
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `(Get-Process -Id ${child.pid}).StartTime.ToUniversalTime().Ticks.ToString()`,
    ],
    { encoding: "utf8", windowsHide: true },
  ).trim();
  return {
    child,
    closed,
    startedTicks,
    async cleanup() {
      if (child.exitCode === null) child.kill();
      await closed;
    },
  };
}
test("retained Windows handle observes actual exit code and supports repeat waits", async (t) => {
  const f = await owned();
  t.after(() => f.cleanup());
  const observer = await observeWindowsExit({
    pid: f.child.pid!,
    startedTicks: f.startedTicks,
  });
  t.after(() => observer.dispose());
  f.child.stdin.end();
  assert.deepEqual(await observer.waitExit(), {
    code: 7,
    exit_observed: true,
    forced: false,
  });
  assert.deepEqual(await observer.waitExit(), {
    code: 7,
    exit_observed: true,
    forced: false,
  });
  await observer.dispose();
  await observer.dispose();
});
test("wrong creation identity refuses a live PID without touching it", async (t) => {
  const f = await owned();
  t.after(() => f.cleanup());
  await assert.rejects(
    observeWindowsExit({
      pid: f.child.pid!,
      startedTicks: (BigInt(f.startedTicks) + 1n).toString(),
    }),
    /WINDOWS_EXIT_/,
  );
  assert.equal(f.child.exitCode, null);
  f.child.stdin.end();
  assert.equal((await f.closed)[0], 7);
});
test("disposing observer rejects pending proof without terminating observed child", async (t) => {
  const f = await owned();
  t.after(() => f.cleanup());
  const observer = await observeWindowsExit({
    pid: f.child.pid!,
    startedTicks: f.startedTicks,
  });
  const rejected = assert.rejects(observer.waitExit(), /WINDOWS_EXIT_/);
  await observer.dispose();
  await observer.dispose();
  await rejected;
  assert.equal(f.child.exitCode, null);
  f.child.stdin.end();
  assert.equal((await f.closed)[0], 7);
});
test("observer rejects nonnumeric identity and invalid PIDs before starting a helper", async () => {
  for (const pid of [0, -1, 1.5, Number.NaN])
    await assert.rejects(
      observeWindowsExit({ pid, startedTicks: "1" }),
      /WINDOWS_EXIT_OPTIONS/,
    );
  await assert.rejects(
    observeWindowsExit({ pid: process.pid, startedTicks: "1;exit" }),
    /WINDOWS_EXIT_OPTIONS/,
  );
});
