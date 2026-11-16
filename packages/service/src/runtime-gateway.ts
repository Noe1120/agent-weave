import { authenticate, requireActive, requireResource } from "./auth.ts";
import { contract, uuid } from "./adapter-contract.ts";
import type {
  CodexRuntimeController,
  CodexRuntimeData,
} from "./codex-runtime.ts";
import type { DshRuntimeController, DshRuntimeData } from "./dsh-runtime.ts";
import { fail, TransportFault } from "./errors.ts";
import type { Store } from "./store.ts";

type RuntimeData = CodexRuntimeData | DshRuntimeData;
export interface RuntimeControllers {
  codex?: CodexRuntimeController;
  deepseek_harness?: DshRuntimeController;
}

/** Safe service projection, never a launcher factory or a native history reader. */
export class RuntimeGateway {
  private readonly store: Store;
  private readonly controllers: RuntimeControllers;
  private readonly now: () => number;
  constructor(
    store: Store,
    controllers: RuntimeControllers = {},
    now: () => number = Date.now,
  ) {
    this.store = store;
    this.controllers = controllers;
    this.now = now;
  }

  read(token: string, project: string, id: string) {
    contract(uuid(project) && uuid(id));
    const ctx = authenticate(
      this.store,
      token,
      project,
      "adapter_read",
      this.now(),
    );
    const r = requireResource<RuntimeData>(
      this.store,
      ctx,
      id,
      "adapter_runtime",
    );
    // Cross-grant ACL changes must not lend another member's runtime identity.
    if (r.data.grant_id !== ctx.grant.id) fail("NOT_FOUND_OR_DENIED");
    const target = r.data.target;
    if (target !== "codex" && target !== "deepseek_harness")
      fail("NOT_FOUND_OR_DENIED");
    const controller = this.controllers[target];
    if (r.data.target === "codex" && r.data.instruction_task_id)
      requireResource(this.store, ctx, r.data.instruction_task_id, "task");
    const live = controller?.read(token, project, id);
    const active = ["starting", "ready", "turning", "closing"].includes(
      r.data.state,
    );
    return {
      runtime_id: r.id,
      project_id: project,
      member_id: ctx.grant.member_id,
      run_id: ctx.grant.run_id,
      revision: r.revision,
      target,
      binding_mode: "owned_process" as const,
      session_id: null,
      state: live?.state ?? (active ? "unknown" : r.data.state),
      fault:
        live?.fault ??
        (!live && active ? "RUNTIME_OWNER_UNAVAILABLE" : r.data.fault),
      configuration_fingerprint: r.data.configuration_fingerprint,
      client_version: r.data.client_version,
      observation_source: r.data.source,
      observed_at: r.data.observed_at,
      qualification: "UNVERIFIED" as const,
      execution_stop_proven: false,
      exit_observed: r.data.exit?.exit_observed === true,
      task_id: target === "codex" ? r.data.instruction_task_id : null,
      native_thread_sha256: target === "codex" ? r.data.thread_sha256 : null,
      turn_state: target === "codex" ? (r.data.turn?.state ?? "none") : "none",
    };
  }

  async command(
    token: string,
    target: string,
    operation: string,
    value: unknown,
  ) {
    contract(
      value !== null && typeof value === "object" && !Array.isArray(value),
    );
    const request = value as Record<string, unknown>;
    contract(uuid(request.project_id) && uuid(request.runtime_id));
    const ctx = authenticate(
      this.store,
      token,
      request.project_id as string,
      "runtime_control",
      this.now(),
    );
    requireActive(ctx);
    if (target !== "codex" && target !== "deepseek_harness")
      fail("NOT_FOUND_OR_DENIED");
    if (operation !== "start" && operation !== "close")
      fail("NOT_FOUND_OR_DENIED");
    const existing = this.store.getResource<RuntimeData>(
      request.runtime_id as string,
    );
    if (existing) {
      requireResource(this.store, ctx, existing.id, "adapter_runtime");
      if (
        existing.data.target !== target ||
        existing.data.grant_id !== ctx.grant.id
      )
        fail("NOT_FOUND_OR_DENIED");
    }
    const controller = this.controllers[target];
    if (!controller) throw new TransportFault(503, "RUNTIME_NOT_CONFIGURED");
    return controller[operation](token, value);
  }
}
