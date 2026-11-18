import { randomUUID } from "node:crypto";
import {
  authenticate,
  authorizeGrant,
  requireActive,
  requireResource,
} from "./auth.ts";
import {
  AdapterFault,
  capabilities,
  contract,
  fingerprint,
  revision,
  uuid,
} from "./adapter-contract.ts";
import {
  canonical,
  nextRevision,
  type Context,
  type Resource,
} from "./domain.ts";
import { fail } from "./errors.ts";
import { Store, digest } from "./store.ts";
import type { AcpExit, AcpHandle, AcpHello, DshLauncher } from "./dsh-acp.ts";

type RuntimeState =
  | "starting"
  | "ready"
  | "closing"
  | "closed"
  | "disconnected"
  | "failed"
  | "unknown";
export interface DshRuntimeData {
  target: "deepseek_harness";
  mode: "initialize_only";
  scope_id: string;
  grant_id: string;
  controller_id: string;
  instance_id: string;
  configuration_fingerprint: string;
  client_version: string;
  source: DshLauncher["source"];
  state: RuntimeState;
  observed_at: string;
  hello: AcpHello | null;
  fault: string | null;
  exit: AcpExit | null;
}
interface StartRequest {
  project_id: string;
  runtime_id: string;
  scope_id: string;
  action_id: string;
  expected_revision: string;
  configuration_fingerprint: string;
}
interface CloseRequest {
  project_id: string;
  runtime_id: string;
  action_id: string;
  expected_revision: string;
}
interface Receipt {
  runtime_id: string;
  instance_id: string;
  revision: string;
  operation_status: "accepted";
}
interface Action {
  grant_id: string;
  fingerprint: string;
  receipt: Receipt;
}
interface Owned {
  runtimeId: string;
  projectId: string;
  grantId: string;
  instanceId: string;
  handle?: AcpHandle;
  work: Promise<void>;
  stopRequested: boolean;
  finished: boolean;
  persistenceFault: boolean;
  fault: string | null;
}
function request(value: unknown, start: boolean): StartRequest | CloseRequest {
  contract(
    value !== null && typeof value === "object" && !Array.isArray(value),
  );
  const r = value as Record<string, unknown>,
    keys = [
      "project_id",
      "runtime_id",
      "action_id",
      "expected_revision",
      ...(start ? ["scope_id", "configuration_fingerprint"] : []),
    ];
  contract(
    Object.keys(r).length === keys.length &&
      keys.every((k) => Object.hasOwn(r, k)),
  );
  contract(
    [r.project_id, r.runtime_id, r.action_id].every(uuid) &&
      revision(r.expected_revision),
  );
  if (start)
    contract(
      uuid(r.scope_id) &&
        r.scope_id !== r.runtime_id &&
        fingerprint(r.configuration_fingerprint),
    );
  return structuredClone(r) as unknown as StartRequest | CloseRequest;
}
const active = (state: RuntimeState) =>
  ["starting", "ready", "closing"].includes(state);
