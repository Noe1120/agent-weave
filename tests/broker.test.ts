import test from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  writeFileSync,
  linkSync,
  mkdirSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { brokerFixture, gitExe } from "./broker-helpers.ts";
import { id } from "./helpers.ts";
import { digest } from "../packages/service/src/store.ts";

test("broker claims tasks with CAS, exact replay, and persistent scoped locks", () => {
  const f = brokerFixture();
  try {
    const c = f.broker.claim(f.token, f.request);
    assert.equal(c.state, "active");
    assert.equal(f.s.getResource(f.ids.task)!.data.status, "running");
    assert.deepEqual(f.broker.claim(f.token, f.request), c);
    assert.equal(
      f.s.db.prepare("SELECT count(*) n FROM broker_locks").get()!.n,
      3,
    );
    assert.throws(
      () => f.broker.claim(f.token, { ...f.request, lease_ms: 50000 }),
      /ACTION_PAYLOAD_CONFLICT/,
    );
  } finally {
    f.dispose();
  }
});

test("broker excludes overlapping logical paths across directories, case and ancestors atomically", () => {
  const f = brokerFixture();
  try {
    f.broker.claim(f.token, f.request);
    const other = id();
    f.broker.createWorkspace(
      f.ids.project,
      other,
      join(f.tmp.directory, "other"),
    );
    for (const paths of [
      ["SRC/Main.txt", "fresh.txt"],
      ["src"],
      ["src/main.txt/child"],
    ]) {
      const task = id(),
        scope = id(),
        candidate = id();
      for (const x of [task, scope, candidate]) {
        f.g.resource_ids.push(x);
        f.p.resource_ids.push(x);
      }
      f.s.putPolicy(f.p);
      f.s.updateGrant(f.g);
      for (const [key, kind, data] of [
        [task, "task", { status: "queued", inputs_valid: true }],
        [candidate, "changeset", {}],
        [
          scope,
          "broker_scope",
          { task_id: task, candidate_id: candidate, paths },
        ],
      ] as const)
        f.s.putResource({
          id: key,
          project_id: f.ids.project,
          kind,
          revision: "1",
          domain: f.g.domain,
          acl: [f.g.id],
          dependencies: [],
          data,
        });
      assert.throws(
        () =>
          f.broker.claim(f.token, {
            ...f.request,
            workspace_id: other,
            scope_id: scope,
            claim_id: id(),
          }),
        /PATH_BUSY/,
      );
      assert.equal(f.s.getResource(task)!.data.status, "queued");
    }
    assert.equal(
      f.s.db.prepare("SELECT count(*) n FROM broker_claims").get()!.n,
      1,
    );
  } finally {
    f.dispose();
  }
});

test("broker rejects traversal, ADS, device names, aliases, protected metadata and ambiguous scopes", () => {
  for (const path of [
    "../out",
    "C:/out",
    "\\\\host\\share",
    "src\\a",
    "src//a",
    "src/./a",
    "src/a.",
    "src/a ",
    "src/a:stream",
    "src/NUL.txt",
    ".git/config",
    ".team/changes/x",
    "src/CONIN$",
    "src/\u0000x",
  ]) {
    const f = brokerFixture();
    try {
      f.resource("scope", "broker_scope", {
        task_id: f.ids.task,
        candidate_id: f.ids.candidate,
        paths: [path],
      });
      assert.throws(
        () => f.broker.claim(f.token, f.request),
        /INVALID_PATH/,
        path,
      );
      assert.equal(f.s.getResource(f.ids.task)!.data.status, "queued");
    } finally {
      f.dispose();
    }
  }
});

test("broker authenticates both permissions and resource closure before exposing state or disk", () => {
  const f = brokerFixture();
  try {
    const policy = {
      ...f.p,
      actions: f.p.actions.filter((x) => x !== "broker_write"),
    };
    f.s.putPolicy(policy);
    assert.throws(
      () => f.broker.claim(f.token, f.request),
      /NOT_FOUND_OR_DENIED/,
    );
    f.s.putPolicy(f.p);
    const scope = f.s.getResource(f.ids.scope)!;
    scope.acl = [];
    f.s.putResource(scope);
    assert.throws(
      () => f.broker.claim(f.token, f.request),
      /NOT_FOUND_OR_DENIED/,
    );
    scope.acl = [f.g.id];
    f.s.putResource(scope);
    f.broker.claim(f.token, f.request);
    assert.throws(
      () => f.broker.read("wrong", f.ids.project, f.request.claim_id),
      /UNAUTHENTICATED/,
    );
    f.s.updateGrant({ ...f.g, state: "revoked" });
    assert.throws(
      () => f.broker.read(f.token, f.ids.project, f.request.claim_id),
      /GRANT_REVOKED/,
    );
  } finally {
    f.dispose();
  }
});

