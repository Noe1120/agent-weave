import { DatabaseSync, backup } from "node:sqlite";
import { createHash, randomUUID, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  constants,
} from "node:fs";
import { dirname, join, relative, resolve, isAbsolute, sep } from "node:path";
import { assertLocalRoot, logicalPath } from "./broker-paths.ts";
import { canonical } from "./domain.ts";
import { uuid } from "./adapter-contract.ts";
export class RecoveryFault extends Error {}
function demand(ok: unknown, code: string): asserts ok {
  if (!ok) throw new RecoveryFault(code);
}
const hash = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const objectId = (v: unknown): v is string =>
  typeof v === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(v);
interface FileRecord {
  path: string;
  sha256: string;
  bytes: number;
}
interface Repository {
  id: string;
  head: string;
  symbolic_head: string | null;
  refs: { name: string; oid: string }[];
  index: boolean;
  files: string[];
  status: string;
  objects_digest: string;
}
export interface RecoveryManifest {
  format: "team-development-recovery/1";
  status: "COMPLETE";
  cut_id: string;
  created_at: string;
  schema: 4;
  files: FileRecord[];
  repositories: Repository[];
  excluded: string[];
}
export interface RecoveryOptions {
  database: string;
  destination: string;
  git: string;
  allowedUntracked?: Record<string, string[]>;
}
function ordinaryFile(file: string) {
  const st = lstatSync(file);
  demand(
    st.isFile() && !st.isSymbolicLink() && st.nlink === 1,
    "RECOVERY_UNSAFE_PATH",
  );
  return st;
}
function listFiles(root: string, skipGit = false): string[] {
  assertLocalRoot(root);
  const files: string[] = [];
  let total = 0;
  function visit(dir: string) {
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (skipGit && dir === "" && e.name === ".git") continue;
      const name = (dir ? dir + "/" : "") + e.name;
      logicalPath(name, true);
      const full = join(root, name);
      const st = lstatSync(full);
      demand(!st.isSymbolicLink(), "RECOVERY_UNSAFE_PATH");
      if (st.isDirectory()) visit(name);
      else {
        ordinaryFile(full);
        total += st.size;
        demand(
          files.length < 10000 &&
            st.size <= 128 * 1024 * 1024 &&
            total <= 256 * 1024 * 1024,
          "RECOVERY_LIMIT",
        );
        files.push(name);
      }
    }
  }
  visit("");
  return files.sort();
}
function git(
  executable: string,
  root: string,
  args: string[],
  input?: Buffer | string,
): Buffer {
  assertLocalRoot(root);
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["SystemRoot", "WINDIR", "PATH", "TEMP", "TMP"])
    if (process.env[key]) env[key] = process.env[key];
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
  });
  return execFileSync(
    executable,
    [
      "--literal-pathspecs",
      "-C",
      root,
      "-c",
      "core.hooksPath=" + join(root, ".git", "team-no-hooks"),
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.untrackedCache=false",
      "-c",
      "core.autocrlf=false",
      "-c",
      "gc.auto=0",
      ...args,
    ],
    {
      env,
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 128 * 1024 * 1024,
      ...(input === undefined ? {} : { input }),
    },
  );
}
function text(executable: string, root: string, args: string[]) {
  return git(executable, root, args).toString("utf8").trimEnd();
}
function gitMetadata(executable: string, root: string, id: string): Repository {
  const gitDir = join(root, ".git");
  assertLocalRoot(gitDir);
  demand(
    existsSync(gitDir) && lstatSync(gitDir).isDirectory(),
    "RECOVERY_UNSUPPORTED_GIT",
  );
  for (const forbidden of [
    "commondir",
    "shallow",
    "objects/info/alternates",
    "objects/info/http-alternates",
    "info/grafts",
    "modules",
    "worktrees",
  ])
    demand(!existsSync(join(gitDir, forbidden)), "RECOVERY_UNSUPPORTED_GIT");
  demand(
    !readdirSync(gitDir).some(
      (n) => n.startsWith("sharedindex.") || n.endsWith(".lock"),
    ),
    "RECOVERY_UNSUPPORTED_GIT",
  );
  listFiles(gitDir);
  const indexEntries = text(executable, root, ["ls-files", "--stage"]);
  demand(!/^(160000|120000) /m.test(indexEntries), "RECOVERY_UNSUPPORTED_GIT");
  const refs = text(executable, root, [
    "for-each-ref",
    "--format=%(refname) %(objectname)",
  ])
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, oid] = line.trim().split(" ");
      demand(name && oid && objectId(oid), "RECOVERY_GIT_INTEGRITY");
      demand(!name.startsWith("refs/replace/"), "RECOVERY_UNSUPPORTED_GIT");
      return { name, oid };
    });
  const head = text(executable, root, ["rev-parse", "--verify", "HEAD"]);
  demand(objectId(head), "RECOVERY_GIT_INTEGRITY");
  const headFile = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
  const symbolic_head = headFile.startsWith("ref: ") ? headFile.slice(5) : null;
  const objects = text(executable, root, [
    "cat-file",
    "--batch-all-objects",
    "--batch-check=%(objectname)",
  ])
    .split("\n")
    .filter(Boolean)
    .sort();
  demand(
    objects.length > 0 && objects.every(objectId),
    "RECOVERY_GIT_INTEGRITY",
  );
  return {
    id,
    head,
    symbolic_head,
    refs,
    index: existsSync(join(gitDir, "index")),
    files: listFiles(root, true),
    status: git(executable, root, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]).toString("base64"),
    objects_digest: hash(objects.join("\n")),
  };
}
function migrations(db: DatabaseSync) {
  const rows = db
    .prepare("SELECT version,checksum FROM schema_migrations ORDER BY version")
    .all();
  demand(rows.length === 4, "RECOVERY_SCHEMA");
  for (const [index, name] of [
    "001_core.sql",
    "002_workspace.sql",
    "003_broker.sql",
    "004_runner.sql",
  ].entries())
    demand(
      rows[index]?.version === index + 1 &&
        rows[index]?.checksum ===
          hash(readFileSync(new URL("../migrations/" + name, import.meta.url))),
      "RECOVERY_SCHEMA",
    );
  demand(
    db.prepare("PRAGMA integrity_check").get()?.integrity_check === "ok" &&
      db.prepare("PRAGMA foreign_key_check").all().length === 0,
    "RECOVERY_INTEGRITY",
  );
}
function quiescent(db: DatabaseSync) {
  demand(
    db
      .prepare(
        "SELECT id FROM resources WHERE kind='adapter_runtime' AND (json_extract(data,'$.mode') IS NOT 'initialize_only' OR json_extract(data,'$.state') IS NOT 'closed' OR json_extract(data,'$.exit.exit_observed') IS NOT 1 OR json_extract(data,'$.exit.forced') IS NOT 0 OR json_extract(data,'$.exit.code') IS NOT 0) LIMIT 1",
      )
      .get() === undefined &&
      db
        .prepare(
          "SELECT id FROM runs WHERE json_extract(data,'$.state') IS NOT 'closed' LIMIT 1",
        )
        .get() === undefined &&
      db
        .prepare("SELECT id FROM broker_claims WHERE state!='released' LIMIT 1")
        .get() === undefined &&
      db.prepare("SELECT claim_id FROM broker_locks LIMIT 1").get() ===
        undefined &&
      db
        .prepare(
          "SELECT action_id FROM broker_edits WHERE phase!='checkpointed' LIMIT 1",
        )
        .get() === undefined &&
      db
        .prepare(
          "SELECT id FROM runner_executions WHERE state NOT IN ('succeeded','stopped','failed') OR ((json_extract(data,'$.worker_pid') IS NOT NULL OR json_extract(data,'$.host_pid') IS NOT NULL) AND json_extract(data,'$.exit.job_empty') IS NOT 1) LIMIT 1",
        )
        .get() === undefined,
    "RECOVERY_NOT_QUIESCENT",
  );
}
function scrub(db: DatabaseSync) {
  db.exec(
    "PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON; BEGIN IMMEDIATE; DELETE FROM console_sessions; DELETE FROM console_pairings; DELETE FROM console_secrets; UPDATE feed_bindings SET state='revoked'; UPDATE grants SET token_hash='recovery-disabled-'||id,data=json_set(data,'$.state','revoked'); UPDATE resources SET data=json_set(data,'$.state','invalidated','$.connection_ref',NULL) WHERE kind='adapter_binding'; UPDATE broker_workspaces SET root='recovery://'||id; COMMIT; VACUUM;",
  );
}
function freshDestination(destination: string) {
  assertLocalRoot(destination);
  demand(!existsSync(destination), "RECOVERY_DESTINATION_EXISTS");
  demand(existsSync(dirname(destination)), "RECOVERY_PARENT_MISSING");
}
function copyExclusive(from: string, to: string) {
  assertLocalRoot(dirname(from));
  ordinaryFile(from);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to, constants.COPYFILE_EXCL);
}

