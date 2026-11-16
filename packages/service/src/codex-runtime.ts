import { createHash, randomUUID } from "node:crypto";
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
import type {
  CodexExit,
  CodexHandle,
  CodexInitialize,
  CodexLauncher,
} from "./codex-app-server.ts";

export type CodexState =
  | "starting"
  | "ready"
  | "turning"
  | "closing"
  | "closed"
  | "disconnected"
  | "failed"
  | "unknown";
export type CodexTurnState =
  "none" | "requested" | "completed" | "failed" | "interrupted" | "unknown";
export interface CodexRuntimeData {
  target: "codex";
  mode: "app_server_thread";
  scope_id: string;
  grant_id: string;
  controller_id: string;
  instance_id: string;
  configuration_fingerprint: string;
  client_version: string;
  source: CodexLauncher["source"];
  state: CodexState;
  observed_at: string;
  initialize: CodexInitialize | null;
  /** Native thread identifier; ACL-scoped storage only, never a platform session. */
  thread: string | null;
  thread_sha256: string | null;
  instruction_profile: "synthetic_task_get/1" | null;
  instruction_task_id: string | null;
  turn: { id: string | null; state: CodexTurnState } | null;
  fault: string | null;
  exit: CodexExit | null;
}
interface StartRequest {
  project_id: string;
  runtime_id: string;
  scope_id: string;
  action_id: string;
  expected_revision: string;
  configuration_fingerprint: string;
}
interface TurnRequest {
  project_id: string;
  runtime_id: string;
  action_id: string;
  expected_revision: string;
  instruction_profile: string;
  task_id: string;
}
interface RevisionRequest {
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
  handle?: CodexHandle;
  work: Promise<void>;
  stopRequested: boolean;
  finished: boolean;
  persistenceFault: boolean;
  fault: string | null;
  turnTimeouts: number;
  turnTimer?: NodeJS.Timeout;
}
const active = (state: CodexState) =>
  ["starting", "ready", "turning", "closing"].includes(state);
/** The only instruction this module can ever send. The task id comes from the grant. */
export function syntheticInstruction(taskId: string): string {
  // Two real surfaces. In code mode the client's own `functions.exec` contract
  // says nested tools are normalized identifiers, so the MCP call is
  // `tools.mcp__<server>__<tool>` — not a dotted path and not an enumeration.
  return (
    "Read one platform task and report it. Use exactly one tool call. " +
    "If the MCP function mcp__agent_weave_probe__task_get is directly callable, " +
    'call it once with {"task_id":"' +
    taskId +
    '"}. ' +
    "Otherwise call functions.exec exactly once with exactly this code: " +
    'return await tools.mcp__agent_weave_probe__task_get({ task_id: "' +
    taskId +
    '" }); ' +
    "Then reply with the returned task id and status. Do not call wait, sleep, " +
    "collaboration, shell or any other tool."
  );
}
function requestOf(value: unknown, kind: "start" | "turn" | "revision") {
  contract(
    value !== null && typeof value === "object" && !Array.isArray(value),
  );
  const r = value as Record<string, unknown>,
    keys = [
      "project_id",
      "runtime_id",
      "action_id",
      "expected_revision",
      ...(kind === "start" ? ["scope_id", "configuration_fingerprint"] : []),
      ...(kind === "turn" ? ["instruction_profile", "task_id"] : []),
    ];
  contract(
    Object.keys(r).length === keys.length &&
      keys.every((k) => Object.hasOwn(r, k)),
  );
  contract(
    [r.project_id, r.runtime_id, r.action_id].every(uuid) &&
      revision(r.expected_revision),
  );
  if (kind === "start")
    contract(
      uuid(r.scope_id) &&
        r.scope_id !== r.runtime_id &&
        fingerprint(r.configuration_fingerprint),
    );
  if (kind === "turn")
    contract(
      r.instruction_profile === "synthetic_task_get/1" && uuid(r.task_id),
    );
  return structuredClone(r) as unknown as
    StartRequest | TurnRequest | RevisionRequest;
}
/**
 * Trusted in-process assembly for the official Codex app-server entry.
 *
 * It reuses W08 permissions, resources and idempotency. It never reports a
 * native session it does not hold, never unlocks on an unknown result, and
 * never sends anything but the fixed synthetic acceptance instruction.
 */
