import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { resolve, join } from "node:path";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { tempWorkspace } from "./temp.ts";
import { runnerFixture } from "./runner-helpers.ts";
import { RunnerHost } from "../packages/service/src/runner-host.ts";
const dll = resolve("artifacts/runner-host/Team.RunnerHost.dll");
for (const corruptOutput of [false, true])
  test(
    "host input failure keeps exit proof only when the output protocol stays valid: " +
      !corruptOutput,
    async () => {
      const f = runnerFixture();
      let injected = false;
      const faults: string[] = [];
      const host = new RunnerHost(f.profile, { scenario: "idle" }, (event) => {
        if (event.kind === "fault") faults.push(event.code);
        if (event.kind === "worker" && !injected) {
          injected = true;
          host.process.stdin.emit("error", new Error("synthetic EPIPE"));
          if (corruptOutput)
            host.process.stdout.emit("data", Buffer.from("{invalid\n"));
        }
      });
      const timer = setTimeout(() => host.abort(), 10000);
      try {
        const result = await host.closed;
        assert.equal(injected, true);
        assert.deepEqual(faults, ["HOST_INPUT_CLOSED"]);
        assert.equal(result.fault, "HOST_INPUT_CLOSED");
        if (corruptOutput) assert.equal(result.evidence, null);
        else {
          assert.equal(
            result.evidence?.job_empty,
            true,
            JSON.stringify(result),
          );
          assert.equal(result.evidence?.reason, "CONTROLLER_STOP");
        }
      } finally {
        clearTimeout(timer);
        await f.dispose();
      }
    },
  );
test("native host assigns the development worker to a Job before begin and proves its descendants exited", async () => {
  assert.ok(
    existsSync(dll),
    "native RunnerHost must be built; never skip this test",
  );
  const tmp = tempWorkspace();
  try {
    const p = spawn(resolve(".tools/dotnet/dotnet.exe"), [dll], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "",
      err = "";
    createInterface({ input: p.stdout }).on("line", (line) => {
      out += line + "\n";
      const e = JSON.parse(line);
      if (e.kind === "worker") {
        const f = JSON.parse(e.line);
        p.stdin.write(JSON.stringify({ kind: "ack", seq: f.seq }) + "\n");
      }
    });
    p.stderr.on("data", (s) => (err += s));
    const done = new Promise<number | null>((res, rej) => {
      p.on("error", rej);
      p.on("close", res);
    });
    p.stdin.write(
      JSON.stringify({
        node: process.execPath,
        worker: resolve("tests/fixtures/runner-worker.mjs"),
        cwd: mkdtempSync(join(tmp.directory, "scratch-")),
        input: { scenario: "descendants" },
      }) + "\n",
    );
    const timer = setTimeout(() => {
      p.kill();
    }, 10000);
    const code = await done;
    clearTimeout(timer);
    assert.equal(code, 0, err + out);
    const events = out
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
    assert.equal(events[0].kind, "started");
    assert.equal(events.at(-1).kind, "exited");
    assert.equal(events.at(-1).job_empty, true);
    assert.equal(events.at(-1).exit_code, 0);
    const pid = Number(
      JSON.parse(
        events.find(
          (e) =>
            e.kind === "worker" &&
            JSON.parse(e.line).text?.startsWith("child:"),
        )!.line,
      ).text.slice(6),
    );
    assert.throws(() => process.kill(pid, 0));
  } finally {
    tmp.dispose();
  }
});
