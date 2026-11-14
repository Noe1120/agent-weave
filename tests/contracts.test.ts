import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  validateCore,
  validateRequest,
} from "../packages/contracts/src/index.ts";
const wire = JSON.parse(
  readFileSync("plan/contracts/wire-examples.json", "utf8"),
);
for (const sample of wire.examples) {
  test(sample.id + ": schema only, never semantic PASS", () => {
    assert.equal(
      validateCore(sample.payload),
      sample.expected_schema_valid,
      sample.reason,
    );
  });
}
const request = wire.examples.find(
  (s: any) => s.payload.kind === "register_wait",
).payload;
test("strict request accepts only operations, not response or event envelopes", () => {
  assert.equal(validateRequest(request), true);
  for (const sample of wire.examples.filter((s: any) =>
    ["service_result", "service_error", "visible_event"].includes(
      s.payload.kind,
    ),
  )) {
    assert.equal(validateRequest(sample.payload), false);
  }
});
test("reject unknown fields, versions, enum, malformed time/uuid/revision", () => {
  for (const delta of [
    { actor_id: request.run_id },
    { contract_version: "core/2.0" },
    { predicate: "task_failed" },
    { deadline: "2026-02-30T12:00:00Z" },
    { run_id: "x" },
    { run_epoch: "0" },
    { minimum_target_revision: "01" },
  ]) {
    assert.equal(
      validateRequest({ ...request, ...delta }),
      false,
      JSON.stringify(delta),
    );
  }
});
