import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tempWorkspace } from "./temp.ts";
import { fixture } from "./helpers.ts";
import { createOwnedBridgeFactory } from "../packages/service/src/owned-bridge.ts";
import {
  CodexAppServer,
  type CodexLauncher,
} from "../packages/service/src/codex-app-server.ts";
import { relayJointComposition } from "./codex-relay-joint-support.mjs";

test(
  "missing external exit proof cannot be promoted by a clean host exit",
  { timeout: 15000 },
  async () => {
    const temp = tempWorkspace(),
      f = fixture();
    const prepared = await createOwnedBridgeFactory({
      dataRoot: temp.directory,
      config: {
        version: 1,
        target: "codex",
        service_origin: "http://127.0.0.1:1",
        project_id: f.ids.project,
        token: f.token,
        task_ids: [f.ids.task],
        execution_ids: [],
        allow_message_poll: false,
        egress: {
          data_class: "synthetic_only",
          provider_fingerprint: "a".repeat(64),
          expires_at: new Date(Date.now() + 60000).toISOString(),
        },
      },
    }).prepareClient(() => true);
    const base: CodexLauncher = {
      fingerprint: "a".repeat(64),
      source: "development_fixture",
      clientVersion: "fixture",
      async launch() {
        return new CodexAppServer(
          spawn(
            process.execPath,
            [resolve("tests/fixtures/codex-app-server-fixture.mjs"), "success"],
            { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
          ),
        );
      },
    };
    const composed = relayJointComposition(prepared, base, {
      root: temp.directory,
      bridgeData: temp.directory,
      synthetic: true,
    });
    try {
      const handle = await composed.launcher.launch(() => true);
      await handle.ready;
      await handle.startThread(temp.directory);
      handle.close();
      handle.close();
      const exit = await handle.closed;
      assert.equal(exit.code, 0);
      assert.equal(exit.fault, "RELAY_JOINT_CLOSE_FAILED");
      assert.equal(composed.facts.snapshot?.state, "failed");
    } finally {
      await composed.cleanup();
      f.close();
      temp.dispose();
    }
  },
);

test(
  "joint relay rehearsal combines task authorization revocation with actual bridge and relay exits",
  { timeout: 60000 },
  () => {
    const temp = tempWorkspace();
    try {
      const root = join(temp.directory, "attempt");
      const result = spawnSync(
        process.execPath,
        [
          resolve("tests/codex-joint-live.mjs"),
          "--fixture",
          "--relay",
          "--output",
          root,
        ],
        { encoding: "utf8", windowsHide: true, timeout: 55000 },
      );
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const report = JSON.parse(
        readFileSync(join(root, "report.json"), "utf8"),
      );
      assert.equal(report.stage, "W25");
      assert.equal(report.status, "SYNTHETIC_REHEARSAL_PASS");
      assert.equal(report.facts.task_reads, 1);
      assert.equal(report.facts.bridge[0].stdin_eof, true);
      assert.equal(report.facts.relay_lifecycle.relay_os_exit.exit_code, 0);
      assert.equal(report.facts.relay_lifecycle.snapshot.state, "closed");
      assert.equal(report.facts.exit.forced, false);
      assert.equal(report.facts.cleanup.residual_files, 0);
      assert.ok(
        report.checks.some((c: any) => c.name === "revoke" && c.passed),
      );
    } finally {
      temp.dispose();
    }
  },
);
