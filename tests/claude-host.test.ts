import assert from "node:assert/strict";
import { after, test } from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
const hosts = new Set<ReturnType<typeof spawn>>();
after(() => {
  for (const host of hosts)
    if (host.exitCode === null && !host.killed) host.kill();
});
async function run(args: string[], stopOnOutput = true, timeoutMs = 2000) {
  const dll = resolve("artifacts/claude-probe-host/Claude.ProbeHost.dll");
  await access(dll);
  const output = await mkdtemp(join(tmpdir(), "team-claude-host-"));
  const host = spawn(resolve(".tools/dotnet/dotnet.exe"), [dll], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  hosts.add(host);
  const messages: any[] = [];
  let stderr = "";
  host.stderr.on("data", (b) => (stderr += b.toString()));
  const exited = new Promise<number | null>((r) => host.once("exit", r));
  const closed = new Promise<void>((r) => host.once("close", () => r()));
  createInterface({ input: host.stdout }).on("line", (line) => {
    const event = JSON.parse(line);
    messages.push(event);
    if (stopOnOutput && event.kind === "output")
      host.stdin.write('{"kind":"stop"}\n');
  });
  host.stdin.write(
    JSON.stringify({
      executable: process.execPath,
      args,
      cwd: output,
      output,
      env: {
        SystemRoot: process.env.SystemRoot!,
        PATH: process.env.SystemRoot! + "\\System32",
      },
      timeout_ms: timeoutMs,
    }) + "\n",
  );
  const code = await exited;
  host.stdin.destroy();
  await closed;
  return { code, messages, stderr, output };
}
test("direct host accepts a bounded ten-minute UI acceptance window and still stops on command", async () => {
  const r = await run(
    ["-e", "console.log('ready');setInterval(()=>{},1000)"],
    true,
    600000,
  );
  assert.equal(r.code, 0, JSON.stringify(r.messages));
  const end = r.messages.find((m) => m.kind === "exited");
  assert.equal(end.reason, "CONTROLLER_STOP");
  assert.equal(end.root_exit_observed, true);
  assert.equal(end.job_empty, true);
});
test("direct host rejects an unbounded UI lifetime before starting any process", async () => {
  const r = await run(["-e", "console.log('must-not-launch')"], true, 600001);
  assert.equal(r.code, 1);
  assert.ok(r.messages.some((m) => m.code === "CONFIG_TIMEOUT"));
  assert.ok(!r.messages.some((m) => m.kind === "started"));
});
test("direct host retains root handle, terminates root and descendant, and proves Job empty", async () => {
  const r = await run([
    "-e",
    "require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'}).once('spawn',()=>console.log('ready'));setInterval(()=>{},1000)",
  ]);
  assert.equal(r.code, 0, r.stderr + JSON.stringify(r.messages));
  assert.ok(
    r.messages.some(
      (m) => m.kind === "started" && m.root_handle_retained && m.job_assigned,
    ),
  );
  const end = r.messages.find((m) => m.kind === "exited");
  assert.equal(end.root_exit_observed, true);
  assert.equal(end.job_empty, true);
  assert.equal(end.reason, "CONTROLLER_STOP");
  assert.match(
    await readFile(join(r.output, "stdout.local.log"), "utf8"),
    /ready/,
  );
});
test("direct host observes root exit separately from pipes held by a descendant", async () => {
  const r = await run(
    [
      "-e",
      "require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:['ignore',1,2]}).unref();process.exit(7)",
    ],
    false,
  );
  assert.equal(r.code, 0, r.stderr + JSON.stringify(r.messages));
  const end = r.messages.find((m) => m.kind === "exited");
  assert.equal(end.root_exit_observed, true);
  assert.equal(end.root_exit_code, 7);
  assert.equal(end.reason, "ROOT_EXIT");
  assert.equal(end.job_empty, true);
});
test("direct host enforces its own lifetime without controller stop", async () => {
  const r = await run(["-e", "setInterval(()=>{},1000)"], false);
  assert.equal(r.code, 0, r.stderr + JSON.stringify(r.messages));
  const end = r.messages.find((m) => m.kind === "exited");
  assert.equal(end.reason, "DEADLINE");
  assert.equal(end.root_exit_observed, true);
});

test("direct host reports excessive diagnostic output as failure and still proves cleanup", async () => {
  const r = await run(
    ["-e", "process.stdout.write('x'.repeat(70000));setInterval(()=>{},1000)"],
    false,
  );
  assert.equal(r.code, 1, r.stderr + JSON.stringify(r.messages));
  const end = r.messages.find((m) => m.kind === "exited");
  assert.equal(end.root_exit_observed, true);
  assert.equal(end.job_empty, true);
  assert.equal(end.fault, "OUTPUT_LIMIT");
  assert.ok(
    (await readFile(join(r.output, "stdout.local.log"))).length <= 65536,
  );
});
