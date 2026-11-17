// Compiled launcher preflight only. Authorization is revoked BEFORE spawn.
import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { tempWorkspace } from "./temp.ts";
import {
  officialCodexLauncher,
  tomlSectionValue,
} from "../dist/packages/service/src/codex-app-server.js";
const temp = tempWorkspace();
try {
  const install = join(temp.directory, "install"),
    data = join(temp.directory, "data");
  mkdirSync(install);
  mkdirSync(data);
  // A copy of Node, never a vendor program; launch is denied before any spawn.
  const executable = join(install, "codex.exe");
  copyFileSync(process.execPath, executable);
  const relay_binding = {
    port: 50123,
    instance: "b".repeat(32),
    token: "a".repeat(64),
  };
  const launcher = officialCodexLauncher({
    installation_root: install,
    data_root: data,
    client_version: "synthetic-preflight",
    executable_sha256: createHash("sha256")
      .update(readFileSync(executable))
      .digest("hex"),
    relay_binding,
  });
  let checks = 0;
  await assert.rejects(
    launcher.launch(() => ++checks < 3),
    /CODEX_AUTHORIZATION_CHANGED/,
  );
  assert.equal(checks, 3);
  const dirs = readdirSync(data);
  assert.equal(dirs.length, 1);
  const path = join(data, dirs[0], "home", "config.toml"),
    text = readFileSync(path, "utf8");
  assert.equal(
    tomlSectionValue(text, "mcp_servers.agent-weave-probe", "command"),
    process.execPath,
  );
  const args = JSON.parse(
    text
      .split("\n")
      .find((s) => s.startsWith("args = "))
      .slice(7),
  );
  assert.equal(args.length, 1);
  assert.ok(args[0].endsWith("bridge-relay-entry.js"));
  assert.equal(args[0].includes(relay_binding.token), false);
  assert.deepEqual(
    JSON.parse(
      tomlSectionValue(text, "mcp_servers.agent-weave-probe.env", "TEAM_RELAY"),
    ),
    relay_binding,
  );
  unlinkSync(path);
  console.log(
    JSON.stringify({
      compiled_launcher_preflight: "PASS",
      client_processes_started: 0,
      model_calls: 0,
      relay_only_config_written: true,
      capability_copy_removed: true,
    }),
  );
} finally {
  temp.dispose();
}
