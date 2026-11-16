import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  codexHomeConfig,
  officialCodexLauncher,
  tomlSectionValue,
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

test("only the requested provider key is read out of an operator config", () => {
  const text = [
    'model = "gpt-x"',
    'model_provider = "custom"',
    "disable_response_storage = true",
    "[model_providers.custom]",
    'name = "custom"',
    'base_url = "http://127.0.0.1:15721/v1"',
    'wire_api = "responses"',
    'experimental_bearer_token = "local-only-token"',
    "requires_openai_auth = false",
    '[plugins."browser@openai-bundled"]',
    "enabled = true",
  ].join("\n");
  assert.equal(
    tomlSectionValue(text, "model_providers.custom", "base_url"),
    "http://127.0.0.1:15721/v1",
  );
  assert.equal(
    tomlSectionValue(
      text,
      "model_providers.custom",
      "experimental_bearer_token",
    ),
    "local-only-token",
  );
  assert.equal(tomlSectionValue(text, null, "model"), "gpt-x");
  // Bare TOML booleans are scalars too, not quoted strings.
  assert.equal(
    tomlSectionValue(text, "model_providers.custom", "requires_openai_auth"),
    "false",
  );
  assert.equal(
    tomlSectionValue(text, "model_providers.other", "base_url"),
    null,
  );
  assert.equal(
    tomlSectionValue(text, "model_providers.custom", "plugins"),
    null,
  );
});
test("a reused provider block must be a loopback Responses provider", () => {
  const text = codexHomeConfig({
    model_provider: {
      base_url: "http://127.0.0.1:15721/v1",
      model: "gpt-x",
      bearer_token: "local-only-token",
      label: "reuse",
    },
  });
  assert.match(text, /model_provider = "agent-weave-reuse"/);
  assert.match(text, /request_max_retries = 0/);
  assert.match(text, /stream_max_retries = 0/);
  assert.match(text, /experimental_bearer_token = "local-only-token"/);
  assert.match(text, /base_url = "http:\/\/127\.0\.0\.1:15721\/v1"/);
  for (const base_url of [
    "https://api.openai.com/v1",
    "http://10.0.0.1:15721/v1",
    "http://localhost:15721/v1",
    "http://127.0.0.1:99999/v1",
  ])
    assert.throws(
      () =>
        codexHomeConfig({
          model_provider: { base_url, model: "gpt-x", bearer_token: "t" },
        }),
      (error: unknown) =>
        error instanceof AdapterFault && error.code === "ADAPTER_CONTRACT",
      base_url,
    );
});
test("provider reuse is opt-in, exclusive with the local stub and needs a real file", () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-reuse-"));
  const real = join(dir, "config.toml");
  writeFileSync(real, 'model = "gpt-x"\nmodel_provider = "custom"\n', "utf8");
  const a = officialCodexLauncher({
    ...profile,
    provider_reuse: { source_config: real, provider_id: "custom" },
  });
  const b = officialCodexLauncher({
    ...profile,
    provider_reuse: { source_config: real, provider_id: "custom" },
  });
  assert.equal(a.fingerprint, b.fingerprint);
  // Different content means a different configuration fingerprint.
  writeFileSync(real, 'model = "gpt-y"\nmodel_provider = "custom"\n', "utf8");
  const c = officialCodexLauncher({
    ...profile,
    provider_reuse: { source_config: real, provider_id: "custom" },
  });
  assert.notEqual(c.fingerprint, a.fingerprint);
  assert.throws(
    () =>
      officialCodexLauncher({
        ...profile,
        provider_reuse: { source_config: real, provider_id: "custom" },
        model_provider: { base_url: "http://127.0.0.1:1", model: "m" },
      }),
    (error: unknown) =>
      error instanceof AdapterFault && error.code === "ADAPTER_CONTRACT",
  );
  assert.throws(
    () =>
      officialCodexLauncher({
        ...profile,
        provider_reuse: {
          source_config: join(dir, "missing.toml"),
          provider_id: "custom",
        },
      }),
    (error: unknown) =>
      error instanceof AdapterFault && error.code === "ADAPTER_CONTRACT",
  );
});

test("the code-mode surface can be pinned with the client's own field names", () => {
  const text = codexHomeConfig({
    code_mode: {
      enabled: true,
      direct_only_tool_namespaces: ["mcp__agent_weave_probe"],
      excluded_tool_namespaces: ["clock"],
    },
  });
  assert.match(text, /^\[features\.code_mode\]$/m);
  assert.match(text, /^enabled = true$/m);
  assert.match(
    text,
    /^direct_only_tool_namespaces = \["mcp__agent_weave_probe"\]$/m,
  );
  assert.match(text, /^excluded_tool_namespaces = \["clock"\]$/m);
  // Field names must match the fixed build exactly; the key probe recorded them.
  for (const banned of ["[code_mode]", "omit_tools_from", "capabilities."])
    assert.equal(text.includes(banned), false, banned);
  for (const bad of [
    { direct_only_tool_namespaces: ["not a name"] },
    { direct_only_tool_namespaces: [""] },
    { direct_only_tool_namespaces: ["a".repeat(65)] },
    { excluded_tool_namespaces: Array.from({ length: 9 }, (_, i) => "ns" + i) },
    { enabled: "yes" },
  ] as unknown[])
    assert.throws(
      () => codexHomeConfig({ code_mode: bad as never }),
      (error: unknown) =>
        error instanceof AdapterFault && error.code === "ADAPTER_CONTRACT",
      JSON.stringify(bad),
    );
});
test("a changed operator configuration is refused at launch, not silently reused", () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-digest-"));
  const source = join(dir, "config.toml");
  writeFileSync(source, 'model = "gpt-x"\nmodel_provider = "custom"\n', "utf8");
  const launcher = officialCodexLauncher({
    ...profile,
    provider_reuse: { source_config: source, provider_id: "custom" },
  });
  writeFileSync(source, 'model = "gpt-y"\nmodel_provider = "custom"\n', "utf8");
  // The pinned digest no longer matches, so the launch must fail before spawning.
  return assert.rejects(
    () => launcher.launch(() => true),
    (error: unknown) =>
      error instanceof AdapterFault && error.code === "CODEX_CONFIG_CHANGED",
  );
});
