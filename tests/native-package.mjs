import assert from "node:assert/strict";
import { readFile, readdir, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { assertLocalRoot } from "../packages/service/src/broker-paths.ts";
const root = resolve(process.argv[2] ?? "artifacts/Team-0.3.0-win-x64");
assertLocalRoot(root);
async function regular(path) {
  const stat = await lstat(path);
  assert.ok(
    stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1,
    "PACKAGE_UNSAFE_FILE",
  );
  return stat;
}
await regular(join(root, "package-manifest.json"));
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
async function walk(dir) {
  const files = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      assertLocalRoot(p);
      files.push(...(await walk(p)));
    } else {
      await regular(p);
      files.push(p.slice(root.length + 1).replaceAll("\\", "/"));
    }
  }
  return files;
}
assert.deepEqual(
  (await walk(root)).filter((x) => x !== "package-manifest.json").sort(),
  paths.sort(),
  "PACKAGE_INVENTORY_MISMATCH",
);
// Only dereference names from the manifest after matching the exact local inventory.
for (const file of manifest.files) {
  const path = join(root, file.path);
  const stat = await regular(path);
  assert.equal(stat.size, file.bytes, "PACKAGE_SIZE_MISMATCH");
  assert.equal(
    createHash("sha256")
      .update(await readFile(path))
      .digest("hex"),
    file.sha256,
    file.path,
  );
}
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
