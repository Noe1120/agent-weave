import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
const mode = process.argv[2] ?? "ok";
const sessionId = "a65577b1-04d9-4e6e-83db-8fe306bcd401";
const output = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const hello = {
  protocolVersion: 1,
  agentInfo: { name: "deepseek-harness-acp", version: "0.0.1" },
  agentCapabilities: {
    mcpCapabilities: { http: true },
    promptCapabilities: { image: false, audio: false, embeddedContext: false },
    sessionCapabilities: { close: {}, list: {}, resume: {} },
  },
  authMethods: [],
};
const reader = createInterface({ input: process.stdin });
const requests = [];
reader.on("line", (line) => {
  const frame = JSON.parse(line);
  requests.push(frame);
  process.stderr.write(JSON.stringify(frame) + "\n");
  if (frame.id === 1) {
    if (mode === "initialize-timeout") return;
    if (mode === "auth") hello.authMethods = [{ id: "login" }];
    if (mode === "changed-hello") hello.agentInfo.version = "changed";
    output({ jsonrpc: "2.0", id: 1, result: hello });
    if (mode === "duplicate-hello")
      output({ jsonrpc: "2.0", id: 1, result: hello });
  } else if (frame.id === 2) {
    if (mode === "new-timeout") return;
    if (mode === "disconnect") return process.exit(0);
    if (mode === "truncated") {
      process.stdout.write('{"jsonrpc":');
      return process.exit(0);
    }
    if (mode === "malformed") return process.stdout.write("not json\n");
    if (mode === "invalid-utf8")
      return process.stdout.write(Buffer.from([0xff, 10]));
    if (mode === "flood") return process.stdout.write("x".repeat(262145));
    if (mode === "long-frame")
      return process.stdout.write("x".repeat(65537) + "\n");
    if (mode === "stderr-flood") return process.stderr.write("x".repeat(65537));
    if (mode === "permission-held-pipe")
      spawn(process.execPath, ["-e", "setTimeout(()=>{},9000)"], {
        detached: true,
        windowsHide: true,
        stdio: ["ignore", 1, 2],
      }).unref();
    if (mode === "permission" || mode === "permission-held-pipe")
      return output({
        jsonrpc: "2.0",
        id: 77,
        method: "session/request_permission",
        params: { sessionId },
      });
    if (mode === "notification")
      return output({
        jsonrpc: "2.0",
        method: "session/update",
        params: { sessionId },
      });
    if (mode === "new-error")
      return output({
        jsonrpc: "2.0",
        id: 2,
        error: { code: -32000, message: "private-secret" },
      });
    if (mode === "error-and-result")
      return output({
        jsonrpc: "2.0",
        id: 2,
        error: { code: -32000 },
        result: { sessionId },
      });
    if (mode === "missing-session")
      return output({ jsonrpc: "2.0", id: 2, result: {} });
    if (mode === "bad-session")
      return output({
        jsonrpc: "2.0",
        id: 2,
        result: { sessionId: "bad\nvalue" },
      });
    output({
      jsonrpc: "2.0",
      id: mode === "wrong-id" ? 20 : 2,
      result: {
        sessionId,
        configOptions: [{ id: "model", currentValue: "private-secret" }],
      },
    });
    if (mode === "duplicate-new")
      output({ jsonrpc: "2.0", id: 2, result: { sessionId } });
  } else if (frame.id === 3) {
    if (
      frame.method !== "session/close" ||
      frame.params.sessionId !== sessionId
    )
      process.exit(9);
    if (mode === "close-timeout") return;
    if (mode === "close-error")
      return output({
        jsonrpc: "2.0",
        id: 3,
        error: { code: -32001, message: "private-secret" },
      });
    output({ jsonrpc: "2.0", id: 3, result: mode === "bad-close" ? [] : {} });
    if (mode === "duplicate-close")
      output({ jsonrpc: "2.0", id: 3, result: {} });
  } else process.exit(10);
});
reader.on("close", () => {
  if (mode === "ignore-eof") setInterval(() => {}, 1000);
  // Exercise ordinary delayed root exit while the descendant keeps pipes open.
  else if (mode === "permission-held-pipe") setTimeout(() => {}, 600);
  else if (mode === "delayed-eof") setTimeout(() => {}, 600);
  else process.exitCode = mode === "exit-failure" ? 7 : 0;
});
