// Trusted acceptance preparation only. No production adapter or original profile access.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
interface Config {
  installation_root: string;
  data_root: string;
  client_version: string;
  executable_sha256: string;
  archive_sha256: string;
  node: string;
  server: string;
}
async function unlinked(full: string, file: boolean) {
  let p = full;
  for (;;) {
    const s = await lstat(p);
    if (
      s.isSymbolicLink() ||
      (p === full && (file ? !s.isFile() || s.nlink !== 1 : !s.isDirectory()))
    )
      throw new Error("CLAUDE_UNSAFE_PATH");
    const parent = dirname(p);
    if (parent === p) return;
    p = parent;
  }
}
export async function fileHash(file: string) {
  const h = createHash("sha256");
  for await (const c of createReadStream(file)) h.update(c);
  return h.digest("hex");
}
export async function prepareClaudeProbe(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("CLAUDE_CONFIG");
  const c = structuredClone(input) as Config;
  const keys = [
    "installation_root",
    "data_root",
    "client_version",
    "executable_sha256",
    "archive_sha256",
    "node",
    "server",
  ];
  if (
    Object.keys(c).length !== keys.length ||
    !keys.every((k) => Object.hasOwn(c, k))
  )
    throw new Error("CLAUDE_CONFIG");
  if (
    ![c.installation_root, c.data_root, c.node, c.server].every(
      (v) => typeof v === "string" && isAbsolute(v),
    ) ||
    ![c.executable_sha256, c.archive_sha256].every(
      (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v),
    ) ||
    typeof c.client_version !== "string" ||
    !/^[A-Za-z0-9.-]{1,40}$/.test(c.client_version)
  )
    throw new Error("CLAUDE_CONFIG");
  c.installation_root = resolve(c.installation_root);
  c.data_root = resolve(c.data_root);
  const between = relative(c.installation_root, c.data_root);
  if (
    between !== ".." &&
    !between.startsWith(".." + sep) &&
    !isAbsolute(between)
  )
    throw new Error("CLAUDE_CONFIG");
  const executable = join(c.installation_root, "claude.exe"),
    archive = join(c.installation_root, "resources", "app.asar");
  for (const file of [executable, archive, c.node, c.server])
    await unlinked(file, true);
  if (
    (await fileHash(executable)) !== c.executable_sha256 ||
    (await fileHash(archive)) !== c.archive_sha256
  )
    throw new Error("CLAUDE_CONFIG_CHANGED");
  await unlinked(c.data_root, false);
  const system = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  if (!system || !isAbsolute(system)) throw new Error("CLAUDE_SYSTEMROOT");
  const root = await mkdtemp(join(c.data_root, "claude-probe-"));
  const dirs: Record<string, string> = {};
  for (const n of [
    "profile",
    "user",
    "appdata",
    "localappdata",
    "temp",
    "work",
  ]) {
    dirs[n] = join(root, n);
    await mkdir(dirs[n]!);
  }
  const report = join(root, "mcp-report.json");
  const config = {
    mcpServers: {
      "agent-weave-probe": {
        command: c.node,
        args: [c.server, report, "45000"],
      },
    },
  };
  await writeFile(
    join(dirs.profile!, "claude_desktop_config.json"),
    JSON.stringify(config, null, 2) + "\n",
    { flag: "wx" },
  );
  const env: Record<string, string> = {
    SystemRoot: system,
    WINDIR: system,
    ComSpec: join(system, "System32", "cmd.exe"),
    PATH: join(system, "System32"),
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
    OS: "Windows_NT",
    HOME: dirs.user!,
    USERPROFILE: dirs.user!,
    APPDATA: dirs.appdata!,
    LOCALAPPDATA: dirs.localappdata!,
    TEMP: dirs.temp!,
    TMP: dirs.temp!,
  };
  return {
    root,
    profile: dirs.profile!,
    cwd: dirs.work!,
    executable,
    args: ["--user-data-dir=" + dirs.profile!],
    env,
    report,
    client_version: c.client_version,
    executable_sha256: c.executable_sha256,
    archive_sha256: c.archive_sha256,
    node_sha256: await fileHash(c.node),
    server_sha256: await fileHash(c.server),
  };
}
