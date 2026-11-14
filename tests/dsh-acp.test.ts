import test, { afterEach } from "node:test";
import type { ChildProcess } from "node:child_process";
const children = new Set<ChildProcess>();
afterEach(() => {
  for (const child of children) if (child.exitCode === null) child.kill();
  children.clear();
});
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  linkSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  InitializeOnlyAcp,
  officialDshLauncher,
} from "../packages/service/src/dsh-acp.ts";
function fixture(mode: string) {
  const dir = mkdtempSync(join(tmpdir(), "team-dsh-"));
  const log = join(dir, "sent.ndjson");
  const child = spawn(
    process.execPath,
    [resolve("tests/fixtures/dsh-acp-fixture.mjs"), mode, log],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  children.add(child);
  const handle = new InitializeOnlyAcp(child, {
    initializeMs: mode === "timeout" ? 600 : 5000,
    closeMs: mode === "hang" ? 200 : 1500,
  });
  return { handle, log };
}
test("real child transport only initializes, projects declared capabilities and closes by EOF", async () => {
  const { handle, log } = fixture("chunked");
  const hello = await handle.ready;
  assert.equal(hello.protocol_version, 1);
  assert.equal(hello.bridge_version, "0.0.1");
  assert.equal(hello.advertised.session_resume, true);
  handle.close();
  handle.close();
  const exit = await handle.closed;
  assert.equal(exit.code, 0);
  assert.equal(exit.exit_observed, true);
  assert.equal(exit.forced, false);
  assert.equal(exit.fault, null);
  const sent = readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, "initialize");
  assert.equal("prompt" in handle, false);
  assert.equal("cancel" in handle, false);
});
for (const mode of [
  "garbage",
  "huge",
  "utf8",
  "request",
  "error",
  "wrong-id",
  "wrong-agent",
  "wrong-version",
  "auth",
  "exit",
  "timeout",
])
  test("fails closed: " + mode, async () => {
    const { handle, log } = fixture(mode);
    await assert.rejects(handle.ready);
    const exit = await handle.closed;
    assert.ok(exit.fault);
    assert.doesNotMatch(JSON.stringify(exit), /private-secret/);
    assert.equal(readFileSync(log, "utf8").trim().split("\n").length, 1);
  });
test("duplicate frame after initialization closes transport, never grants a new turn", async () => {
  const { handle } = fixture("duplicate");
  await handle.ready.catch(() => {});
  const exit = await handle.closed;
  assert.equal(exit.fault, "DSH_PROTOCOL");
});
test("disconnect after ready remains a failed transport, not successful execution", async () => {
  const { handle } = fixture("crash");
  await handle.ready;
  const exit = await handle.closed;
  assert.equal(exit.code, 9);
  assert.equal(exit.fault, "DSH_EXIT");
});
test("bounded close terminates only its live child handle; does not assert OS isolation", async () => {
  const { handle } = fixture("hang");
  await handle.ready;
  handle.close();
  const exit = await handle.closed;
  assert.equal(exit.forced, true);
  assert.equal(exit.fault, "DSH_CLOSE_TIMEOUT");
});
test("stderr is bounded metadata and never stored in a projection", async () => {
  const { handle } = fixture("stderr");
  await handle.ready;
  handle.close();
  const exit = await handle.closed;
  assert.ok(exit.stderr_bytes > 0);
  assert.doesNotMatch(JSON.stringify(exit), /private-secret/);
});
test("configuration does not accept commands, environment or a caller-claimed qualification", () => {
  const profile = {
    installation_root: resolve("fixtures-install"),
    data_root: resolve("fixtures-data"),
    client_version: "0.2.1-rc.3",
    executable_sha256: "a".repeat(64),
    archive_sha256: "b".repeat(64),
  };
  for (const extra of [
    { command: "cmd.exe" },
    { env: { API_KEY: "x" } },
    { qualification: "VERIFIED" },
  ])
    assert.throws(() => officialDshLauncher({ ...profile, ...extra }));
  assert.throws(() =>
    officialDshLauncher({ ...profile, data_root: profile.installation_root }),
  );
  const a = officialDshLauncher(profile),
    b = officialDshLauncher({ ...profile, archive_sha256: "c".repeat(64) });
  assert.notEqual(a.fingerprint, b.fingerprint);
});
test("changed executable pin refuses before spawn or data-root creation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "team-dsh-install-"));
  mkdirSync(join(dir, "resources"));
  writeFileSync(join(dir, "DeepSeek Harness.exe"), "not executable");
  writeFileSync(join(dir, "resources", "app.asar"), "archive");
  const launcher = officialDshLauncher({
    installation_root: dir,
    data_root: join(dir, "..", "new-data"),
    client_version: "fixture",
    executable_sha256: "a".repeat(64),
    archive_sha256: "b".repeat(64),
  });
  await assert.rejects(
    launcher.launch(() => true),
    { code: "DSH_CONFIG_CHANGED" },
  );
});

