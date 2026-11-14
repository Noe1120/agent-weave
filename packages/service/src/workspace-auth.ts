import { randomBytes, timingSafeEqual, createHmac } from "node:crypto";
import { digest } from "./store.ts";
import type { Store } from "./store.ts";
export class WorkspaceFault extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
export function reject(status: number, code: string): never {
  throw new WorkspaceFault(status, code);
}
export class OwnerAuth {
  readonly store: Store;
  readonly now: () => number;
  private attempts = 0;
  private window = 0;
  constructor(store: Store, now: () => number = Date.now) {
    this.store = store;
    this.now = now;
  }
  sign(value: string) {
    const key = this.store.db
      .prepare("SELECT value FROM console_secrets WHERE name='signing_key'")
      .get();
    if (!key) throw new Error("Missing signing key");
    return createHmac("sha256", Buffer.from(String(key.value), "hex"))
      .update(value)
      .digest("base64url");
  }
  newPairing() {
    const code = randomBytes(32).toString("base64url"),
      expires = this.now() + 600000;
    this.store.transaction(() => {
      this.store.db.prepare("DELETE FROM console_pairings").run();
      this.store.db
        .prepare("INSERT INTO console_pairings(hash,expires_at) VALUES(?,?)")
        .run(digest(code), expires);
    });
    return { code, expires_at: new Date(expires).toISOString() };
  }
  pair(code: string) {
    if (this.now() - this.window > 60000) {
      this.window = this.now();
      this.attempts = 0;
    }
    if (this.attempts >= 10) reject(429, "RATE_LIMITED");
    this.attempts++;
    return this.store.transaction(() => {
      const row = this.store.db
        .prepare("SELECT * FROM console_pairings WHERE hash=?")
        .get(digest(code));
      if (!row || row.used !== 0 || Number(row.expires_at) <= this.now())
        reject(401, "PAIRING_INVALID");
      const token = randomBytes(32).toString("base64url"),
        expires = this.now() + 8 * 3600000;
      this.store.db
        .prepare("UPDATE console_pairings SET used=1 WHERE hash=?")
        .run(digest(code));
      this.store.db
        .prepare("DELETE FROM console_sessions WHERE expires_at<=?")
        .run(this.now());
      this.store.db
        .prepare("INSERT INTO console_sessions VALUES(?,?)")
        .run(digest(token), expires);
      this.attempts = 0;
      return {
        token,
        csrf: this.sign("csrf:" + token),
        expires_at: new Date(expires).toISOString(),
      };
    });
  }
  session(token: string) {
    const session = token
      ? this.store.db
          .prepare("SELECT expires_at FROM console_sessions WHERE hash=?")
          .get(digest(token))
      : undefined;
    if (!session || Number(session.expires_at) <= this.now())
      reject(401, "SESSION_REQUIRED");
    return {
      csrf: this.sign("csrf:" + token),
      expires_at: new Date(Number(session.expires_at)).toISOString(),
    };
  }
  authorize(token: string, csrf?: string) {
    const session = this.session(token);
    if (csrf !== undefined) {
      const actual = Buffer.from(csrf),
        expected = Buffer.from(session.csrf);
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        reject(403, "CSRF_REJECTED");
    }
  }
  logout(token: string) {
    this.store.db
      .prepare("DELETE FROM console_sessions WHERE hash=?")
      .run(digest(token));
  }
}
