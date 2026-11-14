import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validateAdapterRegistration,
  evaluateCapability,
  type CapabilityFacts,
} from "../packages/service/src/adapter-contract.ts";
import { randomUUID } from "node:crypto";
export const registration = () => ({
  project_id: randomUUID(),
  binding_id: randomUUID(),
  scope_id: randomUUID(),
  action_id: randomUUID(),
  expected_revision: "0",
  target: "codex",
  binding_mode: "attached_session",
  client_version: "fixture-1",
  protocol_version: "fixture-1",
  instance_id: "synthetic-instance",
  session_id: "synthetic-session",
  configuration_fingerprint: "a".repeat(64),
  capabilities: ["progress", "detach"],
});
const facts = (): CapabilityFacts => ({
  supported: "supported",
  available: true,
  allowed: true,
  qualification: "VERIFIED",
  observedFingerprint: "a".repeat(64),
  currentFingerprint: "a".repeat(64),
  evidenceIds: ["synthetic-evidence"],
});
test("adapter registration is strict, detached from caller objects", () => {
  const value = registration();
  const parsed = validateAdapterRegistration(value);
  assert.deepEqual(parsed, value);
  parsed.capabilities.push("interrupt");
  assert.equal(value.capabilities.length, 2);
});
for (const patch of [
  { target: "claude_code" },
  { target: "dsh_desktop" },
  { binding_mode: "automatic" },
  { command: "cmd" },
  { env: { TOKEN: "secret" } },
  { qualification: "VERIFIED" },
  { allowed: true },
  { grant_id: randomUUID() },
  { client_version: "" },
  { protocol_version: "" },
  { instance_id: "" },
  { session_id: "" },
  { configuration_fingerprint: "abc" },
  { expected_revision: "-1" },
  { capabilities: ["shell"] },
  { capabilities: ["progress", "progress"] },
  { scope_id: "bad" },
])
  test("reject registration " + JSON.stringify(patch), () =>
    assert.throws(
      () => validateAdapterRegistration({ ...registration(), ...patch }),
      /ADAPTER_CONTRACT/,
    ),
  );
for (const [patch, reason] of [
  [{ allowed: false, supported: "unsupported" }, "DENIED"],
  [
    { currentFingerprint: "b".repeat(64), supported: "unsupported" },
    "CONFIG_CHANGED",
  ],
  [{ supported: "unsupported" }, "UNSUPPORTED"],
  [{ supported: "unverified" }, "UNVERIFIED"],
  [{ available: false }, "UNAVAILABLE"],
  [{ qualification: "UNVERIFIED" }, "UNVERIFIED"],
  [{ evidenceIds: [] }, "EVIDENCE_MISSING"],
  [{}, "READY"],
] as const)
  test("capability reason " + reason, () => {
    const f = { ...facts(), ...patch } as CapabilityFacts;
    const before = structuredClone(f);
    const actual = evaluateCapability(f);
    assert.equal(actual.reason, reason);
    assert.equal(actual.enabled, reason === "READY");
    assert.deepEqual(evaluateCapability(f), actual);
    assert.deepEqual(f, before);
  });
test("malformed trusted facts fail closed", () => {
  assert.throws(
    () =>
      evaluateCapability({
        ...facts(),
        available: "yes",
      } as unknown as CapabilityFacts),
    /ADAPTER_CONTRACT/,
  );
});
