import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tempWorkspace } from "./temp.ts";

test("relay acceptance refuses missing authorization without creating a run", () => {
  const result = spawnSync(
    process.execPath,
    [resolve("tests/codex-relay-acceptance.mjs")],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /RELAY_ACCEPTANCE_OPT_IN_REQUIRED/);
});

test(
  "relay acceptance synthetic rehearsal proves OS exits, no model and scoped cleanup",
  { timeout: 60000 },
  () => {
    const temp = tempWorkspace();
    try {
      const root = join(temp.directory, "attempt");
      const result = spawnSync(
        process.execPath,
        [resolve("tests/codex-relay-acceptance.mjs"), "--synthetic", root],
        { encoding: "utf8", windowsHide: true, timeout: 55000 },
      );
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const report = JSON.parse(
        readFileSync(join(root, "report.json"), "utf8"),
      );
      assert.equal(report.status, "PASSED_SYNTHETIC_ONLY");
      assert.equal(report.facts.provider_sink_requests, 0);
      assert.equal(report.facts.final_bridge.tool_calls, 0);
      assert.equal(report.facts.final_bridge.stdin_eof, true);
      assert.equal(report.facts.relay_os_exit.exit_code, 0);
      assert.equal(report.facts.cleanup.residual_files, 0);
      // Re-running even synthetic mode must not reuse the consumed attempt.
      const again = spawnSync(
        process.execPath,
        [resolve("tests/codex-relay-acceptance.mjs"), "--synthetic", root],
        { encoding: "utf8", windowsHide: true },
      );
      assert.equal(again.status, 1);
      assert.match(again.stderr, /ATTEMPT_ALREADY_EXISTS/);
    } finally {
      temp.dispose();
    }
  },
);
