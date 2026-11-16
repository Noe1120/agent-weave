// Fault injection only; never evidence of a real MCP handshake or successful close.
import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";
const mode = process.argv[2],
  report = process.argv[3];
createInterface({ input: process.stdin }).on("line", (text) => {
  const frame = JSON.parse(text);
  if (frame.id === undefined) return;
  if (mode === "hang") return;
  if (mode === "exit") process.exit(9);
  if (mode === "invalid") return process.stdout.write("not-json\n");
  if (mode === "oversized") return process.stdout.write("x".repeat(131073));
  process.stdout.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: mode === "foreign" ? 999 : frame.id,
      result: {},
    }) + "\n",
  );
});
process.stdin.on("end", () => {
  if (mode === "exit-hang") {
    setInterval(() => {}, 1000);
    return;
  }
  if (mode === "no-eof")
    writeFileSync(
      report,
      JSON.stringify({
        initialized: true,
        stdin_eof: false,
        fault: null,
        tool_errors: 0,
      }),
    );
  process.exit(mode === "nonzero" ? 8 : 0);
});
