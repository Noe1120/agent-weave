import { createHash } from "node:crypto";
import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

/** Trusted fresh-home composition only, not an OS isolation boundary or a scanner. */
export async function captureCodexHomeCleanup(
  dataRoot: string,
  workDirectory: string,
): Promise<() => Promise<void>> {
  const unsafe = () => new Error("CODEX_HOME_UNSAFE");
  if (!isAbsolute(dataRoot) || !isAbsolute(workDirectory)) throw unsafe();
  dataRoot = resolve(dataRoot);
  workDirectory = resolve(workDirectory);
  const attempt = dirname(workDirectory);
  if (
    dirname(attempt) !== dataRoot ||
    !/^codex-init-[A-Za-z0-9_-]+$/.test(basename(attempt)) ||
    basename(workDirectory) !== "work"
  )
    throw unsafe();
  const home = join(attempt, "home"),
    config = join(home, "config.toml");
  const identity = (path: string, file = false) => {
    const stat = lstatSync(path, { bigint: true });
    if (
      stat.isSymbolicLink() ||
      (file ? !stat.isFile() || stat.nlink !== 1n : !stat.isDirectory())
    )
      throw unsafe();
    return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
  };
  const inspect = () => {
    const directories: Record<string, string> = {};
    for (let path = home; ; path = dirname(path)) {
      directories[path] = identity(path);
      if (dirname(path) === path) break;
    }
    directories[workDirectory] = identity(workDirectory);
    const file = identity(config, true);
    const fd = openSync(config, "r");
    try {
      const stat = fstatSync(fd, { bigint: true });
      if (
        !stat.isFile() ||
        stat.nlink !== 1n ||
        stat.size > 1048576n ||
        `${stat.dev}:${stat.ino}:${stat.birthtimeNs}` !== file
      )
        throw unsafe();
      const digest = createHash("sha256")
        .update(readFileSync(fd))
        .digest("hex");
      if (identity(config, true) !== file) throw unsafe();
      return JSON.stringify({ directories, file, digest });
    } finally {
      closeSync(fd);
    }
  };
  let captured: string;
  try {
    captured = inspect();
  } catch {
    throw unsafe();
  }
  let done = false;
  return async () => {
    if (done) return;
    try {
      if (inspect() !== captured) throw unsafe();
      // Only this captured regular file, never recursive deletion or a user list.
      unlinkSync(config);
      done = true;
    } catch {
      throw new Error("CODEX_HOME_CLEANUP_FAILED");
    }
  };
}
