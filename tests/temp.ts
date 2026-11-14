import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
export function tempWorkspace() {
  const parent = realpathSync(tmpdir());
  const directory = mkdtempSync(join(parent, "team-w03-"));
  return {
    directory,
    db: join(directory, "core.sqlite"),
    dispose() {
      const target = realpathSync(directory);
      if (
        dirname(target) !== parent ||
        !basename(target).startsWith("team-w03-") ||
        resolve(target) === resolve(parent)
      )
        throw new Error("Unsafe cleanup target");
      rmSync(target, { recursive: true, force: false });
    },
  };
}
