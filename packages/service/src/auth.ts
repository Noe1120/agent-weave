import type { Store } from "./store.ts";
import type { Action, Context, Grant, Resource } from "./domain.ts";
import { fail, TransportFault } from "./errors.ts";
export function authenticate(
  store: Store,
  token: string,
  project: string,
  action: Action,
  now: number,
): Context {
  const grant = token ? store.grantForToken(token) : undefined;
  if (!grant) throw new TransportFault(401, "UNAUTHENTICATED");
  return authorizeGrant(store, grant, project, action, now);
}
export function authorizeGrant(
  store: Store,
  grant: Grant,
  project: string,
  action: Action,
  now: number,
): Context {
  if (grant.project_id !== project) fail("NOT_FOUND_OR_DENIED");
  if (
    grant.state !== "active" ||
    !Number.isFinite(Date.parse(grant.expires_at)) ||
    Date.parse(grant.expires_at) <= now
  )
    fail("GRANT_REVOKED");
  const policy = store.getPolicy(grant.policy_id),
    run = store.getRun(grant.run_id);
  if (
    !policy ||
    !policy.active ||
    policy.member_id !== grant.member_id ||
    policy.project_id !== project ||
    policy.revision !== grant.policy_revision
  )
    fail("GRANT_REVOKED");
  if (
    !run ||
    run.project_id !== project ||
    run.epoch !== grant.run_epoch ||
    run.native_binding !== grant.native_binding ||
    run.state === "closed"
  )
    fail("GRANT_REVOKED");
  if (!grant.actions.includes(action) || !policy.actions.includes(action))
    fail("NOT_FOUND_OR_DENIED");
  return { grant, policy, run };
}
export function requireResource<T = Record<string, unknown>>(
  store: Store,
  ctx: Context,
  id: string,
  kind?: string,
  seen = new Set<string>(),
): Resource<T> {
  const r = store.getResource<T>(id);
  if (
    !r ||
    r.project_id !== ctx.grant.project_id ||
    r.domain !== ctx.grant.domain ||
    !r.acl.includes(ctx.grant.id) ||
    !ctx.grant.resource_ids.includes(id) ||
    !ctx.policy.resource_ids.includes(id) ||
    (kind && r.kind !== kind)
  )
    fail("NOT_FOUND_OR_DENIED");
  if (!seen.has(id)) {
    seen.add(id);
    // Reference-bearing fields are authority dependencies too; an omitted explicit
    // dependency list must never turn a projected ref into an information leak.
    const references = new Set(r.dependencies);
    function collect(value: unknown) {
      if (Array.isArray(value)) {
        for (const item of value) collect(item);
        return;
      }
      if (value === null || typeof value !== "object") return;
      const object = value as Record<string, unknown>;
      if (typeof object.id === "string" && typeof object.revision === "string")
        references.add(object.id);
      for (const child of Object.values(object)) collect(child);
    }
    collect(r.data);
    for (const dependency of references)
      requireResource(store, ctx, dependency, undefined, seen);
  }
  return r;
}
export function requireRun(ctx: Context, run: string, epoch: string) {
  if (run !== ctx.grant.run_id || epoch !== ctx.grant.run_epoch)
    fail("NOT_FOUND_OR_DENIED");
}
export function requireActive(ctx: Context) {
  if (ctx.run.state !== "active") fail("EXECUTION_UNKNOWN");
}