/** Trusted in-process assembly. Uses W08 permissions/resources, without inventing a native session. */
export class DshRuntimeController {
  get isOfficial() {
    return this.launcher.source !== "development_fixture";
  }
  private readonly store: Store;
  private readonly launcher: DshLauncher;
  private readonly now: () => number;
  private readonly owner = randomUUID();
  private readonly owned = new Map<string, Owned>();
  private readonly monitor?: NodeJS.Timeout;
  private disposed = false;
  constructor(
    store: Store,
    launcher: DshLauncher,
    options: { now?: () => number; monitorMs?: number } = {},
  ) {
    this.store = store;
    this.launcher = launcher;
    this.now = options.now ?? Date.now;
    contract(fingerprint(launcher.fingerprint));
    const interval = options.monitorMs ?? 250;
    contract(Number.isInteger(interval) && interval >= 0 && interval <= 60000);
    if (interval)
      this.monitor = setInterval(
        () => this.reconcileAuthorization(),
        interval,
      ).unref();
  }
  private context(token: string, project: string, write = false) {
    const ctx = authenticate(
      this.store,
      token,
      project,
      write ? "adapter_configure" : "adapter_read",
      this.now(),
    );
    if (write) requireActive(ctx);
    return ctx;
  }
  private runtime(ctx: Context, id: string) {
    return requireResource<DshRuntimeData>(
      this.store,
      ctx,
      id,
      "adapter_runtime",
    );
  }
  private replay(ctx: Context, id: string, payload: unknown) {
    const a = this.store.getResource<Action>("dsh-runtime-action:" + id);
    if (!a) return;
    if (
      a.kind !== "adapter_runtime_action" ||
      a.project_id !== ctx.grant.project_id ||
      a.domain !== ctx.grant.domain ||
      a.data.grant_id !== ctx.grant.id
    )
      fail("NOT_FOUND_OR_DENIED");
    this.runtime(ctx, a.data.receipt.runtime_id);
    if (a.data.fingerprint !== digest(canonical(payload)))
      throw new AdapterFault("ACTION_CONFLICT");
    return a.data.receipt;
  }
  private receipt(
    ctx: Context,
    r: Resource<DshRuntimeData>,
    actionId: string,
    payload: unknown,
  ): Receipt {
    const receipt: Receipt = {
      runtime_id: r.id,
      instance_id: r.data.instance_id,
      revision: r.revision,
      operation_status: "accepted",
    };
    this.store.putResource<Action>({
      id: "dsh-runtime-action:" + actionId,
      project_id: r.project_id,
      kind: "adapter_runtime_action",
      revision: "1",
      domain: r.domain,
      acl: [ctx.grant.id],
      dependencies: [r.id, r.data.scope_id],
      data: {
        grant_id: ctx.grant.id,
        fingerprint: digest(canonical(payload)),
        receipt,
      },
    });
    return receipt;
  }
  async start(token: string, value: unknown): Promise<Receipt> {
    const r = request(value, true) as StartRequest;
    if (this.disposed) throw new AdapterFault("DSH_CONTROLLER_CLOSED");
    let fresh: Owned | undefined;
    const receipt = this.store.transaction(() => {
      const ctx = this.context(token, r.project_id, true),
        scope = requireResource(this.store, ctx, r.scope_id, "scope");
      if (
        !ctx.grant.resource_ids.includes(r.runtime_id) ||
        !ctx.policy.resource_ids.includes(r.runtime_id)
      )
        fail("NOT_FOUND_OR_DENIED");
      const cached = this.replay(ctx, r.action_id, {
        operation: "start",
        ...r,
      });
      if (cached) return cached;
      if (r.configuration_fingerprint !== this.launcher.fingerprint)
        throw new AdapterFault("DSH_CONFIG_CHANGED");
      if (r.expected_revision !== "0" || this.store.getResource(r.runtime_id))
        throw new AdapterFault("REVISION_CONFLICT");
      const instanceId = randomUUID();
      const resource: Resource<DshRuntimeData> = {
        id: r.runtime_id,
        project_id: r.project_id,
        kind: "adapter_runtime",
        revision: "1",
        domain: scope.domain,
        acl: [ctx.grant.id],
        dependencies: [scope.id],
        data: {
          target: "deepseek_harness",
          mode: "initialize_only",
          scope_id: scope.id,
          grant_id: ctx.grant.id,
          controller_id: this.owner,
          instance_id: instanceId,
          configuration_fingerprint: r.configuration_fingerprint,
          client_version: this.launcher.clientVersion,
          source: this.launcher.source,
          state: "starting",
          observed_at: new Date(this.now()).toISOString(),
          hello: null,
          fault: null,
          exit: null,
        },
      };
      this.store.putResource(resource);
      const accepted = this.receipt(ctx, resource, r.action_id, {
        operation: "start",
        ...r,
      });
      fresh = {
        runtimeId: r.runtime_id,
        projectId: r.project_id,
        grantId: ctx.grant.id,
        instanceId,
        work: Promise.resolve(),
        stopRequested: false,
        finished: false,
        persistenceFault: false,
        fault: null,
      };
      return accepted;
    });
    if (fresh) {
      this.owned.set(r.runtime_id, fresh);
      fresh.work = this.launch(fresh);
      await fresh.work;
    }
    return receipt; // A durable acceptance receipt, never a claim that initialization or work succeeded.
  }
  private current(entry: Owned) {
    const r = this.store.getResource<DshRuntimeData>(entry.runtimeId);
    return r?.kind === "adapter_runtime" &&
      r.data.controller_id === this.owner &&
      r.data.instance_id === entry.instanceId
      ? r
      : undefined;
  }
  private authorized(entry: Owned): boolean {
    if (
      this.disposed ||
      entry.stopRequested ||
      entry.finished ||
      entry.persistenceFault
    )
      return false;
    try {
      const r = this.current(entry),
        g = this.store.getGrant(entry.grantId);
      if (
        !r ||
        !g ||
        !active(r.data.state) ||
        r.data.configuration_fingerprint !== this.launcher.fingerprint
      )
        return false;
      const ctx = authorizeGrant(
        this.store,
        g,
        entry.projectId,
        "adapter_configure",
        this.now(),
      );
      requireActive(ctx);
      this.runtime(ctx, entry.runtimeId);
      return true;
    } catch {
      return false;
    } // A failed recheck never grants launch or further work.
  }
  private record(entry: Owned, patch: Partial<DshRuntimeData>): boolean {
    try {
      return this.store.transaction(() => {
        const r = this.current(entry);
        if (!r || !active(r.data.state)) return false;
        this.store.putResource({
          ...r,
          revision: nextRevision(r.revision),
          data: {
            ...r.data,
            ...patch,
            observed_at: new Date(this.now()).toISOString(),
          },
        });
        return true;
      });
    } catch {
      // Expose failure in read(); never claim a stale persisted ready state is live.
      entry.persistenceFault = true;
      entry.fault = "DSH_PERSISTENCE";
      entry.stopRequested = true;
      entry.handle?.close();
      return false;
    }
  }
  private async launch(entry: Owned) {
    try {
      if (!this.authorized(entry))
        throw new AdapterFault("DSH_AUTHORIZATION_CHANGED");
      const handle = await this.launcher.launch(() => this.authorized(entry));
      entry.handle = handle;
      void handle.closed
        .then((exit) => {
          const state: RuntimeState =
            !exit.exit_observed || exit.forced
              ? "unknown"
              : exit.fault
                ? "failed"
                : entry.stopRequested
                  ? "closed"
                  : "disconnected";
          this.record(entry, { state, exit, fault: entry.fault ?? exit.fault });
          entry.finished = true;
        })
        .catch(() => {
          this.record(entry, {
            state: "unknown",
            fault: "DSH_TRANSPORT_UNKNOWN",
          });
          entry.finished = true;
        });
      if (!this.authorized(entry))
        this.stop(entry, "DSH_AUTHORIZATION_CHANGED");
      const hello = await handle.ready;
      if (handle.status.state !== "ready")
        throw new AdapterFault(handle.status.fault ?? "DSH_TRANSPORT_UNKNOWN");
      if (!this.authorized(entry)) {
        this.stop(entry, "DSH_AUTHORIZATION_CHANGED");
        return;
      }
      if (!this.record(entry, { state: "ready", hello }))
        this.stop(entry, "DSH_PERSISTENCE");
    } catch (error) {
      entry.fault ??= error instanceof AdapterFault ? error.code : "DSH_LAUNCH";
      if (entry.handle) {
        entry.handle.close();
        await entry.handle.closed;
      } else {
        this.record(entry, {
          state: entry.stopRequested ? "closed" : "failed",
          fault: entry.fault,
        });
        entry.finished = true;
      }
    }
  }
  private stop(entry: Owned, reason: string | null) {
    if (entry.finished || entry.stopRequested) return;
    entry.stopRequested = true;
    entry.fault ??= reason;
    this.record(entry, { state: "closing", fault: entry.fault });
    entry.handle?.close();
  }
  read(token: string, project: string, id: string) {
    contract(uuid(project) && uuid(id));
    const ctx = this.context(token, project),
      r = this.runtime(ctx, id),
      entry = this.owned.get(id);
    let state = r.data.state,
      fault = r.data.fault;
    if (ctx.run.state !== "active" && active(state)) {
      state = "unknown";
      fault = "DSH_EXECUTION_UNKNOWN";
    }
    if (
      active(state) &&
      (!entry ||
        r.data.controller_id !== this.owner ||
        entry.instanceId !== r.data.instance_id ||
        entry.finished)
    ) {
      state = "unknown";
      fault = "DSH_OWNER_UNKNOWN";
    }
    if (
      r.data.configuration_fingerprint !== this.launcher.fingerprint &&
      active(r.data.state)
    ) {
      state = "unknown";
      fault = "DSH_CONFIG_CHANGED";
    }
    if (state === "ready" && entry?.handle?.status.state !== "ready") {
      state = "unknown";
      fault = entry?.handle?.status.fault ?? "DSH_TRANSPORT_UNKNOWN";
    }
    if (entry?.persistenceFault) {
      state = "unknown";
      fault = "DSH_PERSISTENCE";
    }
    return {
      runtime_id: r.id,
      revision: r.revision,
      target: r.data.target,
      binding_mode: "owned_process" as const,
      session_id: null,
      state,
      fault,
      instance_id: r.data.instance_id,
      configuration_fingerprint: r.data.configuration_fingerprint,
      client_version: r.data.client_version,
      protocol_version: r.data.hello?.protocol_version ?? null,
      bridge_version: r.data.hello?.bridge_version ?? null,
      advertised: r.data.hello?.advertised ?? null,
      observed_at: r.data.observed_at,
      observation_source: r.data.source,
      qualification: "UNVERIFIED" as const,
      execution_stop_proven: false,
      exit: r.data.exit,
      capabilities: Object.fromEntries(
        capabilities.map((c) => [
          c,
          { enabled: false, reason: "UNVERIFIED" as const },
        ]),
      ),
    };
  }
  async close(token: string, value: unknown): Promise<Receipt> {
    const r = request(value, false) as CloseRequest;
    let entry: Owned | undefined;
    const receipt = this.store.transaction(() => {
      const ctx = this.context(token, r.project_id, true),
        resource = this.runtime(ctx, r.runtime_id);
      const cached = this.replay(ctx, r.action_id, {
        operation: "close",
        ...r,
      });
      if (cached) return cached;
      if (resource.revision !== r.expected_revision)
        throw new AdapterFault("REVISION_CONFLICT");
      entry = this.owned.get(r.runtime_id);
      if (
        !entry ||
        resource.data.controller_id !== this.owner ||
        resource.data.instance_id !== entry.instanceId
      )
        throw new AdapterFault("DSH_OWNER_UNKNOWN");
      if (entry.persistenceFault) throw new AdapterFault("DSH_PERSISTENCE");
      const updated = active(resource.data.state)
        ? {
            ...resource,
            revision: nextRevision(resource.revision),
            data: {
              ...resource.data,
              state: "closing" as const,
              observed_at: new Date(this.now()).toISOString(),
            },
          }
        : resource;
      this.store.putResource(updated);
      return this.receipt(ctx, updated, r.action_id, {
        operation: "close",
        ...r,
      });
    });
    if (entry) {
      entry.stopRequested = true;
      entry.handle?.close();
      await entry.work;
      if (entry.handle) await entry.handle.closed;
    }
    return receipt;
  }
  /** Explicit maintenance, independent of progress reads; never starts or retries a client. */
  reconcileAuthorization() {
    for (const entry of this.owned.values())
      if (!entry.finished && !entry.stopRequested && !this.authorized(entry))
        this.stop(entry, "DSH_AUTHORIZATION_CHANGED");
  }
  async dispose() {
    this.disposed = true;
    clearInterval(this.monitor);
    for (const entry of this.owned.values())
      this.stop(entry, "DSH_CONTROLLER_CLOSED");
    await Promise.all(
      [...this.owned.values()].map(async (entry) => {
        await entry.work;
        if (entry.handle) await entry.handle.closed;
      }),
    );
  }
}
