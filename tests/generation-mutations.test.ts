import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { tempWorkspace } from "./temp.ts";
const require = createRequire(import.meta.url);
for (const mutation of ["types", "openapi", "mapping-source"])
  test("isolated generation drift is rejected: " + mutation, () => {
    const temp = tempWorkspace();
    try {
      for (const dir of ["scripts", "plan", "packages/contracts/src"])
        mkdirSync(join(temp.directory, dir), { recursive: true });
      cpSync("plan/contracts", join(temp.directory, "plan/contracts"), {
        recursive: true,
      });
      cpSync(
        "packages/contracts/src/generated",
        join(temp.directory, "packages/contracts/src/generated"),
        { recursive: true },
      );
      cpSync("generated", join(temp.directory, "generated"), {
        recursive: true,
      });
      const generator = readFileSync(
        "scripts/generate-contracts.mjs",
        "utf8",
      ).replace(
        '"json-schema-to-typescript"',
        JSON.stringify(
          pathToFileURL(require.resolve("json-schema-to-typescript")).href,
        ),
      );
      writeFileSync(
        join(temp.directory, "scripts/generate-contracts.mjs"),
        generator,
      );
      const clean = spawnSync(
        process.execPath,
        [join(temp.directory, "scripts/generate-contracts.mjs"), "--check"],
        { encoding: "utf8" },
      );
      assert.equal(clean.status, 0, clean.stderr);
      const target =
        mutation === "types"
          ? "packages/contracts/src/generated/core.ts"
          : mutation === "openapi"
            ? "generated/openapi.json"
            : "plan/contracts/error-mapping.json";
      const file = join(temp.directory, target);
      const text = readFileSync(file, "utf8");
      if (mutation === "types")
        writeFileSync(file, text + "// synthetic drift\n");
      else {
        const object = JSON.parse(text);
        if (mutation === "openapi") delete object.paths["/v1/core/apply_plan"];
        else object.errors.PLAN_STALE.retry_class = "never";
        writeFileSync(file, JSON.stringify(object, null, 2) + "\n");
      }
      const mutated = readFileSync(file, "utf8");
      const bad = spawnSync(
        process.execPath,
        [join(temp.directory, "scripts/generate-contracts.mjs"), "--check"],
        { encoding: "utf8" },
      );
      assert.equal(bad.status, 1, bad.stdout + bad.stderr);
      assert.match(bad.stderr, /DRIFT/);
      assert.equal(readFileSync(file, "utf8"), mutated);
    } finally {
      temp.dispose();
    }
  });
