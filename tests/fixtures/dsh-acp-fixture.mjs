// Synthetic ACP endpoint. Never a model or the original DSH client.
import { appendFileSync } from "node:fs";
const [mode, log] = process.argv.slice(2);
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (text) => {
  input += text;
  if (!input.includes("\n")) return;
  const line = input.slice(0, input.indexOf("\n"));
  if (log) appendFileSync(log, line + "\n");
  const request = JSON.parse(line);
  if (request.method !== "initialize") throw new Error("forbidden method");
  const response = {
    jsonrpc: "2.0",
    id: request.id,
    result: {
      protocolVersion: 1,
      agentInfo: { name: "deepseek-harness-acp", version: "0.0.1" },
      agentCapabilities: {
        mcpCapabilities: { http: true },
        promptCapabilities: {
          image: false,
          audio: false,
          embeddedContext: false,
        },
        sessionCapabilities: { close: {}, list: {}, resume: {} },
      },
      authMethods: [],
    },
  };
  const send = () => process.stdout.write(JSON.stringify(response) + "\n");
  if (mode === "timeout") return;
  if (mode === "garbage") return process.stdout.write("not json\n");
  if (mode === "huge") return process.stdout.write("x".repeat(70000));
  if (mode === "utf8") return process.stdout.write(Buffer.from([255, 10]));
  if (mode === "request")
    return process.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "session/request_permission",
        params: {},
      }) + "\n",
    );
  if (mode === "error")
    return process.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -1, message: "private-secret-not-for-projection" },
      }) + "\n",
    );
  if (mode === "wrong-id") response.id = 2;
  if (mode === "wrong-agent") response.result.agentInfo.name = "another-agent";
  if (mode === "wrong-version") response.result.protocolVersion = 2;
  if (mode === "auth")
    response.result.authMethods = [{ id: "login", name: "Login" }];
  if (mode === "exit") return process.exit(7);
  if (mode === "stderr")
    process.stderr.write("private-secret-not-for-projection\n");
  if (mode === "delayed") return setTimeout(send, 100);
  if (mode === "chunked") {
    const s = JSON.stringify(response) + "\n";
    for (let i = 0; i < s.length; i += 7)
      process.stdout.write(s.slice(i, i + 7));
    return;
  }
  if (mode === "duplicate-hang")
    return process.stdout.write((JSON.stringify(response) + "\n").repeat(2));
  send();
  if (mode === "duplicate") send();
  if (mode === "late-duplicate-hang") setTimeout(send, 100);
  if (mode === "crash") setTimeout(() => process.exit(9), 30);
});
process.stdin.on("end", () => {
  if (
    mode === "hang" ||
    mode === "duplicate-hang" ||
    mode === "late-duplicate-hang"
  )
    setInterval(() => {}, 1000);
  else process.exit(mode === "bad-exit" ? 4 : 0);
});
