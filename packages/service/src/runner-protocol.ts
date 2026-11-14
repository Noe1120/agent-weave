import type { ClaimRequest } from "./broker.ts";
export class RunnerFault extends Error {}
export function demandRunner(value: unknown, code: string): asserts value {
  if (!value) throw new RunnerFault(code);
}
export const runnerId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
export function objectKeys(
  value: unknown,
  keys: string[],
  code: string,
): asserts value is Record<string, unknown> {
  demandRunner(
    value !== null && typeof value === "object" && !Array.isArray(value),
    code,
  );
  demandRunner(
    Object.keys(value).length === keys.length &&
      Object.keys(value).every((k) => keys.includes(k)),
    code,
  );
}
export const scenarios = [
  "success",
  "idle",
  "malformed",
  "oversized",
  "flood",
  "stderr",
  "nonzero",
  "fake_exit",
  "descendants",
  "replay",
  "conflict",
  "out_of_order",
  "no_complete",
  "invalid_utf8",
  "host_crash",
  "unauthorized_patch",
  "complete_hold",
] as const;
export interface RunnerInput {
  scenario: (typeof scenarios)[number];
}
export interface StartRequest {
  execution_id: string;
  claim: ClaimRequest;
  adapter: "development_fixture";
  input: RunnerInput;
  timeout_ms: number;
}
export function validateStart(value: unknown): StartRequest {
  objectKeys(
    value,
    ["execution_id", "claim", "adapter", "input", "timeout_ms"],
    "INVALID_REQUEST",
  );
  demandRunner(value.adapter === "development_fixture", "ADAPTER_DISABLED");
  objectKeys(
    value.claim,
    [
      "project_id",
      "workspace_id",
      "scope_id",
      "claim_id",
      "expected_task_revision",
      "lease_ms",
    ],
    "INVALID_REQUEST",
  );
  for (const k of ["project_id", "workspace_id", "scope_id", "claim_id"])
    demandRunner(runnerId(value.claim[k]), "INVALID_REQUEST");
  demandRunner(
    runnerId(value.execution_id) &&
      typeof value.claim.expected_task_revision === "string" &&
      /^\d+$/.test(value.claim.expected_task_revision),
    "INVALID_REQUEST",
  );
  demandRunner(
    Number.isSafeInteger(value.claim.lease_ms) &&
      Number(value.claim.lease_ms) <= 300000 &&
      Number(value.claim.lease_ms) > 0,
    "INVALID_REQUEST",
  );
  demandRunner(
    Number.isSafeInteger(value.timeout_ms) &&
      Number(value.timeout_ms) >= 200 &&
      Number(value.timeout_ms) <= Number(value.claim.lease_ms),
    "INVALID_REQUEST",
  );
  objectKeys(value.input, ["scenario"], "INVALID_REQUEST");
  demandRunner(
    scenarios.includes(value.input.scenario as RunnerInput["scenario"]),
    "INVALID_REQUEST",
  );
  // Detach caller-owned mutable objects before storing the request fingerprint.
  return JSON.parse(JSON.stringify(value)) as StartRequest;
}
export type WorkerFrame =
  | { seq: number; kind: "progress"; text: string }
  | {
      seq: number;
      kind: "patch";
      edits: {
        path: string;
        before_digest: string | null;
        text: string | null;
      }[];
    }
  | { seq: number; kind: "complete" };
export function parseWorkerFrame(text: string): WorkerFrame {
  demandRunner(Buffer.byteLength(text) <= 65536, "PROTOCOL_FRAME_LIMIT");
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new RunnerFault("PROTOCOL_JSON");
  }
  demandRunner(v !== null && typeof v === "object", "PROTOCOL_SHAPE");
  const f = v as Record<string, unknown>;
  demandRunner(
    Number.isSafeInteger(f.seq) && Number(f.seq) >= 1 && Number(f.seq) <= 256,
    "PROTOCOL_SEQUENCE",
  );
  if (f.kind === "progress") {
    objectKeys(f, ["seq", "kind", "text"], "PROTOCOL_SHAPE");
    demandRunner(
      typeof f.text === "string" && Buffer.byteLength(f.text) <= 4096,
      "PROTOCOL_TEXT_LIMIT",
    );
  } else if (f.kind === "complete")
    objectKeys(f, ["seq", "kind"], "PROTOCOL_SHAPE");
  else if (f.kind === "patch") {
    objectKeys(f, ["seq", "kind", "edits"], "PROTOCOL_SHAPE");
    demandRunner(
      Array.isArray(f.edits) && f.edits.length > 0 && f.edits.length <= 128,
      "PROTOCOL_EDITS",
    );
    for (const e of f.edits) {
      objectKeys(e, ["path", "before_digest", "text"], "PROTOCOL_SHAPE");
      demandRunner(
        typeof e.path === "string" &&
          e.path.length <= 512 &&
          (e.before_digest === null ||
            (typeof e.before_digest === "string" &&
              /^[a-f\d]{64}$/.test(e.before_digest))) &&
          (e.text === null || typeof e.text === "string"),
        "PROTOCOL_EDIT",
      );
    }
  } else throw new RunnerFault("PROTOCOL_KIND");
  return f as WorkerFrame;
}
