// Acceptance-only MCP server. No project data, credentials, tools, prompts or outbound requests.
import { writeFileSync, renameSync } from "node:fs";
import { isAbsolute } from "node:path";
const [reportPath, timeoutText = "45000"] = process.argv.slice(2);
const timeout = Number(timeoutText);
if (
  !reportPath ||
  !isAbsolute(reportPath) ||
  !Number.isInteger(timeout) ||
  timeout < 50 ||
  timeout > 60000
)
  throw new Error("MCP_CONFIG");
const versions = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);
const report = {
  schema: 1,
  initialize_requests: 0,
  initialized: false,
  protocol_version: null,
  client_name: null,
  client_version: null,
  tools_list_requests: 0,
  resources_list_requests: 0,
  prompts_list_requests: 0,
  pings: 0,
  denied_requests: 0,
  outbound_requests: 0,
  exposed_tools: 0,
  exposed_resources: 0,
  exposed_prompts: 0,
  stdin_eof: false,
  fault: null,
};
let ended = false,
  pending = Buffer.alloc(0),
  total = 0,
  frames = 0,
  initializedResponse = false;
const ids = new Set();
function save() {
  writeFileSync(reportPath + ".tmp", JSON.stringify(report, null, 2) + "\n");
  renameSync(reportPath + ".tmp", reportPath);
}
function stop(fault = null) {
  if (ended) return;
  ended = true;
  clearTimeout(timer);
  report.fault ??= fault;
  try {
    save();
  } catch {
    process.stderr.write("MCP_REPORT_WRITE\n");
  }
  process.exitCode = report.fault ? 1 : 0;
  process.stdin.pause();
  process.stdin.destroy();
}
function fail(fault) {
  stop(fault);
}
function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("MCP_PROTOCOL");
  return value;
}
function label(value) {
  return typeof value === "string" && /^[A-Za-z0-9_. -]{1,80}$/.test(value);
}
function send(id, result, error) {
  process.stdout.write(
    JSON.stringify(
      error ? { jsonrpc: "2.0", id, error } : { jsonrpc: "2.0", id, result },
    ) + "\n",
  );
}
function receive(value) {
  const frame = object(value);
  if (
    frame.jsonrpc !== "2.0" ||
    typeof frame.method !== "string" ||
    "result" in frame ||
    "error" in frame
  )
    throw new Error("MCP_PROTOCOL");
  if (frame.id === undefined) {
    if (
      frame.method !== "notifications/initialized" ||
      !initializedResponse ||
      report.initialized
    )
      throw new Error("MCP_PROTOCOL");
    report.initialized = true;
    save();
    return;
  }
  if (!(
    Number.isSafeInteger(frame.id) ||
    (typeof frame.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(frame.id))
  ))
    throw new Error("MCP_PROTOCOL");
  const key = typeof frame.id + ":" + frame.id;
  if (ids.has(key)) throw new Error("MCP_PROTOCOL");
  ids.add(key);
  if (frame.method === "ping") {
    report.pings++;
    send(frame.id, {});
    save();
    return;
  }
  if (frame.method === "initialize") {
    if (initializedResponse) throw new Error("MCP_PROTOCOL");
    const params = object(frame.params),
      info = object(params.clientInfo);
    object(params.capabilities);
    if (
      typeof params.protocolVersion !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(params.protocolVersion) ||
      !label(info.name) ||
      !label(info.version)
    )
      throw new Error("MCP_PROTOCOL");
    report.initialize_requests++;
    report.protocol_version = versions.has(params.protocolVersion)
      ? params.protocolVersion
      : "2025-06-18";
    report.client_name = info.name;
    report.client_version = info.version;
    initializedResponse = true;
    send(frame.id, {
      protocolVersion: report.protocol_version,
      capabilities: { tools: {}, resources: {}, prompts: {} },
      serverInfo: { name: "agent-weave-claude-probe", version: "0.1.0" },
    });
  } else if (
    ["tools/list", "resources/list", "prompts/list"].includes(frame.method)
  ) {
    if (!report.initialized) throw new Error("MCP_PROTOCOL");
    const kind = frame.method.split("/")[0];
    report[kind + "_list_requests"]++;
    send(frame.id, { [kind]: [] });
  } else {
    report.denied_requests++;
    send(frame.id, undefined, {
      code: -32601,
      message: "Method unavailable in acceptance probe",
    });
    throw new Error("MCP_METHOD_DENIED");
  }
  save();
}
const timer = setTimeout(() => fail("MCP_TIMEOUT"), timeout);
try {
  writeFileSync(reportPath, "", { flag: "wx" });
  save();
} catch {
  clearTimeout(timer);
  process.stderr.write("MCP_REPORT_WRITE\n");
  process.exit(1);
}
process.stdin.on("data", (data) => {
  if (ended) return;
  total += data.length;
  if (total > 262144) return fail("MCP_INPUT_LIMIT");
  pending = Buffer.concat([pending, data]);
  while (!ended) {
    const end = pending.indexOf(10);
    if (end < 0) {
      if (pending.length > 65536) fail("MCP_FRAME_LIMIT");
      return;
    }
    const bytes = pending.subarray(0, end);
    pending = pending.subarray(end + 1);
    if (bytes.length > 65536) return fail("MCP_FRAME_LIMIT");
    if (++frames > 128) return fail("MCP_FRAME_COUNT");
    try {
      receive(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      );
    } catch (error) {
      fail(
        error instanceof Error && /^MCP_[A-Z_]+$/.test(error.message)
          ? error.message
          : "MCP_PROTOCOL",
      );
    }
  }
});
process.stdin.once("end", () => {
  report.stdin_eof = true;
  stop(
    pending.length
      ? "MCP_PROTOCOL"
      : !report.initialized
        ? "MCP_INCOMPLETE"
        : null,
  );
});
process.stdin.on("error", () => fail("MCP_STDIN"));
process.stdout.on("error", () => fail("MCP_STDOUT"));