test("broker real writes link diff, markdown, journal, candidate and Git without accepting the task", () => {
  const f = brokerFixture();
  try {
    f.broker.claim(f.token, f.request);
    const request = {
      project_id: f.ids.project,
      claim_id: f.request.claim_id,
      action_id: id(),
      edits: [
        { path: "src/main.txt", before_digest: null, text: "hello\n" },
        { path: "src/extra.txt", before_digest: null, text: "extra\n" },
      ],
    };
    const result = f.broker.write(f.token, request);
    assert.equal(result.phase, "checkpointed");
    assert.match(result.commit, /^[a-f0-9]{40,64}$/);
    assert.equal(readFileSync(join(f.root, "src/main.txt"), "utf8"), "hello\n");
    assert.deepEqual(f.broker.write(f.token, request), result);
    assert.throws(
      () =>
        f.broker.write(f.token, {
          ...request,
          edits: [{ ...request.edits[0]!, text: "other" }],
        }),
      /ACTION_PAYLOAD_CONFLICT/,
    );
    const evidence = f.broker.read(f.token, f.ids.project, f.request.claim_id);
    assert.equal(evidence.edits.length, 1);
    assert.match(evidence.edits[0]!.diff, /\+hello/);
    assert.match(
      readFileSync(
        join(f.root, `.team/changes/${f.request.claim_id}.md`),
        "utf8",
      ),
      new RegExp(request.action_id),
    );
    assert.equal(
      f.s.getResource(f.ids.candidate)!.data.source_commit,
      result.commit,
    );
    assert.equal(
      execFileSync(gitExe, ["-C", f.root, "rev-parse", "HEAD"], {
        encoding: "utf8",
        windowsHide: true,
      }).trim(),
      result.commit,
    );
    assert.equal(f.s.getResource(f.ids.task)!.data.status, "running");
    f.broker.finish(f.token, f.ids.project, f.request.claim_id);
    assert.equal(f.s.getResource(f.ids.task)!.data.status, "in_review");
    assert.equal(
      f.s.getResource(f.ids.candidate)!.data.review_state,
      "pending",
    );
    assert.equal(
      f.s.db.prepare("SELECT count(*) n FROM broker_locks").get()!.n,
      0,
    );
    assert.throws(
      () => f.broker.write(f.token, { ...request, action_id: id() }),
      /CLAIM_NOT_ACTIVE/,
    );
  } finally {
    f.dispose();
  }
});

test("broker enforces before digests and preserves full cumulative changeset for updates/deletions", () => {
  const f = brokerFixture();
  try {
    f.broker.claim(f.token, f.request);
    const q = {
      project_id: f.ids.project,
      claim_id: f.request.claim_id,
      action_id: id(),
      edits: [{ path: "src/main.txt", before_digest: null, text: "one" }],
    };
    f.broker.write(f.token, q);
    assert.throws(
      () =>
        f.broker.write(f.token, {
          ...q,
          action_id: id(),
          edits: [{ path: "src/main.txt", before_digest: null, text: "lost" }],
        }),
      /BASELINE_CONFLICT/,
    );
    const second = f.broker.write(f.token, {
      ...q,
      action_id: id(),
      edits: [
        { path: "src/main.txt", before_digest: digest("one"), text: null },
        { path: "src/extra.txt", before_digest: null, text: "two" },
      ],
    });
    const data = f.s.getResource(f.ids.candidate)!.data;
    assert.equal(data.source_commit, second.commit);
    assert.equal(
      f.broker.read(f.token, f.ids.project, q.claim_id).edits.length,
      2,
    );
  } finally {
    f.dispose();
  }
});

test("broker unknown run, expired lease and revoked grant never prove stopped or free paths", () => {
  for (const mode of ["unknown", "expired", "revoked", "epoch"]) {
    const f = brokerFixture();
    try {
      f.broker.claim(f.token, f.request);
      if (mode === "expired") f.advance(60001);
      if (mode === "revoked") f.s.updateGrant({ ...f.g, state: "revoked" });
      if (mode === "unknown" || mode === "epoch") {
        const r = f.s.getRun(f.ids.run)!;
        if (mode === "unknown") r.state = "unknown";
        else r.epoch = "2";
        f.s.putRun(r);
      }
      assert.throws(() =>
        f.broker.write(f.token, {
          project_id: f.ids.project,
          claim_id: f.request.claim_id,
          action_id: id(),
          edits: [{ path: "src/main.txt", before_digest: null, text: "stale" }],
        }),
      );
      assert.equal(
        f.s.db.prepare("SELECT state FROM broker_claims").get()!.state,
        "quarantined",
      );
      assert.equal(
        f.s.db.prepare("SELECT count(*) n FROM broker_locks").get()!.n,
        3,
      );
    } finally {
      f.dispose();
    }
  }
});

