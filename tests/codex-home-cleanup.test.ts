import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  linkSync,
  symlinkSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tempWorkspace } from "./temp.ts";
import { captureCodexHomeCleanup } from "../packages/service/src/codex-home-cleanup.ts";

function fixture() {
  const temp = tempWorkspace();
  const root = join(temp.directory, "codex-init-owned");
  const home = join(root, "home"),
    work = join(root, "work");
  mkdirSync(home, { recursive: true });
  mkdirSync(work);
  const config = join(home, "config.toml");
  writeFileSync(config, "synthetic configuration");
  return { ...temp, root, home, work, config };
}

test("owned cleanup removes only captured config and successful calls are idempotent", async (t) => {
  const f = fixture();
  t.after(() => f.dispose());
  const note = join(f.work, "notes.txt");
  writeFileSync(note, "keep");
  const clean = await captureCodexHomeCleanup(f.directory, f.work);
  assert.equal(existsSync(f.config), true);
  await clean();
  await clean();
  assert.equal(existsSync(f.config), false);
  assert.equal(readFileSync(note, "utf8"), "keep");
});

test("outside and wrong-layout work directories cannot select a cleanup target", async (t) => {
  const f = fixture();
  t.after(() => f.dispose());
  for (const work of [f.directory, f.root, f.home, join(f.work, "nested")]) {
    await assert.rejects(
      captureCodexHomeCleanup(f.directory, work),
      /CODEX_HOME_UNSAFE/,
    );
  }
  await assert.rejects(
    captureCodexHomeCleanup(f.work, f.work),
    /CODEX_HOME_UNSAFE/,
  );
  assert.equal(existsSync(f.config), true);
});

test("hardlinked config is refused without deleting either name", async (t) => {
  const f = fixture();
  t.after(() => f.dispose());
  const other = join(f.directory, "other");
  linkSync(f.config, other);
  await assert.rejects(
    captureCodexHomeCleanup(f.directory, f.work),
    /CODEX_HOME_UNSAFE/,
  );
  assert.equal(existsSync(f.config), true);
  assert.equal(existsSync(other), true);
});

test("junction home cannot redirect cleanup outside the owned attempt", async (t) => {
  const f = fixture();
  t.after(() => f.dispose());
  const moved = join(f.directory, "elsewhere");
  renameSync(f.home, moved);
  symlinkSync(moved, f.home, "junction");
  await assert.rejects(
    captureCodexHomeCleanup(f.directory, f.work),
    /CODEX_HOME_UNSAFE/,
  );
  assert.equal(
    readFileSync(join(moved, "config.toml"), "utf8"),
    "synthetic configuration",
  );
});

for (const mutation of [
  "bytes",
  "identity",
  "directory",
  "missing",
  "hardlink",
]) {
  test(`cleanup refuses captured ${mutation} change instead of deleting unknown data`, async (t) => {
    const f = fixture();
    t.after(() => f.dispose());
    const clean = await captureCodexHomeCleanup(f.directory, f.work);
    if (mutation === "bytes") writeFileSync(f.config, "changed content");
    if (mutation === "identity") {
      renameSync(f.config, f.config + ".old");
      writeFileSync(f.config, "synthetic configuration");
    }
    if (mutation === "directory") {
      renameSync(f.home, f.home + ".old");
      mkdirSync(f.home);
      writeFileSync(f.config, "synthetic configuration");
    }
    if (mutation === "missing") unlinkSync(f.config);
    if (mutation === "hardlink") linkSync(f.config, f.config + ".copy");
    await assert.rejects(clean(), /CODEX_HOME_/);
    assert.equal(existsSync(f.config), mutation !== "missing");
  });
}
