import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
  codexHomeConfig,
  officialCodexLauncher,
} from "../packages/service/src/codex-app-server.ts";
import { AdapterFault } from "../packages/service/src/adapter-contract.ts";

// The isolated home configuration and launcher input are trusted-side only.
// Nothing here spawns the real client.
const profile = {
  installation_root: resolve("tests/fixtures"),
  // The trusted data root must live outside the installation root.
  data_root: resolve("tests"),
  client_version: "0.167.0-alpha.3.2",
  executable_sha256: "a".repeat(64),
};
test("the isolated home config carries only the loopback provider and the platform bridge", () => {
  const text = codexHomeConfig({
    model_provider: { base_url: "http://127.0.0.1:60625", model: "mock-1" },
    bridge: {
      command: resolve("node.exe"),
      args: ["mcp-entry.js", "--config", "c.json", "--report-dir", "r"],
    },
  });
  assert.match(text, /^model = "mock-1"/);
  assert.match(text, /wire_api = "responses"/);
  assert.match(text, /requires_openai_auth = false/);
  assert.match(text, /\[mcp_servers\.agent-weave-probe\]/);
  assert.match(text, /startup_timeout_sec = 30/);
  // No user configuration surface may appear in this file.
  for (const banned of [
    "plugins",
    "marketplace",
    "node_repl",
    "approval_policy",
    "sandbox",
    "model_verbosity",
  ])
    assert.equal(text.includes(banned), false, banned);
  assert.equal(codexHomeConfig({}), "");
});
test("a non-loopback model endpoint, a missing model and a relative bridge are refused", () => {
  for (const base_url of [
    "http://10.0.0.1:8080",
    "https://api.openai.com/v1",
    "http://localhost:8080",
    "http://127.0.0.1",
    "http://127.0.0.1:99999",
  ])
    assert.throws(
      () => codexHomeConfig({ model_provider: { base_url, model: "m" } }),
      (error: unknown) =>
        error instanceof AdapterFault && error.code === "ADAPTER_CONTRACT",
      base_url,
    );
  assert.throws(() =>
    codexHomeConfig({
      model_provider: { base_url: "http://127.0.0.1:1", model: "" },
    }),
  );
  assert.throws(() =>
    codexHomeConfig({
      bridge: { command: "node.exe", args: ["x"] },
    }),
  );
});
test("the launcher rejects extra fields and arbitrary execution surface", () => {
  assert.throws(
    () =>
      officialCodexLauncher({
        ...profile,
        command: "cmd.exe /c whoami",
      }),
    (error: unknown) =>
      error instanceof AdapterFault && error.code === "ADAPTER_CONTRACT",
  );
  assert.throws(() =>
    officialCodexLauncher({
      ...profile,
      model_provider: { base_url: "http://127.0.0.1:1", model: "m", key: "x" },
    }),
  );
  assert.throws(() =>
    officialCodexLauncher({
      ...profile,
      bridge: { config_path: "relative.json", report_dir: "relative" },
    }),
  );
  assert.throws(() =>
    officialCodexLauncher({
      ...profile,
      executable_sha256: "not-a-hash",
    }),
  );
});
test("a valid profile yields a stable fingerprint that tracks the bridge", () => {
  const a = officialCodexLauncher({ ...profile });
  const b = officialCodexLauncher({ ...profile });
  assert.equal(a.fingerprint, b.fingerprint);
  assert.equal(a.source, "official_codex");
  const withBridge = officialCodexLauncher({
    ...profile,
    bridge: {
      config_path: resolve("tests/fixtures/codex.json"),
      report_dir: resolve("tests/fixtures"),
    },
  });
  assert.notEqual(withBridge.fingerprint, a.fingerprint);
});
