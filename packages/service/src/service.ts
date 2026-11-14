import { randomUUID } from "node:crypto";
import type { Store } from "./store.ts";
import {
  validateCore,
  validateRequest,
  validateResource,
  resourceFields,
} from "../../contracts/src/index.ts";
import type {
  CoreRequest,
  CoreError,
  CoreResult,
  Receipt,
  ResourceKind,
} from "../../contracts/src/index.ts";
import type { Context, Resource, TaskData, InputData } from "./domain.ts";
import { businessPayload, canonical, nextRevision } from "./domain.ts";
import {
  authenticate,
  requireActive,
  requireResource,
  requireRun,
} from "./auth.ts";
import { ServiceFault, TransportFault, fail, errorEnvelope } from "./errors.ts";
import { applyPlan, controlPlan, progress } from "./plans.ts";
import type { Effect } from "./plans.ts";
import { boundWait, registerWait, consumeWait, reconcile } from "./waits.ts";
export class CoreService {
  readonly store: Store;
  readonly now: () => number;
  constructor(store: Store, now: () => number = Date.now) {
    this.store = store;
    this.now = now;
  }
  execute(token: string, request: unknown): CoreResult | CoreError {
    if (!validateRequest(request)) throw new TransportFault(400, "BAD_REQUEST");
    try {
      return this.store.transaction(() => {
        const now = this.now(),
          c = authenticate(
            this.store,
            token,
            request.project_id,
            request.kind,
            now,
          );
        let data: CoreResult["data"];
        switch (request.kind) {
          case "read_action":
            data = this.readAction(c, request.action_id);
            break;
          case "read_wait":
            data = boundWait(this.store, c, request.wait_id).record;
            break;
          case "get_plan_progress":
            data = progress(this.store, c, request.plan_execution_id, now);
            break;
          case "register_wait":
            data = registerWait(this.store, c, request, now);
            break;
          default: {
            const old = this.store.getAction(request.action_id);
            if (old) {
              this.readAction(c, request.action_id);
              if (old.fingerprint !== businessPayload(request))
                fail("ACTION_PAYLOAD_CONFLICT");
              data = old.receipt;
              break;
            }
            let effect: Effect;
            switch (request.kind) {
              case "apply_plan":
                effect = applyPlan(this.store, c, request, now);
                break;
              case "control_plan":
                effect = controlPlan(this.store, c, request, now);
                break;
              case "consume_wait":
                effect = consumeWait(this.store, c, request, now);
                break;
              case "continuation_reply":
                effect = this.reply(c, request, now);
                break;
            }
            data = {
              action_id: request.action_id,
              receipt_ref: { id: randomUUID(), revision: "1" },
              effect_state: effect.state,
              observed_at: new Date(now).toISOString(),
            };
            this.store.saveAction({
              action_id: request.action_id,
              project_id: request.project_id,
              grant_id: c.grant.id,
              operation: request.kind,
              fingerprint: businessPayload(request),
              request,
              receipt: data,
              resource_ids: effect.resources,
            });
          }
        }
        const result = {
          contract_version: "core/1.0",
          kind: "service_result",
          request_id: request.request_id,
          project_id: request.project_id,
          operation: request.kind,
          data,
        };
        if (!validateCore(result) || result.kind !== "service_result")
          throw new Error("Response contract violation");
        return result;
      });
    } catch (e) {
      if (e instanceof ServiceFault) return errorEnvelope(request, e.code);
      throw e;
    }
  }
  private readAction(c: Context, id: string): Receipt {
    const a = this.store.getAction(id);
    if (!a || a.project_id !== c.grant.project_id || a.grant_id !== c.grant.id)
      fail("NOT_FOUND_OR_DENIED");
    if (
      !c.grant.actions.includes(a.operation) ||
      !c.policy.actions.includes(a.operation)
    )
      fail("NOT_FOUND_OR_DENIED");
    for (const resource of a.resource_ids)
      requireResource(this.store, c, resource);
    return a.receipt;
  }
  private reply(
    c: Context,
    q: Extract<CoreRequest, { kind: "continuation_reply" }>,
    now: number,
  ): Effect {
    requireActive(c);
    requireRun(c, q.run_id, q.run_epoch);
    const input = requireResource<InputData>(
        this.store,
        c,
        q.input_request_id,
        "input_request",
      ),
      d = input.data;
    const answer = requireResource(this.store, c, q.answer_ref.id, "answer");
    const workflow = requireResource<{ run_id: string; run_epoch: string }>(
      this.store,
      c,
      d.workflow_id,
      "workflow",
    );
    requireRun(c, workflow.data.run_id, workflow.data.run_epoch);
    if (
      d.grant_id !== c.grant.id ||
      d.run_id !== q.run_id ||
      d.run_epoch !== q.run_epoch ||
      d.native_binding !== c.grant.native_binding ||
      !d.expected_responders.includes(c.grant.member_id)
    )
      fail("NOT_FOUND_OR_DENIED");
    if (
      d.kind !== "clarification" ||
      !d.native_wait_verified ||
      d.state !== "pending" ||
      input.revision !== q.expected_input_revision ||
      answer.revision !== q.answer_ref.revision ||
      !Number.isFinite(Date.parse(d.expires_at)) ||
      Date.parse(d.expires_at) <= now
    )
      fail("INPUT_REQUEST_STALE");
    if (
      canonical([...answer.acl].sort()) !== canonical([...d.audience].sort()) ||
      canonical([...input.acl].sort()) !== canonical([...d.audience].sort())
    )
      fail("NOT_FOUND_OR_DENIED");
    input.data.state = "answered";
    input.data.answer_ref = q.answer_ref;
    input.revision = nextRevision(input.revision);
    this.store.putResource(input);
    this.store.inbox(
      q.project_id,
      c.grant.id,
      d.workflow_id,
      input.id,
      q.action_id,
      { input_request_id: input.id, answer_ref: q.answer_ref },
    );
    return {
      resources: [input.id, answer.id, workflow.id],
      state: "committed",
    };
  }
  readResource(
    token: string,
    project: string,
    kind: ResourceKind,
    id: string,
  ): unknown {
    try {
      return this.store.transaction(() => {
        const c = authenticate(
          this.store,
          token,
          project,
          "read_resource",
          this.now(),
        );
        const r = requireResource(this.store, c, id, kind);
        let raw = r.data;
        if (kind === "grant") {
          if (id !== c.grant.id) fail("NOT_FOUND_OR_DENIED");
          raw = { ...c.grant };
        }
        const data = Object.fromEntries(
          resourceFields[kind].map((k) => [k, raw[k]]),
        );
        const response = {
          contract_version: "resource/0.1",
          kind: "resource_result",
          project_id: project,
          resource_type: kind,
          ref: { id: r.id, revision: r.revision },
          data,
        };
        if (!validateResource(response))
          throw new Error("Resource response contract violation");
        return response;
      });
    } catch (e) {
      if (e instanceof ServiceFault)
        throw new TransportFault(404, "NOT_FOUND_OR_DENIED");
      throw e;
    }
  }
  // Trusted in-process integration boundary, not a public mutator or native-client adapter.
  updateTask(task: Resource<TaskData>): void {
    this.store.transaction(() => {
      const old = this.store.getResource<TaskData>(task.id);
      if (
        !old ||
        old.kind !== "task" ||
        old.project_id !== task.project_id ||
        task.kind !== "task" ||
        BigInt(task.revision) !== BigInt(old.revision) + 1n
      )
        throw new Error("Task update must advance exactly one revision");
      this.store.putResource(task);
      reconcile(this.store, task.id, this.now());
    });
  }
  reconcileWaits(taskId: string): void {
    this.store.transaction(() => reconcile(this.store, taskId, this.now()));
  }
}
