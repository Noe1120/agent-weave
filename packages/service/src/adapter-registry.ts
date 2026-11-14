import { authenticate, requireActive, requireResource } from "./auth.ts";
import {
  canonical,
  nextRevision,
  type Context,
  type Resource,
} from "./domain.ts";
import { fail } from "./errors.ts";
import { Store, digest } from "./store.ts";
import {
  AdapterFault,
  capabilities,
  contract,
  revision,
  uuid,
  validateAdapterRegistration,
  evaluateCapability,
  type AdapterRegistration,
  type Capability,
} from "./adapter-contract.ts";
export interface AdapterBinding {
  registration: AdapterRegistration;
  grant_id: string;
  member_id: string;
  run_id: string;
  fingerprint: string;
  state: "registered" | "invalidated" | "detached";
  connection_ref: string | null;
  observation: {
    source: "none" | "development_fixture";
    fingerprint: string;
    observed_at: string | null;
    supported: "supported" | "unsupported" | "unverified";
  };
}
interface AdapterReceipt {
  binding_id: string;
  revision: string;
  state: AdapterBinding["state"];
}
interface Audit {
  grant_id: string;
  fingerprint: string;
  receipt: AdapterReceipt;
}
export class AdapterRegistry {
  private readonly store: Store;
  private readonly now: () => number;
  constructor(store: Store, now: () => number = Date.now) {
    this.store = store;
    this.now = now;
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
  private binding(ctx: Context, id: string) {
    return requireResource<AdapterBinding>(
      this.store,
      ctx,
      id,
      "adapter_binding",
    );
  }
  private replay(
    ctx: Context,
    id: string,
    payload: unknown,
  ): AdapterReceipt | undefined {
    const a = this.store.getResource<Audit>("adapter-action:" + id);
    if (!a) return;
    if (
      a.kind !== "adapter_registration_action" ||
      a.project_id !== ctx.grant.project_id ||
      a.domain !== ctx.grant.domain ||
      a.data.grant_id !== ctx.grant.id
    )
      fail("NOT_FOUND_OR_DENIED");
    if (a.data.fingerprint !== digest(canonical(payload)))
      throw new AdapterFault("ACTION_CONFLICT");
    return a.data.receipt;
  }
  private save(
    ctx: Context,
    scope: Resource,
    id: string,
    payload: unknown,
    binding: Resource<AdapterBinding>,
  ) {
    const receipt = {
      binding_id: binding.id,
      revision: binding.revision,
      state: binding.data.state,
    };
    this.store.putResource(binding);
    this.store.putResource<Audit>({
      id: "adapter-action:" + id,
      project_id: ctx.grant.project_id,
      kind: "adapter_registration_action",
      revision: "1",
      domain: scope.domain,
      acl: [ctx.grant.id],
      dependencies: [scope.id, binding.id],
      data: {
        grant_id: ctx.grant.id,
        fingerprint: digest(canonical(payload)),
        receipt,
      },
    });
    return receipt;
  }
  register(token: string, value: unknown): AdapterReceipt {
    const request = validateAdapterRegistration(value);
    return this.store.transaction(() => {
      const ctx = this.context(token, request.project_id, true);
      const scope = requireResource(this.store, ctx, request.scope_id, "scope");
      if (
        !ctx.grant.resource_ids.includes(request.binding_id) ||
        !ctx.policy.resource_ids.includes(request.binding_id)
      )
        fail("NOT_FOUND_OR_DENIED");
      const existing = this.store.getResource<AdapterBinding>(
        request.binding_id,
      );
      if (existing) {
        this.binding(ctx, request.binding_id);
        if (
          existing.data.registration.scope_id !== scope.id ||
          existing.data.grant_id !== ctx.grant.id ||
          existing.data.registration.target !== request.target ||
          existing.data.registration.binding_mode !== request.binding_mode
        )
          fail("NOT_FOUND_OR_DENIED");
      }
      const payload = { operation: "register", request };
      const replay = this.replay(ctx, request.action_id, payload);
      if (replay) return replay;
      if ((existing?.revision ?? "0") !== request.expected_revision)
        throw new AdapterFault("REVISION_CONFLICT");
      const { action_id: _, expected_revision: __, ...configuration } = request;
      const current = digest(canonical(configuration));
      const data: AdapterBinding = {
        registration: request,
        grant_id: ctx.grant.id,
        member_id: ctx.grant.member_id,
        run_id: ctx.grant.run_id,
        fingerprint: current,
        state: "registered",
        connection_ref: null,
        observation: existing?.data.observation ?? {
          source: "none",
          fingerprint: current,
          observed_at: null,
          supported: "unverified",
        },
      };
      return this.save(ctx, scope, request.action_id, payload, {
        id: request.binding_id,
        project_id: request.project_id,
        kind: "adapter_binding",
        revision: nextRevision(request.expected_revision),
        domain: scope.domain,
        acl: [ctx.grant.id],
        dependencies: [scope.id],
        data,
      });
    });
  }
  read(token: string, projectId: string, bindingId: string) {
    const ctx = this.context(token, projectId);
    const r = this.binding(ctx, bindingId);
    const data = r.data;
    const decision = (c: Capability) => {
      const declared = data.registration.capabilities.includes(c);
      const facts = {
        supported: declared
          ? data.observation.supported
          : ("unsupported" as const),
        available: false,
        allowed: data.state === "registered",
        qualification: "UNVERIFIED" as const,
        observedFingerprint: data.observation.fingerprint,
        currentFingerprint: data.fingerprint,
        evidenceIds: [] as string[],
      };
      return { ...facts, ...evaluateCapability(facts) };
    };
    const decisions = {
      progress: decision("progress"),
      history: decision("history"),
      send_message: decision("send_message"),
      reply_wait: decision("reply_wait"),
      approve: decision("approve"),
      interrupt: decision("interrupt"),
      detach: decision("detach"),
    };
    return {
      binding_id: r.id,
      revision: r.revision,
      state: data.state,
      target: data.registration.target,
      binding_mode: data.registration.binding_mode,
      observed_at: data.observation.observed_at,
      observation_source: data.observation.source,
      capabilities: decisions,
    };
  }
  private transition(
    token: string,
    projectId: string,
    bindingId: string,
    expectedRevision: string,
    actionId: string,
    state: "invalidated" | "detached",
  ): AdapterReceipt {
    contract(
      uuid(projectId) &&
        uuid(bindingId) &&
        uuid(actionId) &&
        revision(expectedRevision),
    );
    return this.store.transaction(() => {
      const ctx = this.context(token, projectId, true);
      const binding = this.binding(ctx, bindingId);
      if (binding.data.grant_id !== ctx.grant.id) fail("NOT_FOUND_OR_DENIED");
      const scope = requireResource(
        this.store,
        ctx,
        binding.data.registration.scope_id,
        "scope",
      );
      if (
        state === "detached" &&
        binding.data.registration.binding_mode !== "attached_session"
      )
        throw new AdapterFault("CAPABILITY_UNAVAILABLE");
      const payload = {
        operation: state,
        projectId,
        bindingId,
        expectedRevision,
        actionId,
      };
      const replay = this.replay(ctx, actionId, payload);
      if (replay) return replay;
      if (binding.revision !== expectedRevision)
        throw new AdapterFault("REVISION_CONFLICT");
      return this.save(ctx, scope, actionId, payload, {
        ...binding,
        revision: nextRevision(binding.revision),
        data: { ...binding.data, state, connection_ref: null },
      });
    });
  }
  invalidate(
    token: string,
    projectId: string,
    bindingId: string,
    expectedRevision: string,
    actionId: string,
  ) {
    return this.transition(
      token,
      projectId,
      bindingId,
      expectedRevision,
      actionId,
      "invalidated",
    );
  }
  detach(
    token: string,
    projectId: string,
    bindingId: string,
    expectedRevision: string,
    actionId: string,
  ) {
    return this.transition(
      token,
      projectId,
      bindingId,
      expectedRevision,
      actionId,
      "detached",
    );
  }
  operation(
    token: string,
    projectId: string,
    bindingId: string,
    operation: "send_message" | "reply_wait" | "approve" | "interrupt",
  ): never {
    this.read(token, projectId, bindingId);
    contract(
      ["send_message", "reply_wait", "approve", "interrupt"].includes(
        operation,
      ),
    );
    throw new AdapterFault("CAPABILITY_UNAVAILABLE");
  }
}
