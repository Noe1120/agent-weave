import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acceptanceMode,
  acceptanceStatus,
  acceptanceStatuses,
  evidenceFiles,
  readMockRequests,
  readsMockRequests,
  type AcceptanceFacts,
} from "./codex-acceptance-plan.ts";

// These checks are pure: no client, no bridge, no provider.
const base: AcceptanceFacts = {
  mode: "vendor",
  bridgeConnections: 1,
  bridgeToolCalls: 1,
  bridgeToolErrors: 0,
  bridgeFaults: 0,
  turnState: "completed",
  agentMessage: "task 1111 status draft",
  tokenUsageTotal: 17863,
  taskId: "1111",
  stubRounds: null,
  processUnchanged: true,
  cleanupComplete: true,
  harnessError: null,
  protocolError: null,
};
test("the mode is derived from the explicit authorizations only", () => {
  assert.equal(
    acceptanceMode({
      initialize: true,
      thread: false,
      turn: false,
      vendor: false,
    }),
    "initialize",
  );
  assert.equal(
    acceptanceMode({
      initialize: true,
      thread: true,
      turn: false,
      vendor: false,
    }),
    "thread",
  );
  assert.equal(
    acceptanceMode({
      initialize: true,
      thread: true,
      turn: true,
      vendor: false,
    }),
    "stub",
  );
  assert.equal(
    acceptanceMode({
      initialize: true,
      thread: true,
      turn: true,
      vendor: true,
    }),
    "vendor",
  );
  assert.throws(() =>
    acceptanceMode({
      initialize: false,
      thread: true,
      turn: true,
      vendor: true,
    }),
  );
});
test("vendor mode never reads the local stub request log", () => {
  const directory = mkdtempSync(join(tmpdir(), "codex-plan-"));
  // This is the regression for the reported TypeError: vendor mode passed an
  // undefined path into readFileSync after the model turn.
  assert.equal(readsMockRequests("vendor"), false);
  assert.equal(evidenceFiles("vendor").includes("mock-requests.jsonl"), false);
  assert.deepEqual(readMockRequests("vendor", directory), null);
  assert.equal(readsMockRequests("stub"), true);
  assert.deepEqual(readMockRequests("stub", directory), null);
  writeFileSync(
    join(directory, "mock-requests.jsonl"),
    [
      JSON.stringify({ result: "tool_call" }),
      JSON.stringify({ result: "final_message", reply: "task 1 status draft" }),
    ].join("\n") + "\n",
    "utf8",
  );
  const stub = readMockRequests("stub", directory);
  assert.equal(stub?.rounds, 2);
  assert.equal(stub?.toolCalls, 1);
  assert.deepEqual(stub?.finalReplies, ["task 1 status draft"]);
  assert.equal(readMockRequests("vendor", directory), null);
});
test("a vendor run only passes with a real bridge tool call and its own turn", () => {
  assert.equal(acceptanceStatus(base), "PASS_REAL_VENDOR_TOOL_ROUND_TRIP");
  assert.equal(
    acceptanceStatus({ ...base, bridgeToolCalls: 0 }),
    "FAILED_AT_MODEL_TOOL_SELECTION",
  );
  assert.equal(
    acceptanceStatus({ ...base, bridgeToolErrors: 1 }),
    "FAILED_AT_PROTOCOL",
  );
  assert.equal(
    acceptanceStatus({ ...base, turnState: "unknown" }),
    "FAILED_AT_PROTOCOL",
  );
  assert.equal(
    acceptanceStatus({ ...base, agentMessage: "task 9999 status draft" }),
    "FAILED_AT_PROTOCOL",
  );
  assert.equal(
    acceptanceStatus({ ...base, tokenUsageTotal: 0 }),
    "FAILED_AT_PROTOCOL",
  );
});
test("a stub run reports the stub status, never the vendor one", () => {
  const stub: AcceptanceFacts = {
    ...base,
    mode: "stub",
    tokenUsageTotal: null,
    stubRounds: 2,
    agentMessage: "task 1111 status draft",
  };
  assert.equal(
    acceptanceStatus(stub),
    "PASS_REAL_CLIENT_WITH_LOCAL_MODEL_STUB",
  );
  assert.equal(
    acceptanceStatus({ ...stub, stubRounds: 1 }),
    "FAILED_AT_PROTOCOL",
  );
  assert.equal(
    acceptanceStatus({ ...stub, bridgeToolCalls: 0 }),
    "FAILED_AT_PROTOCOL",
  );
});
test("harness, protocol and cleanup failures keep their own status", () => {
  assert.equal(
    acceptanceStatus({ ...base, harnessError: "boom" }),
    "FAILED_AT_HARNESS",
  );
  assert.equal(
    acceptanceStatus({ ...base, protocolError: "bad frame" }),
    "FAILED_AT_PROTOCOL",
  );
  assert.equal(
    acceptanceStatus({ ...base, cleanupComplete: false }),
    "FAILED_AT_HARNESS",
  );
  assert.equal(
    acceptanceStatus({ ...base, processUnchanged: false }),
    "FAILED_AT_HARNESS",
  );
});
test("the status vocabulary is exactly the agreed one", () => {
  assert.deepEqual(
    [...acceptanceStatuses],
    [
      "PASS_REAL_CLIENT_WITH_LOCAL_MODEL_STUB",
      "PASS_REAL_VENDOR_TOOL_ROUND_TRIP",
      "FAILED_AT_MODEL_TOOL_SELECTION",
      "FAILED_AT_HARNESS",
      "FAILED_AT_PROTOCOL",
      "NOT_RUN",
      "UNVERIFIED",
      "UNKNOWN",
    ],
  );
});