test("broker rejects hardlinks and directory junctions without changing external files", () => {
  for (const mode of ["hardlink", "junction"]) {
    const f = brokerFixture();
    try {
      f.broker.claim(f.token, f.request);
      const external = join(f.tmp.directory, "external");
      mkdirSync(external);
      writeFileSync(join(external, "main.txt"), "outside");
      if (mode === "hardlink") {
        mkdirSync(join(f.root, "src"));
        linkSync(join(external, "main.txt"), join(f.root, "src/main.txt"));
      } else symlinkSync(external, join(f.root, "src"), "junction");
      assert.throws(
        () =>
          f.broker.write(f.token, {
            project_id: f.ids.project,
            claim_id: f.request.claim_id,
            action_id: id(),
            edits: [
              {
                path: "src/main.txt",
                before_digest: digest("outside"),
                text: "attack",
              },
            ],
          }),
        /UNSAFE_PATH/,
      );
      assert.equal(readFileSync(join(external, "main.txt"), "utf8"), "outside");
    } finally {
      f.dispose();
    }
  }
});

test("broker completed write and finish retries stay idempotent after handover", () => {
  const f = brokerFixture();
  try {
    f.broker.claim(f.token, f.request);
    const q = {
      project_id: f.ids.project,
      claim_id: f.request.claim_id,
      action_id: id(),
      edits: [{ path: "src/main.txt", before_digest: null, text: "done" }],
    };
    const written = f.broker.write(f.token, q),
      finished = f.broker.finish(f.token, f.ids.project, q.claim_id);
    const revision = f.s.getResource(f.ids.task)!.revision;
    assert.deepEqual(
      f.broker.finish(f.token, f.ids.project, q.claim_id),
      finished,
    );
    assert.deepEqual(f.broker.write(f.token, q), written);
    assert.equal(f.s.getResource(f.ids.task)!.revision, revision);
  } finally {
    f.dispose();
  }
});

test("broker read projection is side effect free and does not broaden audience", () => {
  const f = brokerFixture();
  try {
    f.broker.claim(f.token, f.request);
    const before = f.s.db.prepare("SELECT total_changes() n").get()!.n;
    f.broker.read(f.token, f.ids.project, f.request.claim_id);
    assert.equal(f.s.db.prepare("SELECT total_changes() n").get()!.n, before);
    const foreign = { ...f.g, id: id(), native_binding: f.g.native_binding };
    const token = f.s.issueGrant(foreign);
    assert.throws(
      () => f.broker.read(token, f.ids.project, f.request.claim_id),
      /NOT_FOUND_OR_DENIED/,
    );
    assert.throws(
      () => f.broker.finish(f.token, f.ids.project, f.request.claim_id),
      /RECOVERY_REQUIRED/,
    );
  } finally {
    f.dispose();
  }
});

test("broker rejects DOS short-name aliases before taking locks", () => {
  const f = brokerFixture();
  try {
    f.resource("scope", "broker_scope", {
      task_id: f.ids.task,
      candidate_id: f.ids.candidate,
      paths: ["src/LONGFI~1.TXT"],
    });
    assert.throws(() => f.broker.claim(f.token, f.request), /INVALID_PATH/);
    assert.equal(
      f.s.db.prepare("SELECT count(*) n FROM broker_locks").get()!.n,
      0,
    );
  } finally {
    f.dispose();
  }
});

test("broker checkpoint audit timestamp comes from service clock rather than a fabricated date", () => {
  const f = brokerFixture();
  try {
    f.broker.claim(f.token, f.request);
    const q = {
      project_id: f.ids.project,
      claim_id: f.request.claim_id,
      action_id: id(),
      edits: [{ path: "src/main.txt", before_digest: null, text: "audit" }],
    };
    f.broker.write(f.token, q);
    const entry = f.broker.read(f.token, f.ids.project, q.claim_id).edits[0]!;
    assert.equal(
      (entry as unknown as { observed_at: string }).observed_at,
      new Date(f.now()).toISOString(),
    );
    assert.equal(
      execFileSync(
        gitExe,
        ["-C", f.root, "show", "-s", "--format=%ct", "HEAD"],
        { encoding: "utf8", windowsHide: true },
      ).trim(),
      String(Math.floor(f.now() / 1000)),
    );
  } finally {
    f.dispose();
  }
});

test("broker quarantine retains the exact actionable reason instead of hiding it behind a generic state", () => {
  const f = brokerFixture();
  try {
    f.broker.claim(f.token, f.request);
    f.advance(60001);
    assert.throws(() =>
      f.broker.write(f.token, {
        project_id: f.ids.project,
        claim_id: f.request.claim_id,
        action_id: id(),
        edits: [{ path: "src/main.txt", before_digest: null, text: "late" }],
      }),
    );
    const state = f.broker.read(f.token, f.ids.project, f.request.claim_id);
    assert.equal(
      (state.claim as unknown as { quarantine_reason: string })
        .quarantine_reason,
      "LEASE_STALE",
    );
    assert.equal(
      f.s.db.prepare("SELECT count(*) n FROM broker_locks").get()!.n,
      3,
    );
  } finally {
    f.dispose();
  }
});
