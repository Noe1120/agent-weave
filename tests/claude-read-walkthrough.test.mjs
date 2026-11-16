import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execute = promisify(execFile);
const run = (output) =>
  execute(process.execPath, [resolve("tests/claude-read-walkthrough.mjs")], {
    env: { ...process.env, CLAUDE_READ_EVIDENCE: output },
    windowsHide: true,
    timeout: 45000,
  });

test("compiled Claude walkthrough works when its evidence parent is absent", async () => {
  const root = await mkdtemp(join(tmpdir(), "team-claude-walkthrough-"));
  const output = join(root, "new-parent", "attempt");
  await run(output);
  const report = JSON.parse(
    await readFile(join(output, "report.json"), "utf8"),
  );
  assert.equal(report.status, "COMPILED_SYNTHETIC_WALKTHROUGH_PASS");
  assert.deepEqual(report.steps, [
    {
      step: "connect_read_progress",
      connection: 1,
      progress_reads: 20,
      db_mutations: 0,
    },
    { step: "connector_eof", connection: 1, exit_code: 0 },
    {
      step: "connect_read_progress",
      connection: 2,
      progress_reads: 20,
      db_mutations: 0,
    },
    { step: "revoke_after_reconnect", result: "DENIED" },
    { step: "connector_eof", connection: 2, exit_code: 0 },
  ]);
  assert.equal(report.native_clients_started, 0);
  assert.equal(report.model_calls, 0);
  assert.equal(
    JSON.parse(await readFile(join(output, "config-local.json"), "utf8")).token,
    "",
  );
});

test("compiled Claude walkthrough refuses to overwrite an existing attempt", async () => {
  const output = await mkdtemp(join(tmpdir(), "team-claude-existing-"));
  const marker = join(output, "config-local.json");
  await writeFile(marker, "existing evidence must remain unchanged\n");
  await assert.rejects(run(output), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /EEXIST/);
    return true;
  });
  assert.equal(
    await readFile(marker, "utf8"),
    "existing evidence must remain unchanged\n",
  );
  assert.deepEqual(await readdir(output), ["config-local.json"]);
});