export class CodexRuntimeController {
  private readonly store: Store;
  private readonly launcher: CodexLauncher;
  private readonly now: () => number;
  private readonly owner = randomUUID();
  private readonly owned = new Map<string, Owned>();
  private readonly monitor?: NodeJS.Timeout;
  private readonly turnMs: number;
  private disposed = false;
  constructor(
    store: Store,
    launcher: CodexLauncher,
    options: { now?: () => number; monitorMs?: number; turnMs?: number } = {},
  ) {
    this.store = store;
    this.launcher = launcher;
    this.now = options.now ?? Date.now;
    contract(fingerprint(launcher.fingerprint));
    const interval = options.monitorMs ?? 250;
    contract(Number.isInteger(interval) && interval >= 0 && interval <= 60000);
    const turnMs = options.turnMs ?? 60000;
    contract(Number.isInteger(turnMs) && turnMs >= 0 && turnMs <= 600000);
    this.turnMs = turnMs;
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
    return requireResource<CodexRuntimeData>(
      this.store,
      ctx,
      id,
      "adapter_runtime",
    );
  }
  private replay(ctx: Context, id: string, payload: unknown) {
    const a = this.store.getResource<Action>("codex-runtime-action:" + id);
    if (!a) return;
    if (
      a.kind !== "codex_runtime_action" ||
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
    r: Resource<CodexRuntimeData>,
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
      id: "codex-runtime-action:" + actionId,
      project_id: r.project_id,
      kind: "codex_runtime_action",
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
    const r = requestOf(value, "start") as StartRequest;
    if (this.disposed) throw new AdapterFault("CODEX_CONTROLLER_CLOSED");
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
        throw new AdapterFault("CODEX_CONFIG_CHANGED");
      if (r.expected_revision !== "0" || this.store.getResource(r.runtime_id))
        throw new AdapterFault("REVISION_CONFLICT");
      const instanceId = randomUUID();
      const resource: Resource<CodexRuntimeData> = {
        id: r.runtime_id,
        project_id: r.project_id,
        kind: "adapter_runtime",
        revision: "1",
        domain: scope.domain,
        acl: [ctx.grant.id],
        dependencies: [scope.id],
        data: {
          target: "codex",
          mode: "app_server_thread",
          scope_id: scope.id,
          grant_id: ctx.grant.id,
          controller_id: this.owner,
          instance_id: instanceId,
          configuration_fingerprint: r.configuration_fingerprint,
          client_version: this.launcher.clientVersion,
          source: this.launcher.source,
          state: "starting",
          observed_at: new Date(this.now()).toISOString(),
          initialize: null,
          thread: null,
          thread_sha256: null,
          instruction_profile: null,
          instruction_task_id: null,
          turn: null,
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
        turnTimeouts: 0,
      };
      return accepted;
    });
    if (fresh) {
      this.owned.set(r.runtime_id, fresh);
      fresh.work = this.launch(fresh);
      await fresh.work;
    }
    return receipt;
  }
  private current(entry: Owned) {
    const r = this.store.getResource<CodexRuntimeData>(entry.runtimeId);
    return r?.kind === "adapter_runtime" &&
      r.data.target === "codex" &&
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
    }
  }
  private record(entry: Owned, patch: Partial<CodexRuntimeData>): boolean {
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
      entry.persistenceFault = true;
      entry.fault = "CODEX_PERSISTENCE";
      entry.stopRequested = true;
      entry.handle?.close();
      return false;
    }
  }
  private async launch(entry: Owned) {
    try {
      if (!this.authorized(entry))
        throw new AdapterFault("CODEX_AUTHORIZATION_CHANGED");
      const handle = await this.launcher.launch(() => this.authorized(entry));
      entry.handle = handle;
      void handle.closed
        .then((exit) => {
          const state: CodexState =
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
            fault: "CODEX_TRANSPORT_UNKNOWN",
          });
          entry.finished = true;
        });
      if (!this.authorized(entry))
        this.stop(entry, "CODEX_AUTHORIZATION_CHANGED");
      const initialize = await handle.ready;
      if (handle.status.state === "closed")
        throw new AdapterFault(handle.status.fault ?? "CODEX_DISCONNECTED");
      if (!this.authorized(entry)) {
        this.stop(entry, "CODEX_AUTHORIZATION_CHANGED");
        return;
      }
      // Native thread creation: no platform session id is invented, and an
      // unacknowledged creation stays unknown instead of being retried.
      const thread = await handle.startThread(handle.workDirectory);
      const threadDigest = createHash("sha256").update(thread).digest("hex");
      if (!this.authorized(entry)) {
        this.stop(entry, "CODEX_AUTHORIZATION_CHANGED");
        return;
      }
      if (
        !this.record(entry, {
          state: "ready",
          initialize,
          thread,
          thread_sha256: threadDigest,
        })
      )
        this.stop(entry, "CODEX_PERSISTENCE");
    } catch (error) {
      const code = error instanceof AdapterFault ? error.code : "CODEX_LAUNCH";
      entry.fault ??= code;
      // A timeout may still have created a native thread; that stays unknown.
      const unknown = /_TIMEOUT$/.test(code);
      if (entry.handle) {
        this.record(entry, {
          state: unknown ? "unknown" : "failed",
          fault: code,
        });
        entry.handle.close();
        await entry.handle.closed;
      } else {
        this.record(entry, {
          state: entry.stopRequested
            ? "closed"
            : unknown
              ? "unknown"
              : "failed",
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
    clearTimeout(entry.turnTimer);
    this.record(entry, { state: "closing", fault: entry.fault });
    entry.handle?.close();
  }
  read(token: string, project: string, id: string) {
    contract(uuid(project) && uuid(id));
    const ctx = this.context(token, project),
      r = this.runtime(ctx, id),
      entry = this.owned.get(id);
    let state = r.data.state,
      fault = r.data.fault,
      turnState = r.data.turn?.state ?? "none";
    if (ctx.run.state !== "active" && active(state)) {
      state = "unknown";
      fault = "CODEX_EXECUTION_UNKNOWN";
    }
    if (
      active(state) &&
      (!entry ||
        r.data.controller_id !== this.owner ||
        entry.instanceId !== r.data.instance_id ||
        entry.finished)
    ) {
      state = "unknown";
      fault = "CODEX_OWNER_UNKNOWN";
    }
    if (
      r.data.configuration_fingerprint !== this.launcher.fingerprint &&
      active(r.data.state)
    ) {
      state = "unknown";
      fault = "CODEX_CONFIG_CHANGED";
    }
    if (active(state)) {
      const live = entry?.handle?.status.state;
      // A live turn keeps the transport busy on purpose; anything else must be
      // backed by a reachable handle, never by a stale persisted ready state.
      if (!entry?.handle || (live !== "ready" && live !== "busy")) {
        state = "unknown";
        fault =
          entry?.handle?.status.fault ?? fault ?? "CODEX_TRANSPORT_UNKNOWN";
      }
    }
    if (entry?.persistenceFault) {
      state = "unknown";
      fault = "CODEX_PERSISTENCE";
    }
    // The live native turn projection wins over the persisted copy while this
    // controller holds the handle; a requested turn without a terminal event
    // stays requested and never becomes a completed turn.
    const live = entry?.handle?.statistics;
    if (live && state === "ready" && turnState === "requested")
      turnState =
        live.turn_state === "completed"
          ? "completed"
          : live.turn_state === "failed"
            ? "failed"
            : live.turn_state === "interrupted"
              ? "interrupted"
              : "requested";
    return {
      runtime_id: r.id,
      revision: r.revision,
      target: r.data.target,
      binding_mode: "owned_process" as const,
      session_id: null,
      native_thread_sha256: r.data.thread_sha256,
      state,
      fault,
      instance_id: r.data.instance_id,
      configuration_fingerprint: r.data.configuration_fingerprint,
      client_version: r.data.client_version,
      user_agent: r.data.initialize?.user_agent ?? null,
      platform_family: r.data.initialize?.platform_family ?? null,
      platform_os: r.data.initialize?.platform_os ?? null,
      initialize_schema: r.data.initialize?.schema ?? null,
      instruction_profile: r.data.instruction_profile,
      last_agent_message: live?.last_agent_message ?? null,
      token_usage: live?.token_usage ?? null,
      turn: r.data.turn
        ? {
            id_sha256: r.data.turn.id
              ? createHash("sha256").update(r.data.turn.id).digest("hex")
              : null,
            state: turnState,
          }
        : null,
      statistics: live
        ? {
            requests: live.requests,
            responses: live.responses,
            notifications: live.notifications,
            unknown_notifications: [...live.unknown_notifications],
            refused_server_requests: live.refused_server_requests,
          }
        : null,
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
  async turn(token: string, value: unknown): Promise<Receipt> {
    const r = requestOf(value, "turn") as TurnRequest;
    let entry: Owned | undefined;
    let taskId = "";
    const receipt = this.store.transaction(() => {
      const ctx = this.context(token, r.project_id, true),
        resource = this.runtime(ctx, r.runtime_id);
      const cached = this.replay(ctx, r.action_id, { operation: "turn", ...r });
      if (cached) return cached;
      // The synthetic task is fixed by the trusted grant; a caller cannot widen it.
      if (!ctx.grant.resource_ids.includes(r.task_id))
        fail("NOT_FOUND_OR_DENIED");
      requireResource(this.store, ctx, r.task_id, "task");
      if (resource.revision !== r.expected_revision)
        throw new AdapterFault("REVISION_CONFLICT");
      entry = this.owned.get(r.runtime_id);
      if (
        !entry ||
        resource.data.controller_id !== this.owner ||
        resource.data.instance_id !== entry.instanceId ||
        entry.finished
      )
        throw new AdapterFault("CODEX_OWNER_UNKNOWN");
      if (entry.persistenceFault) throw new AdapterFault("CODEX_PERSISTENCE");
      // A live turn blocks a second one even while its acknowledgement is still
      // in flight, so the state check cannot be the only guard.
      if (resource.data.turn && resource.data.turn.state === "requested")
        throw new AdapterFault("CODEX_BUSY");
      if (resource.data.state !== "ready")
        throw new AdapterFault("CODEX_STATE");
      taskId = r.task_id;
      const updated: Resource<CodexRuntimeData> = {
        ...resource,
        revision: nextRevision(resource.revision),
        data: {
          ...resource.data,
          state: "turning",
          instruction_profile: "synthetic_task_get/1",
          instruction_task_id: r.task_id,
          turn: { id: null, state: "requested" },
          observed_at: new Date(this.now()).toISOString(),
        },
      };
      this.store.putResource(updated);
      return this.receipt(ctx, updated, r.action_id, {
        operation: "turn",
        ...r,
      });
    });
    const owned = entry;
    if (owned) this.execute(owned, taskId);
    return receipt;
  }
  /** One fire-and-forget turn per accepted action; unknown results are never retried. */
  private execute(entry: Owned, taskId: string) {
    void (async () => {
      const handle = entry.handle;
      const current = () => this.current(entry);
      const thread = current()?.data.thread;
      if (!handle || !thread) {
        this.record(entry, {
          state: "unknown",
          fault: "CODEX_OWNER_UNKNOWN",
          turn: { id: null, state: "unknown" },
        });
        return;
      }
      try {
        const nativeTurn = await handle.startTurn(
          thread,
          syntheticInstruction(taskId),
        );
        this.record(entry, {
          state: "ready",
          turn: { id: nativeTurn, state: "requested" },
        });
      } catch (error) {
        const code = error instanceof AdapterFault ? error.code : "CODEX_TURN";
        // A rejected request never ran; a timeout may have started a native turn.
        this.record(entry, {
          state: "ready",
          fault: code,
          turn: {
            id: null,
            state: /_TIMEOUT$/.test(code) ? "unknown" : "failed",
          },
        });
        return;
      }
      this.awaitTurn(entry);
    })();
  }
  private awaitTurn(entry: Owned) {
    const deadline = this.now() + this.turnMs;
    clearTimeout(entry.turnTimer);
    const poll = () => {
      const handle = entry.handle;
      if (!handle || entry.finished || entry.stopRequested) return;
      const live = handle.statistics.turn_state;
      if (live === "completed" || live === "failed" || live === "interrupted") {
        const state: CodexTurnState =
          live === "failed"
            ? "failed"
            : live === "interrupted"
              ? "interrupted"
              : "completed";
        this.record(entry, {
          state: "ready",
          turn: this.turnPatch(entry, state),
        });
        return;
      }
      if (this.now() >= deadline) {
        entry.turnTimeouts++;
        this.record(entry, {
          state: "ready",
          fault: "CODEX_TURN_UNKNOWN",
          turn: this.turnPatch(entry, "unknown"),
        });
        return;
      }
      entry.turnTimer = setTimeout(poll, 25).unref();
    };
    poll();
  }
  private turnPatch(entry: Owned, state: CodexTurnState) {
    const r = this.current(entry);
    return { id: r?.data.turn?.id ?? null, state };
  }
  async interrupt(token: string, value: unknown): Promise<Receipt> {
    const r = requestOf(value, "revision") as RevisionRequest;
    let entry: Owned | undefined;
    let native: { thread: string; turn: string } | null = null;
    const receipt = this.store.transaction(() => {
      const ctx = this.context(token, r.project_id, true),
        resource = this.runtime(ctx, r.runtime_id);
      const cached = this.replay(ctx, r.action_id, {
        operation: "interrupt",
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
        throw new AdapterFault("CODEX_OWNER_UNKNOWN");
      const turn = resource.data.turn;
      if (!resource.data.thread || !turn || turn.state !== "requested")
        throw new AdapterFault("CODEX_STATE");
      if (!turn.id) throw new AdapterFault("CODEX_TURN_UNKNOWN");
      native = { thread: resource.data.thread, turn: turn.id };
      const updated: Resource<CodexRuntimeData> = {
        ...resource,
        revision: nextRevision(resource.revision),
        data: {
          ...resource.data,
          state: "ready",
          turn: { id: turn.id, state: "requested" },
          observed_at: new Date(this.now()).toISOString(),
        },
      };
      this.store.putResource(updated);
      return this.receipt(ctx, updated, r.action_id, {
        operation: "interrupt",
        ...r,
      });
    });
    const owned = entry,
      target = native as { thread: string; turn: string } | null;
    if (owned && target)
      void owned.handle
        ?.interruptTurn(target.thread, target.turn)
        .then(() => {
          clearTimeout(owned.turnTimer);
          this.record(owned, {
            state: "ready",
            turn: { id: target.turn, state: "interrupted" },
          });
        })
        .catch((error: unknown) => {
          const code =
            error instanceof AdapterFault ? error.code : "CODEX_INTERRUPT";
          // An unacknowledged interrupt proves nothing about the native turn.
          this.record(owned, {
            state: "ready",
            fault: code,
            turn: { id: target.turn, state: "unknown" },
          });
        });
    return receipt;
  }
  async close(token: string, value: unknown): Promise<Receipt> {
    const r = requestOf(value, "revision") as RevisionRequest;
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
        throw new AdapterFault("CODEX_OWNER_UNKNOWN");
      if (entry.persistenceFault) throw new AdapterFault("CODEX_PERSISTENCE");
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
      clearTimeout(entry.turnTimer);
      entry.handle?.close();
      await entry.work;
      if (entry.handle) await entry.handle.closed;
    }
    return receipt;
  }
  /** Explicit maintenance, independent of progress reads; never starts or retries. */
  reconcileAuthorization() {
    for (const entry of this.owned.values())
      if (!entry.finished && !entry.stopRequested && !this.authorized(entry))
        this.stop(entry, "CODEX_AUTHORIZATION_CHANGED");
  }
  async dispose() {
    this.disposed = true;
    clearInterval(this.monitor);
    for (const entry of this.owned.values()) {
      clearTimeout(entry.turnTimer);
      this.stop(entry, "CODEX_CONTROLLER_CLOSED");
    }
    await Promise.all(
      [...this.owned.values()].map(async (entry) => {
        await entry.work;
        if (entry.handle) await entry.handle.closed;
      }),
    );
  }
}
