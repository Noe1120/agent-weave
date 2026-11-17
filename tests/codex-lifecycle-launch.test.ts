import test from "node:test";
import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { officialCodexLauncher } from "../packages/service/src/codex-app-server.ts";
import { captureCodexHomeCleanup } from "../packages/service/src/codex-home-cleanup.ts";
import { tempWorkspace } from "./temp.ts";

test("trusted preparation captures fresh config and cleans it when authorization is lost before spawn", async (t) => {
  const temp = tempWorkspace();
  t.after(() => temp.dispose());
  const install = join(temp.directory, "install"),
    data = join(temp.directory, "data");
  mkdirSync(install);
  mkdirSync(data);
  const exe = join(install, "codex.exe");
  copyFileSync(process.execPath, exe);
  let authorized = true,
    prepared = false,
    config = "";
  const launcher = officialCodexLauncher(
    {
      installation_root: install,
      data_root: data,
      client_version: "synthetic",
      executable_sha256: createHash("sha256")
        .update(readFileSync(exe))
        .digest("hex"),
      code_mode: { enabled: true },
    },
    {
      async prepare(work) {
        prepared = true;
        config = join(work, "..", "home", "config.toml");
        assert.equal(existsSync(config), true);
        const cleanup = await captureCodexHomeCleanup(data, work);
        authorized = false;
        return {
          attach() {
            assert.fail("must never spawn or attach");
          },
          abort: cleanup,
        };
      },
    },
  );
  await assert.rejects(
    launcher.launch(() => authorized),
    /CODEX_AUTHORIZATION_CHANGED/,
  );
  assert.equal(prepared, true);
  assert.equal(existsSync(config), false);
  assert.equal(readdirSync(data).length, 1);
});