// Trusted local maintenance API, never mounted on the agent gateway. A DB write
// lock fences platform writers; only closed, reconciled development workspaces qualify.
export async function createRecovery(
  options: RecoveryOptions,
): Promise<RecoveryManifest> {
  const database = resolve(options.database),
    destination = resolve(options.destination);
  ordinaryFile(database);
  assertLocalRoot(dirname(database));
  freshDestination(destination);
  const lock = new DatabaseSync(database);
  let reader: DatabaseSync | undefined;
  let locked = false;
  let created = false;
  try {
    lock.exec("PRAGMA busy_timeout=3000; BEGIN IMMEDIATE;");
    locked = true;
    migrations(lock);
    quiescent(lock);
    const workspaces = lock
      .prepare("SELECT id,root,head,mode FROM broker_workspaces ORDER BY id")
      .all();
    for (const w of workspaces) {
      demand(
        uuid(w.id) && w.mode === "development",
        "RECOVERY_UNSUPPORTED_WORKSPACE",
      );
      const root = resolve(String(w.root));
      const rel = relative(root, destination);
      demand(
        rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel),
        "RECOVERY_UNSAFE_PATH",
      );
      assertLocalRoot(root);
      demand(existsSync(root), "RECOVERY_MISSING_WORKSPACE");
    }
    mkdirSync(destination);
    created = true;
    reader = new DatabaseSync(database, { readOnly: true });
    const repositories: Repository[] = [];
    for (const w of workspaces) {
      const id = String(w.id),
        root = String(w.root);
      const before = gitMetadata(options.git, root, id);
      demand(before.head === w.head, "RECOVERY_GIT_BASELINE");
      const tracked = new Set(
        git(options.git, root, ["ls-files", "-z"])
          .toString("utf8")
          .split("\0")
          .filter(Boolean),
      );
      // Broker uses a private index for checkpoints; HEAD-tracked metadata may
      // intentionally be absent from the user's working index. Preserve both.
      for (const file of git(options.git, root, [
        "ls-tree",
        "-r",
        "--name-only",
        "-z",
        before.head,
      ])
        .toString("utf8")
        .split("\0")
        .filter(Boolean))
        tracked.add(file);
      const allowed = options.allowedUntracked?.[id] ?? [];
      for (const p of allowed) logicalPath(p, true);
      const base = join(destination, "repositories", id);
      mkdirSync(base, { recursive: true });
      const filesBefore = new Map<string, string>();
      for (const file of before.files) {
        demand(
          tracked.has(file) || allowed.includes(file),
          "RECOVERY_UNTRACKED",
        );
        demand(
          !/(^|\/)(\.env(?:\..*)?|credentials(?:\..*)?|id_rsa|id_ed25519)$/i.test(
            file,
          ),
          "RECOVERY_SECRET_FILE",
        );
        const bytes = readFileSync(join(root, file));
        demand(
          !bytes
            .subarray(0, 100)
            .toString()
            .startsWith("version https://git-lfs.github.com/spec/v1"),
          "RECOVERY_UNSUPPORTED_GIT",
        );
        filesBefore.set(file, hash(bytes));
        copyExclusive(join(root, file), join(base, "tree", file));
        demand(
          hash(readFileSync(join(base, "tree", file))) ===
            filesBefore.get(file),
          "RECOVERY_SOURCE_CHANGED",
        );
      }
      const objects = text(options.git, root, [
        "cat-file",
        "--batch-all-objects",
        "--batch-check=%(objectname)",
      ])
        .split("\n")
        .filter(Boolean)
        .sort();
      demand(
        hash(objects.join("\n")) === before.objects_digest,
        "RECOVERY_SOURCE_CHANGED",
      );
      writeFileSync(
        join(base, "objects.pack"),
        git(
          options.git,
          root,
          ["pack-objects", "--stdout"],
          objects.join("\n") + "\n",
        ),
        { flag: "wx" },
      );
      const index = before.index
        ? readFileSync(join(root, ".git", "index"))
        : null;
      if (index) writeFileSync(join(base, "index"), index, { flag: "wx" });
      for (const row of lock
        .prepare(
          "SELECT data FROM broker_edits WHERE claim_id IN (SELECT id FROM broker_claims WHERE workspace_id=?)",
        )
        .all(id)) {
        const edit = JSON.parse(String(row.data));
        for (const key of ["parent", "commit", "tree"]) {
          demand(objectId(edit[key]), "RECOVERY_GIT_CLOSURE");
          git(options.git, root, ["cat-file", "-e", edit[key]]);
        }
      }
      const after = gitMetadata(options.git, root, id);
      demand(canonical(before) === canonical(after), "RECOVERY_SOURCE_CHANGED");
      for (const [file, digest] of filesBefore)
        demand(
          hash(readFileSync(join(root, file))) === digest,
          "RECOVERY_SOURCE_CHANGED",
        );
      if (index)
        demand(
          index.equals(readFileSync(join(root, ".git", "index"))),
          "RECOVERY_SOURCE_CHANGED",
        );
      repositories.push(before);
    }
    // Separate read connection avoids backing up a source handle in a write transaction.
    await backup(reader, join(destination, "database.sqlite"));
    reader.close();
    reader = undefined;
    const copied = new DatabaseSync(join(destination, "database.sqlite"));
    try {
      scrub(copied);
      migrations(copied);
    } finally {
      copied.close();
    }
    for (const repo of repositories) {
      const source = String(workspaces.find((w) => w.id === repo.id)!.root);
      demand(
        canonical(gitMetadata(options.git, source, repo.id)) ===
          canonical(repo),
        "RECOVERY_SOURCE_CHANGED",
      );
      const base = join(destination, "repositories", repo.id);
      for (const file of repo.files)
        demand(
          hash(readFileSync(join(source, file))) ===
            hash(readFileSync(join(base, "tree", file))),
          "RECOVERY_SOURCE_CHANGED",
        );
      if (repo.index)
        demand(
          readFileSync(join(source, ".git", "index")).equals(
            readFileSync(join(base, "index")),
          ),
          "RECOVERY_SOURCE_CHANGED",
        );
    }
    const files = listFiles(destination).map((path) => ({
      path,
      sha256: hash(readFileSync(join(destination, path))),
      bytes: ordinaryFile(join(destination, path)).size,
    }));
    const manifest: RecoveryManifest = {
      format: "team-development-recovery/1",
      status: "COMPLETE",
      cut_id: randomUUID(),
      created_at: new Date().toISOString(),
      schema: 4,
      files,
      repositories,
      excluded: [
        "live credentials and console sessions",
        "Git config/hooks/remotes",
        "OS isolation and native-client state",
      ],
    };
    verifyContents(destination, manifest);
    writeFileSync(
      join(destination, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      { flag: "wx" },
    );
    return manifest;
  } catch (error) {
    if (created && !existsSync(join(destination, "manifest.json")))
      writeFileSync(
        join(destination, "INCOMPLETE.json"),
        JSON.stringify({
          status: "INCOMPLETE",
          reason:
            error instanceof RecoveryFault ? error.message : "RECOVERY_FAILED",
        }),
        { flag: "wx" },
      );
    throw error;
  } finally {
    reader?.close();
    if (locked) lock.exec("ROLLBACK");
    lock.close();
  }
}
export function verifyRecovery(directory: string): RecoveryManifest {
  assertLocalRoot(directory);
  demand(
    ordinaryFile(join(directory, "manifest.json")).size <= 4 * 1024 * 1024,
    "RECOVERY_LIMIT",
  );
  const m = JSON.parse(
    readFileSync(join(directory, "manifest.json"), "utf8"),
  ) as RecoveryManifest;
  return verifyContents(directory, m);
}
function verifyContents(
  directory: string,
  m: RecoveryManifest,
): RecoveryManifest {
  demand(
    m.format === "team-development-recovery/1" &&
      m.status === "COMPLETE" &&
      m.schema === 4 &&
      uuid(m.cut_id) &&
      Array.isArray(m.files) &&
      Array.isArray(m.repositories),
    "RECOVERY_MANIFEST",
  );
  const names = new Set<string>();
  for (const f of m.files) {
    demand(typeof f.path === "string", "RECOVERY_MANIFEST");
    const key = logicalPath(f.path, true);
    demand(
      key !== "manifest.json" &&
        !names.has(key) &&
        /^[a-f0-9]{64}$/.test(f.sha256) &&
        Number.isSafeInteger(f.bytes) &&
        f.bytes >= 0,
      "RECOVERY_MANIFEST",
    );
    names.add(key);
    const full = join(directory, f.path);
    assertLocalRoot(dirname(full));
    demand(
      existsSync(full) &&
        ordinaryFile(full).size === f.bytes &&
        hash(readFileSync(full)) === f.sha256,
      "RECOVERY_INTEGRITY",
    );
  }
  const actual = listFiles(directory).filter((p) => p !== "manifest.json");
  demand(
    actual.length === m.files.length &&
      actual.every((p) => names.has(p.toLowerCase())) &&
      names.has("database.sqlite"),
    "RECOVERY_INTEGRITY",
  );
  const expected = new Set(["database.sqlite"]);
  const repoIds = new Set<string>();
  for (const r of m.repositories) {
    demand(
      uuid(r.id) &&
        !repoIds.has(r.id) &&
        objectId(r.head) &&
        typeof r.index === "boolean" &&
        Array.isArray(r.refs) &&
        Array.isArray(r.files) &&
        typeof r.status === "string" &&
        /^[a-f0-9]{64}$/.test(r.objects_digest),
      "RECOVERY_MANIFEST",
    );
    repoIds.add(r.id);
    const base = "repositories/" + r.id + "/";
    expected.add(base + "objects.pack");
    if (r.index) expected.add(base + "index");
    demand(
      names.has(base + "objects.pack") &&
        (!r.index || names.has(base + "index")),
      "RECOVERY_INTEGRITY",
    );
    demand(
      r.symbolic_head === null ||
        (typeof r.symbolic_head === "string" &&
          r.symbolic_head.startsWith("refs/heads/")),
      "RECOVERY_MANIFEST",
    );
    for (const ref of r.refs)
      demand(
        typeof ref.name === "string" &&
          ref.name.startsWith("refs/") &&
          !ref.name.startsWith("refs/replace/") &&
          objectId(ref.oid),
        "RECOVERY_MANIFEST",
      );
    for (const file of r.files) {
      logicalPath(file, true);
      const key = (base + "tree/" + file).toLowerCase();
      demand(!expected.has(key), "RECOVERY_CLOSURE");
      expected.add(key);
      demand(
        names.has((base + "tree/" + file).toLowerCase()),
        "RECOVERY_INTEGRITY",
      );
    }
  }
  demand(
    expected.size === names.size && [...names].every((p) => expected.has(p)),
    "RECOVERY_CLOSURE",
  );
  const db = new DatabaseSync(join(directory, "database.sqlite"), {
    readOnly: true,
  });
  try {
    migrations(db);
    quiescent(db);
    demand(
      db.prepare("SELECT name FROM console_secrets LIMIT 1").get() ===
        undefined &&
        db.prepare("SELECT hash FROM console_sessions LIMIT 1").get() ===
          undefined &&
        db.prepare("SELECT hash FROM console_pairings LIMIT 1").get() ===
          undefined &&
        db
          .prepare(
            "SELECT id FROM grants WHERE json_extract(data,'$.state')!='revoked' OR token_hash!='recovery-disabled-'||id LIMIT 1",
          )
          .get() === undefined,
      "RECOVERY_CREDENTIALS",
    );
    const rows = db.prepare("SELECT id,root FROM broker_workspaces").all();
    demand(
      rows.length === repoIds.size &&
        rows.every(
          (r) => repoIds.has(String(r.id)) && r.root === "recovery://" + r.id,
        ),
      "RECOVERY_CLOSURE",
    );
  } finally {
    db.close();
  }
  return m;
}
export function restoreRecovery(
  directory: string,
  destination: string,
  executable: string,
) {
  const manifest = verifyRecovery(directory);
  freshDestination(destination);
  const bytes = (path: string) => {
    const record = manifest.files.find((f) => f.path === path);
    demand(record, "RECOVERY_CLOSURE");
    const full = join(directory, path);
    assertLocalRoot(dirname(full));
    demand(ordinaryFile(full).size === record.bytes, "RECOVERY_INTEGRITY");
    const value = readFileSync(full);
    demand(
      value.length === record.bytes && hash(value) === record.sha256,
      "RECOVERY_INTEGRITY",
    );
    return value;
  };
  const materialize = (path: string, to: string) => {
    const value = bytes(path);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, value, { flag: "wx" });
  };
  mkdirSync(destination);
  for (const r of manifest.repositories) {
    const root = join(destination, "workspaces", r.id),
      base = join(directory, "repositories", r.id);
    mkdirSync(root, { recursive: true });
    git(executable, root, ["init", "--template=", "--initial-branch=main"]);
    git(
      executable,
      root,
      ["index-pack", "--stdin"],
      bytes("repositories/" + r.id + "/objects.pack"),
    );
    for (const ref of r.refs) {
      git(executable, root, ["check-ref-format", ref.name]);
      git(executable, root, ["update-ref", ref.name, ref.oid]);
    }
    if (r.symbolic_head) {
      git(executable, root, ["check-ref-format", r.symbolic_head]);
      git(executable, root, ["symbolic-ref", "HEAD", r.symbolic_head]);
    } else git(executable, root, ["update-ref", "--no-deref", "HEAD", r.head]);
    if (r.index)
      materialize(
        "repositories/" + r.id + "/index",
        join(root, ".git", "index"),
      );
    for (const file of r.files)
      materialize("repositories/" + r.id + "/tree/" + file, join(root, file));
    git(executable, root, ["fsck", "--full", "--no-reflogs"]);
    const restored = gitMetadata(executable, root, r.id);
    demand(
      restored.head === r.head &&
        restored.status === r.status &&
        restored.objects_digest === r.objects_digest,
      "RECOVERY_GIT_INTEGRITY",
    );
  }
  const database = join(destination, "database.sqlite");
  materialize("database.sqlite", database);
  const db = new DatabaseSync(database);
  try {
    db.exec("BEGIN IMMEDIATE");
    for (const r of manifest.repositories)
      db.prepare("UPDATE broker_workspaces SET root=? WHERE id=?").run(
        join(destination, "workspaces", r.id),
        r.id,
      );
    db.prepare(
      "INSERT INTO console_secrets(name,value) VALUES('signing_key',?)",
    ).run(randomBytes(32).toString("hex"));
    db.exec("COMMIT");
    migrations(db);
    quiescent(db);
  } finally {
    db.close();
  }
  writeFileSync(
    join(destination, "restore.json"),
    JSON.stringify(
      {
        cut_id: manifest.cut_id,
        state: "RESTORED_OFFLINE",
        credentials: "REPAIR_REQUIRED",
        automatic_resume: false,
      },
      null,
      2,
    ),
    { flag: "wx" },
  );
  return {
    database,
    cut_id: manifest.cut_id,
    state: "RESTORED_OFFLINE" as const,
  };
}
