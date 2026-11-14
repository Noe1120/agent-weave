import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, parse, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { digest } from "./store.ts";
export class BrokerFault extends Error {
  constructor(code: string) {
    super(code);
    this.name = "BrokerFault";
  }
}
export function demand(ok: unknown, code: string): asserts ok {
  if (!ok) throw new BrokerFault(code);
}
export function logicalPath(value: string, metadata = false): string {
  demand(
    typeof value === "string" &&
      value.length > 0 &&
      value.length <= 240 &&
      value.normalize("NFC") === value,
    "INVALID_PATH",
  );
  const parts = value.split("/");
  demand(
    parts.every(
      (s) =>
        s.length > 0 &&
        s !== "." &&
        s !== ".." &&
        !s.includes("~") &&
        !/[\\<>:"|?*\x00-\x1f\x7f]/u.test(s) &&
        !/[. ]$/.test(s) &&
        !/^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(\.|$)/i.test(
          s,
        ) &&
        !/^\.git$/i.test(s),
    ),
    "INVALID_PATH",
  );
  demand(
    metadata || !parts.some((s) => s.toLowerCase() === ".team"),
    "INVALID_PATH",
  );
  return value.toLowerCase();
}
export function overlaps(a: string, b: string) {
  return a === b || a.startsWith(b + "/") || b.startsWith(a + "/");
}
export function assertLocalRoot(root: string) {
  demand(
    isAbsolute(root) && !root.startsWith("\\\\") && !root.startsWith("//"),
    "UNSAFE_PATH",
  );
  const full = resolve(root);
  let current = parse(full).root;
  for (const part of full
    .slice(current.length)
    .split(/[\\/]/)
    .filter(Boolean)) {
    current = join(current, part);
    if (!existsSync(current)) continue;
    const st = lstatSync(current);
    demand(st.isDirectory() && !st.isSymbolicLink(), "UNSAFE_PATH");
  }
  return full;
}
export function filePath(
  root: string,
  relative: string,
  create = false,
): string {
  logicalPath(relative, true);
  assertLocalRoot(root);
  demand(
    realpathSync(root).toLowerCase() === resolve(root).toLowerCase(),
    "UNSAFE_PATH",
  );
  const parts = relative.split("/");
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    if (!existsSync(current)) {
      // lstat also catches dangling reparse points, which existsSync deliberately follows.
      try {
        lstatSync(current);
        throw new BrokerFault("UNSAFE_PATH");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      if (create && index < parts.length - 1) mkdirSync(current);
      continue;
    }
    const st = lstatSync(current);
    demand(!st.isSymbolicLink(), "UNSAFE_PATH");
    if (index < parts.length - 1) demand(st.isDirectory(), "UNSAFE_PATH");
    else demand(st.isFile() && st.nlink === 1, "UNSAFE_PATH");
  }
  return current;
}
export function readText(root: string, path: string): string | null {
  const file = filePath(root, path);
  if (!existsSync(file)) return null;
  const bytes = readFileSync(file);
  const text = bytes.toString("utf8");
  demand(Buffer.from(text, "utf8").equals(bytes), "UNSUPPORTED_FILE_ENCODING");
  return text;
}
export const textDigest = (text: string | null) =>
  text === null ? null : digest(text);
export function replaceText(root: string, path: string, text: string | null) {
  const target = filePath(root, path, true);
  if (text === null) {
    if (existsSync(target)) unlinkSync(target);
    return;
  }
  // Temp resides beside the target: rename is a single same-volume replacement.
  const temp = target + ".team-" + randomUUID();
  let fd: number | undefined;
  try {
    fd = openSync(temp, "wx");
    writeFileSync(fd, text, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    filePath(root, path);
    renameSync(temp, target);
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temp)) unlinkSync(temp);
  }
}

export function projectFiles(root: string): string[] {
  const paths: string[] = [];
  function visit(relative: string) {
    for (const entry of readdirSync(join(root, relative), {
      withFileTypes: true,
    })) {
      if (!relative && entry.name === ".git") continue;
      const path = relative ? relative + "/" + entry.name : entry.name;
      demand(!entry.isSymbolicLink(), "UNSAFE_PATH");
      if (entry.isDirectory()) visit(path);
      else {
        filePath(root, path);
        paths.push(path);
      }
    }
  }
  assertLocalRoot(root);
  visit("");
  return paths;
}
