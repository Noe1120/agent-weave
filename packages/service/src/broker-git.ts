import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  assertLocalRoot,
  demand,
  projectFiles,
  readText,
  textDigest,
} from "./broker-paths.ts";
export interface FileEdit {
  path: string;
  text: string | null;
  before_digest: string | null;
}
// Trusted executable only. No shell, checkout, add, filters, hooks, signing or network.
export class BrokerGit {
  readonly executable: string;
  constructor(executable: string) {
    this.executable = executable;
  }
  private command(
    root: string,
    args: string[],
    input?: string,
    index?: string,
    raw = false,
    date = new Date().toISOString(),
  ): string {
    assertLocalRoot(root);
    if (existsSync(join(root, ".git"))) {
      const st = lstatSync(join(root, ".git"));
      demand(st.isDirectory() && !st.isSymbolicLink(), "UNSAFE_PATH");
    }
    const env: NodeJS.ProcessEnv = {};
    for (const key of ["SystemRoot", "WINDIR", "TEMP", "TMP", "PATH"])
      if (process.env[key]) env[key] = process.env[key];
    Object.assign(env, {
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      GIT_AUTHOR_NAME: "Team development broker",
      GIT_AUTHOR_EMAIL: "broker@localhost",
      GIT_COMMITTER_NAME: "Team development broker",
      GIT_COMMITTER_EMAIL: "broker@localhost",
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    });
    if (index) env.GIT_INDEX_FILE = index;
    const output = execFileSync(
      this.executable,
      [
        "--literal-pathspecs",
        "-C",
        root,
        "-c",
        "core.hooksPath=" + join(root, ".git", "team-no-hooks"),
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.autocrlf=false",
        "-c",
        "gc.auto=0",
        ...args,
      ],
      {
        env,
        encoding: "utf8",
        windowsHide: true,
        timeout: 15000,
        maxBuffer: 8 * 1024 * 1024,
        ...(input === undefined ? {} : { input }),
      },
    );
    return raw ? output : output.trimEnd();
  }
  create(root: string): string {
    assertLocalRoot(root);
    demand(!existsSync(root), "WORKSPACE_NOT_EMPTY");
    mkdirSync(root);
    this.command(root, ["init", "--template=", "--initial-branch=main"]);
    const tree = this.command(root, ["mktree"], "");
    const commit = this.command(
      root,
      ["commit-tree", tree],
      "Team development baseline\n",
    );
    this.command(root, [
      "update-ref",
      "HEAD",
      commit,
      "0".repeat(commit.length),
    ]);
    return commit;
  }
  assertSnapshot(
    root: string,
    commit: string,
    code: string,
    pending: FileEdit[] = [],
  ) {
    const expected = new Map<string, string>();
    const entries = this.command(
      root,
      ["ls-tree", "-r", "-z", commit],
      undefined,
      undefined,
      true,
    )
      .split("\0")
      .filter(Boolean);
    for (const entry of entries) {
      const split = entry.indexOf("\t"),
        header = entry.slice(0, split).split(" "),
        path = entry.slice(split + 1);
      demand(header[0] === "100644" && header[1] === "blob", "UNSAFE_PATH");
      expected.set(
        path,
        this.command(
          root,
          ["cat-file", "blob", header[2]!],
          undefined,
          undefined,
          true,
        ),
      );
    }
    const possible = new Map(pending.map((e) => [e.path, e]));
    for (const path of new Set([
      ...expected.keys(),
      ...projectFiles(root),
      ...possible.keys(),
    ])) {
      const actual = textDigest(readText(root, path)),
        before = textDigest(expected.get(path) ?? null),
        edit = possible.get(path);
      demand(
        actual === before || (edit && actual === textDigest(edit.text)),
        code,
      );
    }
  }
  head(root: string) {
    return this.command(root, ["rev-parse", "--verify", "HEAD"]);
  }
  prepare(
    root: string,
    parent: string,
    edits: FileEdit[],
    action: string,
    observedAt: string,
  ): { commit: string; diff: string; tree: string } {
    demand(/^[a-f0-9]{40,64}$/.test(parent), "GIT_BASELINE_CONFLICT");
    const index = join(root, ".git", "team-index-" + randomUUID());
    try {
      this.command(root, ["read-tree", parent], undefined, index);
      for (const edit of edits) {
        if (edit.text === null)
          this.command(
            root,
            ["update-index", "--force-remove", "--", edit.path],
            undefined,
            index,
          );
        else {
          const blob = this.command(
            root,
            ["hash-object", "-w", "--stdin", "--no-filters"],
            edit.text,
          );
          this.command(
            root,
            ["update-index", "--add", "--cacheinfo", "100644", blob, edit.path],
            undefined,
            index,
          );
        }
      }
      const tree = this.command(root, ["write-tree"], undefined, index);
      const commit = this.command(
        root,
        ["commit-tree", tree, "-p", parent],
        `Team change ${action}\n`,
        undefined,
        false,
        observedAt,
      );
      return { commit, tree, diff: this.diff(root, parent, commit) };
    } finally {
      if (existsSync(index)) unlinkSync(index);
    }
  }
  diff(root: string, parent: string, commit: string) {
    return this.command(root, [
      "diff-tree",
      "-p",
      "--binary",
      "--no-ext-diff",
      "--no-textconv",
      parent,
      commit,
      "--",
    ]);
  }
  advance(root: string, parent: string, commit: string) {
    const head = this.head(root);
    demand(head === parent || head === commit, "GIT_BASELINE_CONFLICT");
    if (head === parent)
      this.command(root, ["update-ref", "HEAD", commit, parent]);
  }
}
