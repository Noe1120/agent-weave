import { authorizeGrant, requireResource } from "./auth.ts";
import { ConnectionRegistry } from "./connection-registry.ts";
import { installConnectionGuard } from "./connection-grant-guard.ts";
import { canonical, type Grant } from "./domain.ts";
import { fail } from "./errors.ts";
import type { WorkspaceService, Member } from "./workspace-service.ts";

export interface ConnectionObservation {
  connection_id: string;
  project_id: string;
  member_id: string;
  target: Member["client"];
  configuration_fingerprint: string;
  run_id: string;
  run_epoch: string;
  native_binding: string;
  mode: "owned_process";
  data_class: "synthetic_only";
  state: "active" | "unknown" | "closed";
  observed_at: number;
}

/** Trusted provisioning only. No HTTP minting, native launch, model call or ACL expansion. */
export class ConnectionTaskAccess {
  private readonly workspace: WorkspaceService;
  private readonly registry: ConnectionRegistry;
  private readonly observe: (
    connectionId: string,
  ) => ConnectionObservation | undefined;
  private readonly issued = new Map<
    string,
    { payload: string; token: string; expires: number }
  >();
  constructor(
    workspace: WorkspaceService,
    observe: (connectionId: string) => ConnectionObservation | undefined,
  ) {
    this.workspace = workspace;
    this.registry = new ConnectionRegistry(workspace);
    this.observe = observe;
  }
  issue(
    connectionToken: string,
    connectionId: string,
    template: Grant,
    taskId: string,
  ) {
    const { store, now } = this.workspace;
    // Caller objects never remain authoritative after provisioning.
    const grant = structuredClone(template);
    const payload = canonical({ connectionId, grant, taskId });
    for (const [id, entry] of this.issued)
      if (entry.expires <= now()) this.issued.delete(id);
    const result = store.transaction(() => {
      const connection = this.registry.read(connectionToken, connectionId);
      const old = this.issued.get(grant.id);
      if (old) {
        if (old.payload !== payload) fail("NOT_FOUND_OR_DENIED");
        const saved = store.getGrant(grant.id);
        if (!saved) fail("GRANT_REVOKED");
        const ctx = authorizeGrant(
          store,
          saved,
          saved.project_id,
          "read_resource",
          now(),
        );
        requireResource(store, ctx, taskId, "task");
        return {
          token: old.token,
          grant_id: saved.id,
          expires_at: saved.expires_at,
        };
      }
      const expires = Date.parse(grant.expires_at);
      if (
        store.getGrant(grant.id) ||
        Object.hasOwn(grant, "connection_constraint") ||
        grant.project_id !== connection.project_id ||
        grant.member_id !== connection.member_id ||
        grant.actions.length !== 1 ||
        grant.actions[0] !== "read_resource" ||
        !Number.isFinite(expires) ||
        expires <= now() ||
        expires > now() + 300000 ||
        expires > Date.parse(connection.expires_at)
      )
        fail("NOT_FOUND_OR_DENIED");
      const ctx = authorizeGrant(
        store,
        grant,
        grant.project_id,
        "read_resource",
        now(),
      );
      if (ctx.run.state !== "active") fail("GRANT_REVOKED");
      const closure = new Set<string>();
      requireResource(store, ctx, taskId, "task", closure);
      if (
        grant.resource_ids.length !== closure.size ||
        !grant.resource_ids.every((id) => closure.has(id)) ||
        [...closure].some(
          (id) => id !== taskId && store.getResource(id)?.kind === "task",
        )
      )
        fail("NOT_FOUND_OR_DENIED");
      grant.connection_constraint = {
        connection_id: connectionId,
        connection_revision: connection.revision,
        task_id: taskId,
        data_class: "synthetic_only",
      };
      const valid = (time: number) => {
        const observation = this.observe(connectionId);
        // A synchronous controller check can cross a clock tick. Validate against
        // completion time, never an earlier pre-observation timestamp or a grace window.
        const checkedAt = now();
        const current = this.registry.registered(connectionId);
        const run = store.getRun(grant.run_id);
        return (
          !!current &&
          current.revision === connection.revision &&
          current.configuration_fingerprint ===
            connection.configuration_fingerprint &&
          !!run &&
          run.state === "active" &&
          run.epoch === grant.run_epoch &&
          run.native_binding === grant.native_binding &&
          !!observation &&
          observation.connection_id === connectionId &&
          observation.project_id === grant.project_id &&
          observation.member_id === grant.member_id &&
          observation.target === connection.target &&
          observation.configuration_fingerprint ===
            connection.configuration_fingerprint &&
          observation.run_id === grant.run_id &&
          observation.run_epoch === grant.run_epoch &&
          observation.native_binding === grant.native_binding &&
          observation.mode === "owned_process" &&
          observation.data_class === "synthetic_only" &&
          observation.state === "active" &&
          Number.isFinite(observation.observed_at) &&
          checkedAt >= time &&
          observation.observed_at <= checkedAt &&
          checkedAt - observation.observed_at <= 30000 &&
          expires > checkedAt
        );
      };
      if (!valid(now())) fail("GRANT_REVOKED");
      const token = store.issueGrant(grant);
      return { token, grant_id: grant.id, expires_at: grant.expires_at, valid };
    });
    if ("valid" in result) {
      // Install only after the transaction commits; a reopened Store has no guard.
      const saved = store.getGrant(grant.id)!;
      installConnectionGuard(store, saved, result.valid);
      this.issued.set(grant.id, {
        payload,
        token: result.token,
        expires: Date.parse(result.expires_at),
      });
    }
    return {
      token: result.token,
      grant_id: result.grant_id,
      expires_at: result.expires_at,
    };
  }
}
