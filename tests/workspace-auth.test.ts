import test from "node:test";
import assert from "node:assert/strict";
import { OwnerAuth } from "../packages/service/src/workspace-auth.ts";
import { Store } from "../packages/service/src/store.ts";
test("owner pairing uses one-time expiring credential; session and csrf independent of execution grants", () => {
  const s = new Store();
  let now = Date.now();
  const a = new OwnerAuth(s, () => now);
  try {
    const p = a.newPairing();
    assert.match(p.code, /^[A-Za-z0-9_-]{43}$/);
    const session = a.pair(p.code);
    assert.match(session.token, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(session.token, p.code);
    assert.throws(() => a.pair(p.code), /PAIRING_INVALID/);
    a.authorize(session.token, session.csrf);
    assert.throws(() => a.authorize(session.token, "wrong"), /CSRF_REJECTED/);
    assert.equal(s.grantForToken(session.token), undefined);
    a.logout(session.token);
    assert.throws(() => a.session(session.token), /SESSION_REQUIRED/);
  } finally {
    s.close();
  }
});
test("owner rejects expired pairing and expired session, limits brute force, permits fresh local pairing", () => {
  const s = new Store();
  let now = Date.now();
  const a = new OwnerAuth(s, () => now);
  try {
    const p = a.newPairing();
    now += 600001;
    assert.throws(() => a.pair(p.code), /PAIRING_INVALID/);
    const fresh = a.newPairing();
    const session = a.pair(fresh.code);
    now += 8 * 3600000;
    assert.throws(() => a.session(session.token), /SESSION_REQUIRED/);
    for (let i = 0; i < 10; i++)
      assert.throws(() => a.pair("wrong"), /PAIRING_INVALID/);
    assert.throws(() => a.pair("wrong"), /RATE_LIMITED/);
    now += 60001;
    const newCode = a.newPairing();
    assert.ok(a.pair(newCode.code).token);
  } finally {
    s.close();
  }
});
