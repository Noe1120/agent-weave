import assert from "node:assert/strict";
import { test } from "node:test";
import { adapterFixture } from "./adapter-helpers.ts";
import { id } from "./helpers.ts";
import type { AdapterBinding } from "../packages/service/src/adapter-registry.ts";
const denied = /NOT_FOUND_OR_DENIED/;
test("registration receipt replay and CAS are atomic, stale retry never reactivates", () => {
  const f = adapterFixture();
  try {
    const req = f.request();
    const receipt = f.registry.register(f.token, req);
    const n = f.s.db.prepare("SELECT total_changes() n").get()!.n;
    assert.deepEqual(f.registry.register(f.token, req), receipt);
    assert.equal(f.s.db.prepare("SELECT total_changes() n").get()!.n, n);
    assert.throws(
      () => f.registry.register(f.token, { ...req, session_id: "changed" }),
      /ACTION_CONFLICT/,
    );
    assert.throws(
      () => f.registry.register(f.token, f.request()),
      /REVISION_CONFLICT/,
    );
    const action = id();
    const result = f.registry.invalidate(
      f.token,
      f.ids.project,
      f.binding,
      "1",
      action,
    );
    assert.deepEqual(
      f.registry.invalidate(f.token, f.ids.project, f.binding, "1", action),
      result,
    );
    assert.deepEqual(f.registry.register(f.token, req), receipt);
    assert.equal(
      f.registry.read(f.token, f.ids.project, f.binding).state,
      "invalidated",
    );
    assert.equal(f.s.getResource(f.binding)!.revision, "2");
  } finally {
    f.close();
  }
});
test("real target never qualifies from declaration or synthetic observation; all reads inert", () => {
  const f = adapterFixture();
  try {
    f.registry.register(f.token, f.request());
    let view = f.registry.read(f.token, f.ids.project, f.binding);
    assert.equal(view.capabilities.progress.reason, "UNVERIFIED");
    f.observe();
    view = f.registry.read(f.token, f.ids.project, f.binding);
    assert.equal(view.capabilities.progress.qualification, "UNVERIFIED");
    assert.equal(view.capabilities.progress.enabled, false);
    const before = f.s.db.prepare("SELECT total_changes() n").get()!.n;
    for (let i = 0; i < 100; i++)
      f.registry.read(f.token, f.ids.project, f.binding);
    assert.equal(f.s.db.prepare("SELECT total_changes() n").get()!.n, before);
    f.registry.register(
      f.token,
      f.request({ expected_revision: "1", protocol_version: "fixture-2" }),
    );
    assert.equal(
      f.registry.read(f.token, f.ids.project, f.binding).capabilities.progress
        .reason,
      "CONFIG_CHANGED",
    );
  } finally {
    f.close();
  }
});
for (const kind of [
  "revoked",
  "expired",
  "policy",
  "epoch",
  "unknown",
  "scope",
  "dependency",
  "binding",
  "cross_project",
  "cross_domain",
  "action",
] as const)
  test("rejects unauthorized registration: " + kind, () => {
    const f = adapterFixture();
    try {
      const req = f.request();
      if (kind === "revoked") f.g.state = "revoked";
      if (kind === "expired") f.advance(86400001);
      if (kind === "policy") f.p.revision = "2";
      if (kind === "epoch" || kind === "unknown") {
        const r = f.s.getRun(f.ids.run)!;
        if (kind === "epoch") r.epoch = "2";
        else r.state = "unknown";
        f.s.putRun(r);
      }
      if (kind === "scope")
        f.g.resource_ids = f.g.resource_ids.filter((x) => x !== f.ids.scope);
      if (kind === "dependency")
        f.g.resource_ids = f.g.resource_ids.filter((x) => x !== f.ids.task);
      if (kind === "binding") req.binding_id = id();
      if (kind === "cross_project") req.project_id = id();
      if (kind === "cross_domain") f.g.domain = "public";
      if (kind === "action")
        f.p.actions = f.p.actions.filter((x) => x !== "adapter_configure");
      f.s.updateGrant(f.g);
      f.s.putPolicy(f.p);
      assert.throws(
        () => f.registry.register(f.token, req),
        /NOT_FOUND_OR_DENIED|GRANT_REVOKED|EXECUTION_UNKNOWN/,
      );
      assert.equal(f.s.getResource(f.binding), undefined);
    } finally {
      f.close();
    }
  });
