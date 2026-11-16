import type { Store } from "./store.ts";
import type { Grant } from "./domain.ts";
import { canonical } from "./domain.ts";
import { fail } from "./errors.ts";

// Process-local ownership: persisted grants never recreate their verifier on restart.
const guards = new WeakMap<
  Store,
  Map<string, { snapshot: string; valid: (now: number) => boolean } | null>
>();
export function installConnectionGuard(
  store: Store,
  grant: Grant,
  valid: (now: number) => boolean,
) {
  let entries = guards.get(store);
  if (!entries) guards.set(store, (entries = new Map()));
  if (entries.has(grant.id))
    throw new Error("Connection guard already installed");
  entries.set(grant.id, { snapshot: canonical(grant), valid });
}
export function requireConnectionGuard(
  store: Store,
  grant: Grant,
  now: number,
) {
  const entries = guards.get(store),
    guard = entries?.get(grant.id);
  if (!Object.hasOwn(grant, "connection_constraint") && !entries?.has(grant.id))
    return;
  if (!guard) fail("GRANT_REVOKED");
  let valid = false;
  try {
    valid = guard.snapshot === canonical(grant) && guard.valid(now);
  } finally {
    // A failed observation is terminal; no reconnect may resurrect this grant.
    if (!valid) entries!.set(grant.id, null);
  }
  if (!valid) fail("GRANT_REVOKED");
}
