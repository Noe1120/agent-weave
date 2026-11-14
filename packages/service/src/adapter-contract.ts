export type AdapterTarget = "codex" | "claude_desktop" | "deepseek_harness";
export type BindingMode = "owned_process" | "attached_session";
export const capabilities = [
  "progress",
  "history",
  "send_message",
  "reply_wait",
  "approve",
  "interrupt",
  "detach",
] as const;
export type Capability = (typeof capabilities)[number];
export class AdapterFault extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "AdapterFault";
  }
}
export interface AdapterRegistration {
  project_id: string;
  binding_id: string;
  scope_id: string;
  action_id: string;
  expected_revision: string;
  target: AdapterTarget;
  binding_mode: BindingMode;
  client_version: string;
  protocol_version: string;
  instance_id: string;
  session_id: string;
  configuration_fingerprint: string;
  capabilities: Capability[];
}
export interface CapabilityFacts {
  supported: "supported" | "unsupported" | "unverified";
  available: boolean;
  allowed: boolean;
  qualification: "UNVERIFIED" | "VERIFIED";
  observedFingerprint: string;
  currentFingerprint: string;
  evidenceIds: string[];
}
export interface CapabilityDecision {
  enabled: boolean;
  reason:
    | "READY"
    | "UNSUPPORTED"
    | "UNVERIFIED"
    | "UNAVAILABLE"
    | "DENIED"
    | "CONFIG_CHANGED"
    | "EVIDENCE_MISSING";
}
export function contract(condition: unknown): asserts condition {
  if (!condition) throw new AdapterFault("ADAPTER_CONTRACT");
}
export const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
export const revision = (v: unknown): v is string =>
  typeof v === "string" && /^(0|[1-9][0-9]{0,17})$/.test(v);
export const fingerprint = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export const label = (v: unknown): v is string =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= 128 &&
  !/[\x00-\x1f\x7f]/.test(v) &&
  v.trim() === v;
export function validateAdapterRegistration(
  value: unknown,
): AdapterRegistration {
  contract(
    value !== null && typeof value === "object" && !Array.isArray(value),
  );
  const r = value as Record<string, unknown>;
  const keys = [
    "project_id",
    "binding_id",
    "scope_id",
    "action_id",
    "expected_revision",
    "target",
    "binding_mode",
    "client_version",
    "protocol_version",
    "instance_id",
    "session_id",
    "configuration_fingerprint",
    "capabilities",
  ];
  contract(
    Object.keys(r).length === keys.length &&
      keys.every((k) => Object.hasOwn(r, k)),
  );
  contract([r.project_id, r.binding_id, r.scope_id, r.action_id].every(uuid));
  contract(r.binding_id !== r.scope_id);
  contract(revision(r.expected_revision));
  contract(
    ["codex", "claude_desktop", "deepseek_harness"].includes(
      r.target as string,
    ),
  );
  contract(
    ["owned_process", "attached_session"].includes(r.binding_mode as string),
  );
  contract(
    [r.client_version, r.protocol_version, r.instance_id, r.session_id].every(
      label,
    ),
  );
  contract(fingerprint(r.configuration_fingerprint));
  contract(
    Array.isArray(r.capabilities) &&
      r.capabilities.length <= capabilities.length &&
      new Set(r.capabilities).size === r.capabilities.length &&
      r.capabilities.every((c) => capabilities.includes(c)),
  );
  return structuredClone(r) as unknown as AdapterRegistration;
}
export function evaluateCapability(f: CapabilityFacts): CapabilityDecision {
  contract(
    f &&
      ["supported", "unsupported", "unverified"].includes(f.supported) &&
      typeof f.available === "boolean" &&
      typeof f.allowed === "boolean" &&
      ["UNVERIFIED", "VERIFIED"].includes(f.qualification) &&
      fingerprint(f.observedFingerprint) &&
      fingerprint(f.currentFingerprint) &&
      Array.isArray(f.evidenceIds) &&
      f.evidenceIds.every(label),
  );
  const reason = !f.allowed
    ? "DENIED"
    : f.observedFingerprint !== f.currentFingerprint
      ? "CONFIG_CHANGED"
      : f.supported === "unsupported"
        ? "UNSUPPORTED"
        : f.supported === "unverified"
          ? "UNVERIFIED"
          : !f.available
            ? "UNAVAILABLE"
            : f.qualification !== "VERIFIED"
              ? "UNVERIFIED"
              : f.evidenceIds.length === 0
                ? "EVIDENCE_MISSING"
                : "READY";
  return { enabled: reason === "READY", reason };
}
