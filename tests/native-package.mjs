import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
const root = resolve(process.argv[2] ?? "artifacts/Team-0.3.0-win-x64");
const manifest = JSON.parse(
  await readFile(join(root, "package-manifest.json"), "utf8"),
);
assert.equal(manifest.kind, "native-wpf");
const paths = manifest.files.map((x) => x.path);
for (const required of [
  "Team.exe",
  "Team.dll",
  "PresentationFramework.dll",
  "runtime/node.exe",
  "service/packages/service/src/desktop-entry.js",
  "service/packages/contracts/src/generated/workspace.schema.json",
])
  assert.ok(paths.includes(required), required);
assert.ok(
  !paths.some((p) =>
    /packages\/web|webview|electron|chromium|playwright|\.sqlite|\.lock$|\.pdb$/i.test(
      p,
    ),
  ),
  "Forbidden UI/runtime/data in native distribution",
);
for (const file of manifest.files)
  assert.equal(
    createHash("sha256")
      .update(await readFile(join(root, file.path)))
      .digest("hex"),
    file.sha256,
    file.path,
  );
async function walk(dir) {
  const files = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) files.push(...(await walk(p)));
    else files.push(p.slice(root.length + 1).replaceAll("\\", "/"));
  }
  return files;
}
assert.deepEqual(
  (await walk(root)).filter((x) => x !== "package-manifest.json").sort(),
  paths.sort(),
  "Untracked package files",
);
console.log(
  JSON.stringify(
    {
      package: "PASS",
      files: paths.length,
      native_wpf: true,
      browser_runtime: false,
      databases_in_package: 0,
    },
    null,
    2,
  ),
);