test("bounded stderr diagnostics stay outside public transport results", async () => {
  const chunks: Buffer[] = [];
  const child = spawn(
    process.execPath,
    [resolve("tests/fixtures/dsh-acp-fixture.mjs"), "stderr"],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  children.add(child);
  const handle = new InitializeOnlyAcp(child, {
    initializeMs: 5000,
    closeMs: 1500,
    onStderr: (bytes: Buffer) => chunks.push(bytes),
  });
  await handle.ready;
  handle.close();
  const exit = await handle.closed;
  assert.match(Buffer.concat(chunks).toString(), /private-secret/);
  assert.doesNotMatch(JSON.stringify(exit), /private-secret/);
});

function pinnedFixture() {
  const root = mkdtempSync(join(tmpdir(), "team-dsh-pinned-"));
  const install = join(root, "install"),
    data = join(root, "data");
  mkdirSync(join(install, "resources"), { recursive: true });
  mkdirSync(data);
  writeFileSync(join(install, "DeepSeek Harness.exe"), "not executable");
  writeFileSync(join(install, "resources", "app.asar"), "archive");
  return {
    installation_root: install,
    data_root: data,
    client_version: "fixture",
    executable_sha256: createHash("sha256")
      .update("not executable")
      .digest("hex"),
    archive_sha256: createHash("sha256").update("archive").digest("hex"),
  };
}
test("archive has an independent pin and cannot borrow a valid executable hash", async () => {
  const p = pinnedFixture();
  await assert.rejects(
    officialDshLauncher({ ...p, archive_sha256: "a".repeat(64) }).launch(
      () => true,
    ),
    { code: "DSH_CONFIG_CHANGED" },
  );
  assert.deepEqual(readdirSync(p.data_root), []);
});
for (const deniedAt of [1, 2, 3])
  test(
    "official launcher rechecks authorization at preparation boundary " +
      deniedAt,
    async () => {
      const p = pinnedFixture();
      let checks = 0;
      const launcher = officialDshLauncher(p);
      await assert.rejects(
        launcher.launch(() => ++checks !== deniedAt),
        { code: "DSH_AUTHORIZATION_CHANGED" },
      );
      assert.equal(checks, deniedAt);
      const runs = readdirSync(p.data_root);
      assert.equal(runs.length, deniedAt === 3 ? 1 : 0);
      if (deniedAt === 3) {
        const first = runs[0];
        assert.ok(first);
        assert.deepEqual(readdirSync(join(p.data_root, first, "home")), []);
        checks = 0;
        await assert.rejects(
          launcher.launch(() => ++checks !== deniedAt),
          { code: "DSH_AUTHORIZATION_CHANGED" },
        );
        assert.equal(readdirSync(p.data_root).length, 2);
      }
    },
  );
test("hardlinked executable is refused before hashing or launch", async () => {
  const p = pinnedFixture();
  linkSync(
    join(p.installation_root, "DeepSeek Harness.exe"),
    join(p.data_root, "alias.exe"),
  );
  await assert.rejects(
    officialDshLauncher(p).launch(() => true),
    { code: "DSH_UNSAFE_PATH" },
  );
});
test("close before spawn does not send initialize", async () => {
  const { handle } = fixture("success");
  handle.close();
  await assert.rejects(handle.ready, { code: "DSH_CLOSED" });
  const exit = await handle.closed;
  assert.equal(exit.initialize_requests, 0);
  assert.equal(exit.initialize_responses, 0);
});
test("a failing diagnostic sink is visible and closes its owned transport", async () => {
  const child = spawn(
    process.execPath,
    [resolve("tests/fixtures/dsh-acp-fixture.mjs"), "stderr"],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  children.add(child);
  const handle = new InitializeOnlyAcp(child, {
    initializeMs: 5000,
    closeMs: 1500,
    onStderr: () => {
      throw new Error("private sink path");
    },
  });
  await handle.ready.catch(() => {});
  const exit = await handle.closed;
  assert.equal(exit.fault, "DSH_DIAGNOSTIC_WRITE");
  assert.doesNotMatch(JSON.stringify(exit), /private sink path/);
});
