// Explicit acceptance-only preparation. This does not launch or change the production adapter.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { officialDshLauncher } from "../packages/service/src/dsh-acp.ts";
interface Profile {
  installation_root: string;
  data_root: string;
  client_version: string;
  executable_sha256: string;
  archive_sha256: string;
}
async function unlinked(absolute: string, file: boolean) {
  let current = absolute;
  for (;;) {
    const stat = await lstat(current);
    if (
      stat.isSymbolicLink() ||
      (current === absolute &&
        (file ? !stat.isFile() || stat.nlink !== 1 : !stat.isDirectory()))
    )
      throw new Error("DSH_UNSAFE_PATH");
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}
async function hash(filename: string) {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(filename)) h.update(chunk);
  return h.digest("hex");
}
export async function prepareFreshDshProbe(input: unknown) {
  // Reuse the exact trusted configuration shape; calling the factory does not launch.
  officialDshLauncher(input);
  const p = structuredClone(input) as Profile;
  const executable = join(resolve(p.installation_root), "DeepSeek Harness.exe");
  const archive = join(resolve(p.installation_root), "resources", "app.asar");
  await unlinked(executable, true);
  await unlinked(archive, true);
  if (
    (await hash(executable)) !== p.executable_sha256 ||
    (await hash(archive)) !== p.archive_sha256
  )
    throw new Error("DSH_CONFIG_CHANGED");
  await unlinked(resolve(p.data_root), false);
  const system = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  if (!system || !isAbsolute(system)) throw new Error("DSH_PROBE_SYSTEMROOT");
  const root = await mkdtemp(join(resolve(p.data_root), "dsh-session-"));
  const dirs: Record<string, string> = {};
  for (const name of [
    "home",
    "agents",
    "user",
    "appdata",
    "localappdata",
    "temp",
    "work",
  ]) {
    dirs[name] = join(root, name);
    await mkdir(dirs[name]!);
  }
  const diagnostic = join(root, "stderr.log");
  await writeFile(diagnostic, "", { flag: "wx" });
  const env: Record<string, string> = {
    SystemRoot: system,
    WINDIR: system,
    ComSpec: join(system, "System32", "cmd.exe"),
    PATH: join(system, "System32"),
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
    OS: "Windows_NT",
    USERPROFILE: dirs.user!,
    HOME: dirs.user!,
    APPDATA: dirs.appdata!,
    LOCALAPPDATA: dirs.localappdata!,
    TEMP: dirs.temp!,
    TMP: dirs.temp!,
    DSH_HOME: dirs.home!,
    DSH_AGENTS_HOME: dirs.agents!,
    DSH_TELEMETRY_DISABLED: "1",
    DSH_PERMISSION_MODE: "read-only",
    ELECTRON_RUN_AS_NODE: "1",
    NO_COLOR: "1",
  };
  return {
    executable,
    args: [
      "--expose-internals",
      join(
        archive,
        "dsh",
        "node_modules",
        "@deepseek-ai",
        "dsh-desktop-host",
        "lib",
        "cli.js",
      ),
      "--profile",
      "acp",
    ],
    cwd: dirs.work!,
    env,
    diagnostic,
    root,
    client_version: p.client_version,
    executable_sha256: p.executable_sha256,
    archive_sha256: p.archive_sha256,
  };
}
