import assert from "node:assert/strict";
import { test } from "node:test";
import { dependencyFixture, provision } from "./dependency-helpers.ts";
import { id, ref } from "./helpers.ts";
import { KnowledgeReader } from "../packages/service/src/knowledge.ts";
function setup() {
  const f = dependencyFixture();
  const visible = id(),
    hidden = id(),
    derived = id();
  provision(f, [visible, hidden, derived], []);
  for (const rid of [visible, hidden, derived])
    f.s.putResource({
      id: rid,
      project_id: f.ids.project,
      kind: "knowledge_document",
      revision: "1",
      domain: f.g.domain,
      acl: rid === hidden ? [] : [f.g.id],
      dependencies: [],
      data: {
        title: "Guide",
        text:
          rid === hidden
            ? "private secret secret secret"
            : "shared secret note",
        source_refs: [ref(rid === derived ? hidden : f.base)],
      },
    });
  return {
    ...f,
    visible,
    hidden,
    derived,
    reader: new KnowledgeReader(f.s, f.now),
  };
}
test("authorized filtering precedes ranking and pagination; no hidden derivatives", () => {
  const f = setup();
  try {
    const rows = f.reader.search(f.token, f.ids.project, "secret", 1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.id, f.visible);
    assert.equal(rows[0]!.revision, "1");
    assert.deepEqual(rows[0]!.source_refs, [ref(f.base)]);
    assert.throws(
      () => f.reader.read(f.token, f.ids.project, f.hidden),
      /NOT_FOUND_OR_DENIED/,
    );
    assert.throws(
      () => f.reader.read(f.token, f.ids.project, f.derived),
      /NOT_FOUND_OR_DENIED/,
    );
    assert.throws(
      () => f.reader.read(f.token, f.ids.project, id()),
      /NOT_FOUND_OR_DENIED/,
    );
  } finally {
    f.close();
  }
});
test("retrieval never writes and current ACL/version is checked every time", () => {
  const f = setup();
  try {
    const n = f.s.db.prepare("SELECT total_changes() n").get()!.n;
    for (let i = 0; i < 100; i++)
      f.reader.search(f.token, f.ids.project, "secret", 5);
    assert.equal(f.s.db.prepare("SELECT total_changes() n").get()!.n, n);
    const source = f.s.getResource(f.base)!;
    source.revision = "2";
    f.s.putResource(source);
    assert.deepEqual(f.reader.search(f.token, f.ids.project, "secret", 5), []);
    assert.throws(
      () => f.reader.read(f.token, f.ids.project, f.visible),
      /KNOWLEDGE_STALE/,
    );
    f.g.state = "revoked";
    f.s.updateGrant(f.g);
    assert.throws(
      () => f.reader.search(f.token, f.ids.project, "secret", 5),
      /GRANT_REVOKED/,
    );
  } finally {
    f.close();
  }
});
for (const [query, limit] of [
  ["", 1],
  ["x".repeat(257), 1],
  ["secret", 0],
  ["secret", 51],
  ["secret", 1.5],
] as const)
  test("bounded retrieval input " + limit + "/" + query.length, () => {
    const f = setup();
    try {
      assert.throws(
        () => f.reader.search(f.token, f.ids.project, query, limit),
        /KNOWLEDGE_CONTRACT/,
      );
    } finally {
      f.close();
    }
  });
