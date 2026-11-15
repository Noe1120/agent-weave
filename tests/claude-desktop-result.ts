// Summarize evidence, not intent. Job-empty alone never certifies packaged-client cleanup.
export function summarizeClaudeAttempt({
  mcp,
  jobEmpty,
  existingClientsUnchanged,
  hostExitObserved,
  hostExitCode,
  hostFault,
}: {
  mcp: {
    initialize_requests: number;
    initialized: boolean;
    tools_list_requests: number;
    fault: string | null;
  } | null;
  jobEmpty: boolean;
  existingClientsUnchanged: boolean;
  hostExitObserved: boolean;
  hostExitCode: number | null;
  hostFault: string | null;
}) {
  const transport =
    mcp?.initialize_requests === 1 &&
    mcp.initialized === true &&
    mcp.tools_list_requests > 0 &&
    mcp.fault === null;
  const cleanup =
    jobEmpty === true &&
    existingClientsUnchanged === true &&
    hostExitObserved === true &&
    hostExitCode === 0 &&
    hostFault === null;
  return {
    status: !cleanup
      ? "REAL_CLAUDE_CLEANUP_UNCONFIRMED"
      : transport
        ? "REAL_CLAUDE_MCP_HANDSHAKE_PASS"
        : "REAL_CLAUDE_MCP_NOT_PASSED",
    transport_handshake: transport,
    cleanup_confirmed: cleanup,
  };
}
