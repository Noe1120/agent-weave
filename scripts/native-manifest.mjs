import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
const root = resolve(process.argv[2]);
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (file !== join(root, "package-manifest.json")) {
      const data = await readFile(file);
      files.push({
        path: file.slice(root.length + 1).replaceAll("\\", "/"),
        sha256: createHash("sha256").update(data).digest("hex"),
        bytes: data.length,
      });
    }
  }
}
await walk(root);
files.sort((a, b) => a.path.localeCompare(b.path));
await writeFile(
  join(root, "package-manifest.json"),
  JSON.stringify(
    {
      kind: "native-wpf",
      version: "0.3.0",
      platform: "win-x64",
      node: process.versions.node,
      dotnet_sdk: process.argv[3],
      files,
    },
    null,
    2,
  ) + "\n",
);
