import test from "node:test";
import assert from "node:assert/strict";
import {
  parseWorkerFrame,
  validateStart,
} from "../packages/service/src/runner-protocol.ts";
import { id } from "./helpers.ts";
const request = () => ({
  execution_id: id(),
  adapter: "development_fixture",
  claim: {
    project_id: id(),
    workspace_id: id(),
    scope_id: id(),
    claim_id: id(),
    expected_task_revision: "1",
    lease_ms: 60000,
  },
  input: { scenario: "success" },
  timeout_ms: 10000,
});
test("runner admission rejects original client identity, commands and unknown fields before execution", () => {
  for (const adapter of ["Codex", "Claude Desktop", "DeepSeek Harness", "sdk"])
    assert.throws(
      () => validateStart({ ...request(), adapter }),
      /ADAPTER_DISABLED/,
    );
  for (const extra of [
    { command: "cmd.exe" },
    { cwd: "C:\\" },
    { env: { SECRET: "x" } },
  ])
    assert.throws(
      () => validateStart({ ...request(), ...extra }),
      /INVALID_REQUEST/,
    );
  assert.equal(validateStart(request()).adapter, "development_fixture");
});
test("runner frames are strict, bounded and cannot impersonate native exit evidence", () => {
  assert.deepEqual(
    parseWorkerFrame('{"seq":1,"kind":"progress","text":"working"}'),
    { seq: 1, kind: "progress", text: "working" },
  );
  for (const text of [
    '{"seq":1,"kind":"exited","job_empty":true}',
    '{"seq":1,"kind":"complete","extra":true}',
    '{"seq":0,"kind":"complete"}',
    "{",
    '{"seq":1,"kind":"progress","text":"' + "x".repeat(65536) + '"}',
  ])
    assert.throws(() => parseWorkerFrame(text), /PROTOCOL/);
  assert.throws(
    () =>
      parseWorkerFrame(
        '{"seq":1,"kind":"patch","edits":[{"path":"x","before_digest":null,"text":"a","action_id":"spoof"}]}',
      ),
    /PROTOCOL/,
  );
});
