import {
  lstatSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdtempSync,
} from "node:fs";
import { parseArgs } from "node:util";
import { isAbsolute, join } from "node:path";
import { once } from "node:events";
import { McpReadClient } from "./mcp-read-client.ts";
import { McpSession } from "./mcp-session.ts";

// A fixed-scope stdio client of the existing local service. Never opens its DB,
// starts Desktop, calls a model or accepts credentials/URLs through MCP arguments.
const { values } = parseArgs({
  options: {
    config: { type: "string" },
    report: { type: "string" },
    "report-dir": { type: "string" },
  },
  strict: true,
});
let session: McpSession | undefined;
let report = values.report;
let eof = false,
  fault: string | null = null,
  reportCreated = false;
function save() {
  if (!report) return;
  if (!reportCreated) {
    writeFileSync(report, "", { flag: "wx" });
    reportCreated = true;
  }
  writeFileSync(
    report + ".tmp",
    JSON.stringify({ schema: 1, ...session?.stats, stdin_eof: eof, fault }) +
      "\n",
  );
  renameSync(report + ".tmp", report);
}
try {
  if (
    !values.config ||
    !isAbsolute(values.config) ||
    (values.report && !isAbsolute(values.report)) ||
    (values["report-dir"] && !isAbsolute(values["report-dir"])) ||
    (values.report && values["report-dir"])
  )
    throw new Error("MCP_CONFIG");
  const s = lstatSync(values.config);
  if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.size > 65536)
    throw new Error("MCP_CONFIG");
  let config: unknown;
  try {
    config = JSON.parse(readFileSync(values.config, "utf8"));
  } catch {
    throw new Error("MCP_CONFIG");
  }
  session = new McpSession(new McpReadClient(config));
  if (values["report-dir"]) {
    const directory = lstatSync(values["report-dir"]);
    if (!directory.isDirectory() || directory.isSymbolicLink())
      throw new Error("MCP_CONFIG");
    // Desktop may launch separate discovery and task connections with identical arguments.
    // Keep exclusive ownership of each report instead of overwriting another process's evidence.
    report = join(
      mkdtempSync(join(values["report-dir"], "connection-")),
      "report.json",
    );
  }
  save();
  process.stdout.on("error", () =>
    process.stdin.destroy(new Error("MCP_STDOUT")),
  );
  let pending = Buffer.alloc(0),
    total = 0,
    frames = 0;
  for await (const data of process.stdin) {
    const bytes = Buffer.from(data);
    total += bytes.length;
    if (total > 1048576) throw new Error("MCP_INPUT_LIMIT");
    pending = Buffer.concat([pending, bytes]);
    for (;;) {
      const i = pending.indexOf(10);
      if (i < 0) {
        if (pending.length > 65536) throw new Error("MCP_FRAME_LIMIT");
        break;
      }
      if (i > 65536) throw new Error("MCP_FRAME_LIMIT");
      if (++frames > 1000) throw new Error("MCP_FRAME_COUNT");
      const line = pending.subarray(0, i);
      pending = pending.subarray(i + 1);
      let frame: unknown;
      try {
        frame = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(line),
        );
      } catch {
        throw new Error("MCP_PROTOCOL");
      }
      const response = await session.receive(frame);
      if (response) {
        const text = JSON.stringify(response) + "\n";
        if (Buffer.byteLength(text) > 131072)
          throw new Error("MCP_OUTPUT_LIMIT");
        if (!process.stdout.write(text)) await once(process.stdout, "drain");
      }
      save();
    }
  }
  eof = true;
  if (pending.length) throw new Error("MCP_PROTOCOL");
  if (!session.stats.initialized) throw new Error("MCP_INCOMPLETE");
  save();
} catch (e) {
  fault =
    e instanceof Error && /^MCP_[A-Z_]+$/.test(e.message)
      ? e.message
      : "MCP_IO";
  process.exitCode = 1;
  try {
    save();
  } catch {
    process.stderr.write("MCP_REPORT_WRITE\n");
  }
  process.stderr.write(fault + "\n");
  process.stdin.destroy();
}