test("replay rechecks authorization and scope; hidden and absent read share error", () => {
  const f = adapterFixture();
  try {
    const req = f.request();
    f.registry.register(f.token, req);
    f.g.resource_ids = f.g.resource_ids.filter((x) => x !== f.ids.task);
    f.s.updateGrant(f.g);
    assert.throws(() => f.registry.register(f.token, req), denied);
    assert.throws(
      () => f.registry.read(f.token, f.ids.project, f.binding),
      denied,
    );
    assert.throws(() => f.registry.read(f.token, f.ids.project, id()), denied);
  } finally {
    f.close();
  }
});
test("ID collision cannot overwrite scope; binding cannot be rebound to another scope", () => {
  const f = adapterFixture();
  try {
    assert.throws(
      () => f.registry.register(f.token, f.request({ binding_id: f.ids.task })),
      denied,
    );
    f.registry.register(f.token, f.request());
    assert.throws(
      () =>
        f.registry.register(
          f.token,
          f.request({ expected_revision: "1", scope_id: f.ids.root }),
        ),
      denied,
    );
    assert.equal(f.s.getResource(f.ids.task)!.kind, "task");
  } finally {
    f.close();
  }
});
test("attached detach invalidates only local binding and never changes run/claims", () => {
  const f = adapterFixture();
  try {
    f.registry.register(f.token, f.request());
    const run = f.s.getRun(f.ids.run);
    for (const op of [
      "send_message",
      "reply_wait",
      "approve",
      "interrupt",
    ] as const)
      assert.throws(
        () => f.registry.operation(f.token, f.ids.project, f.binding, op),
        /CAPABILITY_UNAVAILABLE/,
      );
    const action = id();
    const receipt = f.registry.detach(
      f.token,
      f.ids.project,
      f.binding,
      "1",
      action,
    );
    assert.deepEqual(
      f.registry.detach(f.token, f.ids.project, f.binding, "1", action),
      receipt,
    );
    assert.equal(
      f.s.getResource<AdapterBinding>(f.binding)!.data.connection_ref,
      null,
    );
    assert.deepEqual(f.s.getRun(f.ids.run), run);
    assert.equal(
      f.s.db.prepare("SELECT COUNT(*) n FROM runner_executions").get()!.n,
      0,
    );
  } finally {
    f.close();
  }
});
test("owned process cannot pretend detach succeeded", () => {
  const f = adapterFixture();
  try {
    f.registry.register(f.token, f.request({ binding_mode: "owned_process" }));
    assert.throws(
      () => f.registry.detach(f.token, f.ids.project, f.binding, "1", id()),
      /CAPABILITY_UNAVAILABLE/,
    );
  } finally {
    f.close();
  }
});

test("audit failure rolls back binding and never widens grants", () => {
  const f = adapterFixture();
  try {
    const grantBefore = f.s.getGrant(f.ids.grant);
    f.s.db.exec(
      "CREATE TRIGGER fail_adapter_audit BEFORE INSERT ON resources WHEN NEW.kind='adapter_registration_action' BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END;",
    );
    assert.throws(
      () => f.registry.register(f.token, f.request()),
      /fixture audit failure/,
    );
    assert.equal(f.s.getResource(f.binding), undefined);
    assert.deepEqual(f.s.getGrant(f.ids.grant), grantBefore);
  } finally {
    f.close();
  }
});
