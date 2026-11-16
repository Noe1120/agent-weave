import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Pure planning and status logic for the Codex live acceptance harness.
 *
 * The harness itself is a script with real side effects; everything that decides
 * which evidence is read and which status is reported lives here so it can be
 * tested without launching anything. In particular, a vendor attempt never reads
 * the local stub's request log: that file does not exist in vendor mode, and
 * reading it unconditionally was a real defect.
 */
export type AcceptanceMode = "initialize" | "thread" | "stub" | "vendor";

export const acceptanceStatuses = [
  "PASS_REAL_CLIENT_WITH_LOCAL_MODEL_STUB",
  "PASS_REAL_VENDOR_TOOL_ROUND_TRIP",
  "FAILED_AT_MODEL_TOOL_SELECTION",
  "FAILED_AT_HARNESS",
  "FAILED_AT_PROTOCOL",
  "NOT_RUN",
  "UNVERIFIED",
  "UNKNOWN",
] as const;
export type AcceptanceStatus = (typeof acceptanceStatuses)[number];

export interface AcceptanceFlags {
  initialize: boolean;
  thread: boolean;
  turn: boolean;
  vendor: boolean;
}
export function acceptanceMode(flags: AcceptanceFlags): AcceptanceMode {
  if (!flags.initialize)
    throw new Error("initialize authorization is required");
  if (!flags.thread) return "initialize";
  if (!flags.turn) return "thread";
  return flags.vendor ? "vendor" : "stub";
}
/** Evidence files this mode is allowed to read. */
export function evidenceFiles(mode: AcceptanceMode): string[] {
  switch (mode) {
    case "initialize":
      return ["process-before.json"];
    case "thread":
      return ["process-before.json", "bridge-reports"];
    case "stub":
      // Only the stub mode has a local model request log.
      return ["process-before.json", "bridge-reports", "mock-requests.jsonl"];
    case "vendor":
      // A vendor attempt has no local stub, so it must never look for its log.
      return ["process-before.json", "bridge-reports"];
  }
}
export const readsMockRequests = (mode: AcceptanceMode) =>
  evidenceFiles(mode).includes("mock-requests.jsonl");

/**
 * Read the local stub's request log. Returns null for every mode that has no
 * stub, and never dereferences an undefined path.
 */
export function readMockRequests(
  mode: AcceptanceMode,
  directory: string,
): { rounds: number; toolCalls: number; finalReplies: string[] } | null {
  if (!readsMockRequests(mode)) return null;
  let text: string;
  try {
    text = readFileSync(join(directory, "mock-requests.jsonl"), "utf8");
  } catch {
    return null;
  }
  const lines = text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as { result?: string; reply?: string };
      } catch {
        return null;
      }
    })
    .filter((row): row is { result?: string; reply?: string } => row !== null);
  return {
    rounds: lines.length,
    toolCalls: lines.filter((row) => row.result === "tool_call").length,
    finalReplies: lines
      .filter((row) => row.result === "final_message")
      .map((row) => String(row.reply ?? "")),
  };
}
/**
 * A level passes when nothing it checked failed and the run was left clean.
 * This is deliberately separate from the qualification status: a passing
 * initialize still does not qualify the client for tool round trips.
 */
export function levelPassed(facts: AcceptanceFacts): boolean {
  return (
    !facts.harnessError &&
    !facts.protocolError &&
    facts.processUnchanged &&
    facts.cleanupComplete
  );
}
export interface AcceptanceFacts {
  mode: AcceptanceMode;
  bridgeConnections: number;
  bridgeToolCalls: number;
  bridgeToolErrors: number;
  bridgeFaults: number;
  turnState: string | null;
  agentMessage: string | null;
  tokenUsageTotal: number | null;
  taskId: string | null;
  stubRounds: number | null;
  processUnchanged: boolean;
  cleanupComplete: boolean;
  harnessError: string | null;
  protocolError: string | null;
}
/**
 * Decide the status from observed facts. Every branch is explicit: a vendor
 * attempt can only pass with a bridge tool call and its own terminal turn.
 */
export function acceptanceStatus(facts: AcceptanceFacts): AcceptanceStatus {
  if (facts.harnessError) return "FAILED_AT_HARNESS";
  if (facts.protocolError) return "FAILED_AT_PROTOCOL";
  if (!facts.processUnchanged || !facts.cleanupComplete)
    return "FAILED_AT_HARNESS";
  if (facts.mode === "initialize" || facts.mode === "thread") {
    if (facts.bridgeConnections < 1 && facts.mode === "thread")
      return "FAILED_AT_PROTOCOL";
    return "UNVERIFIED";
  }
  const toolRoundTrip =
    facts.bridgeConnections >= 1 &&
    facts.bridgeToolCalls === 1 &&
    facts.bridgeToolErrors === 0 &&
    facts.bridgeFaults === 0 &&
    facts.turnState === "completed" &&
    Boolean(facts.taskId) &&
    Boolean(facts.agentMessage?.includes(String(facts.taskId)));
  if (facts.mode === "stub") {
    if (!toolRoundTrip) return "FAILED_AT_PROTOCOL";
    if (facts.stubRounds === null || facts.stubRounds < 2)
      return "FAILED_AT_PROTOCOL";
    return "PASS_REAL_CLIENT_WITH_LOCAL_MODEL_STUB";
  }
  // vendor
  if (toolRoundTrip && (facts.tokenUsageTotal ?? 0) > 0)
    return "PASS_REAL_VENDOR_TOOL_ROUND_TRIP";
  if (facts.bridgeConnections >= 1 && facts.bridgeToolCalls === 0)
    return "FAILED_AT_MODEL_TOOL_SELECTION";
  return "FAILED_AT_PROTOCOL";
}
