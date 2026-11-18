import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, linkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { tempWorkspace } from "./temp.ts";

for (const mode of ["size", "escape", "hardlink"] as const)
  test(`native package preflight rejects ${mode} before trusting manifest contents`, (t) => {
    const tmp = tempWorkspace();
    t.after(() => tmp.dispose());
    const root = join(tmp.directory, "package");
    mkdirSync(root);
    const data = Buffer.from("synthetic"),
      sha256 = createHash("sha256").update(data).digest("hex");
    const files = [
      "Team.exe",
      "Team.dll",
      "PresentationFramework.dll",
      "runtime/node.exe",
      "service/packages/service/src/desktop-entry.js",
      "service/packages/contracts/src/generated/workspace.schema.json",
    ].map((path) => {
      const file = join(root, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, data);
      return { path, bytes: data.length, sha256 };
    });
    if (mode === "size") files[0]!.bytes++;
    if (mode === "escape")
      files.push({ path: "../outside", bytes: data.length, sha256 });
    if (mode === "hardlink") {
      linkSync(join(root, "Team.exe"), join(tmp.directory, "outside"));
    }
    writeFileSync(
      join(root, "package-manifest.json"),
      JSON.stringify({ kind: "native-wpf", files }),
    );
    const res = spawnSync(
      process.execPath,
      [resolve("tests/native-package.mjs"), root],
      { encoding: "utf8", windowsHide: true },
    );
    assert.equal(res.status, 1);
    assert.match(
      res.stderr,
      mode === "size"
        ? /PACKAGE_SIZE_MISMATCH/
        : mode === "escape"
          ? /PACKAGE_INVENTORY_MISMATCH/
          : /PACKAGE_UNSAFE_FILE/,
    );
  });
