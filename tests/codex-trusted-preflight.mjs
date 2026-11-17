// Compiled trusted launcher; deny before spawn, use only a Node copy/synthetic token.
import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { tempWorkspace } from "./temp.ts";
import { fixture } from "./helpers.ts";
import { officialCodexRelayLauncher } from "../dist/packages/service/src/codex-relay-launcher.js";
const temp = tempWorkspace(),
  f = fixture();
try {
  const install = join(temp.directory, "install"),
    data = join(temp.directory, "data"),
    bridges = join(temp.directory, "bridges");
  for (const dir of [install, data, bridges]) mkdirSync(dir);
  const exe = join(install, "codex.exe");
  copyFileSync(process.execPath, exe);
  const launcher = officialCodexRelayLauncher(
    {
      installation_root: install,
      data_root: data,
      client_version: "synthetic-preflight",
      executable_sha256: createHash("sha256")
        .update(readFileSync(exe))
        .digest("hex"),
    },
    {
      dataRoot: bridges,
      config: {
        version: 1,
        target: "codex",
        service_origin: "http://127.0.0.1:1",
        project_id: f.ids.project,
        token: f.token,
        task_ids: [f.ids.task],
        execution_ids: [],
        allow_message_poll: false,
        egress: {
          data_class: "synthetic_only",
          provider_fingerprint: "a".repeat(64),
          expires_at: new Date(Date.now() + 60000).toISOString(),
        },
      },
    },
  );
  let sawConfig = false;
  await assert.rejects(
    launcher.launch(() => {
      for (const name of readdirSync(data))
        if (existsSync(join(data, name, "home", "config.toml"))) {
          sawConfig = true;
          return false;
        }
      return true;
    }),
    /CODEX_AUTHORIZATION_CHANGED/,
  );
  assert.equal(sawConfig, true);
  assert.equal(readdirSync(data).length, 1);
  for (const name of readdirSync(data))
    assert.equal(existsSync(join(data, name, "home", "config.toml")), false);
  for (const name of readdirSync(bridges))
    assert.equal(existsSync(join(bridges, name, "bridge.json")), false);
  console.log(
    JSON.stringify({
      compiled_trusted_preflight: "PASS",
      client_processes_started: 0,
      model_calls: 0,
      home_and_bridge_capabilities_cleared: true,
    }),
  );
} finally {
  f.close();
  temp.dispose();
}
