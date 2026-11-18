import { canonical, nextRevision, type Resource } from "./domain.ts";
import { fingerprint, uuid } from "./adapter-contract.ts";
import { reject } from "./workspace-auth.ts";
import { ConnectionRegistry } from "./connection-registry.ts";
import type { WorkspaceService } from "./workspace-service.ts";
import type { CodexRuntimeData } from "./codex-runtime.ts";

export interface TaskProfile {
  project_id: string;
  task_id: string;
  route: string;
  model: string;
}
interface Approval extends TaskProfile {
  runtime_id: string;
  connection_id: string;
  target: "codex";
  configuration_fingerprint: string;
  soft_tokens: number;
  expires_at: string;
}
interface RecordData {
  instance_id?: string;
  request: Approval;
  state: "approved" | "consumed" | "revoked";
  task_revision: string;
}
const kind = "owner_task_authorization";
function fields(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    !keys.every((k) => Object.hasOwn(value, k))
  )
    reject(400, "INVALID_REQUEST");
  return value as Record<string, unknown>;
}
/** An owner decision, never an execution grant or proof that a process stopped. */
export class OwnerTaskAuthorizations {
  private readonly w: WorkspaceService;
  constructor(w: WorkspaceService) {
    this.w = w;
  }
  private load(runtime: string) {
    return this.w.store.getResource<RecordData>("owner-task:" + runtime);
  }
  /** Called inside the controller's synchronous start transaction, before spawn. */
  claim(
    runtime: string,
    instanceId: string,
    project: string,
    member: string,
    fp: string,
    profile: TaskProfile | undefined,
  ) {
    const r = this.load(runtime);
    if (
      !r ||
      !profile ||
      r.project_id !== project ||
      this.view(r).state !== "approved"
    )
      reject(404, "NOT_FOUND_OR_DENIED");
    const q = r.data.request;
    if (
      q.configuration_fingerprint !== fp ||
      q.project_id !== profile.project_id ||
      q.task_id !== profile.task_id ||
      q.route !== profile.route ||
      q.model !== profile.model ||
      new ConnectionRegistry(this.w).registered(q.connection_id)?.member_id !==
        member
    )
      reject(404, "NOT_FOUND_OR_DENIED");
    r.data.state = "consumed";
    r.data.instance_id = instanceId;
    r.revision = nextRevision(r.revision);
    this.w.store.putResource(r);
    return q;
  }
  active(runtime: string) {
    const r = this.load(runtime);
    return !!r && this.view(r).state === "consumed";
  }
  private view(r: Resource<RecordData>) {
    const q = r.data.request,
      registration = new ConnectionRegistry(this.w).registered(q.connection_id),
      task = this.w.store.getResource(q.task_id);
    const state =
      r.data.state === "revoked"
        ? "revoked"
        : Date.parse(q.expires_at) <= this.w.now()
          ? "expired"
          : !registration ||
              registration.project_id !== r.project_id ||
              registration.configuration_fingerprint !==
                q.configuration_fingerprint ||
              registration.target !== q.target ||
              task?.kind !== "task" ||
              task.project_id !== r.project_id ||
              task.revision !== r.data.task_revision
            ? "invalidated"
            : r.data.state;
    return { ...q, state };
  }
  read(owner: string, project: string, runtime: string) {
    this.w.auth.authorize(owner);
    const r = this.load(runtime);
    if (!r || r.project_id !== project) reject(404, "NOT_FOUND_OR_DENIED");
    const row = r.data.instance_id
      ? this.w.store.getResource<CodexRuntimeData>(runtime)
      : undefined;
    const d = row?.data;
    // Persisted active states cannot establish liveness after restart. Never expose native output.
    const execution =
      row?.kind === "adapter_runtime" &&
      row.project_id === project &&
      d?.instance_id === r.data.instance_id &&
      d &&
      d.target === "codex"
        ? {
            state: ["closed", "failed", "disconnected"].includes(d.state)
              ? d.state
              : "unknown",
            turn_state:
              d.turn?.state === "requested"
                ? "unknown"
                : (d.turn?.state ?? "none"),
            tokens:
              d.exit?.statistics.turn?.generation === d.turn?.generation
                ? (d.exit?.statistics.turn?.token_usage?.total ?? null)
                : null,
            exit_observed: d.exit?.exit_observed === true,
            fault: d.fault,
          }
        : null;
    return { ...this.view(r), execution };
  }
  approve(owner: string, csrf: string, value: unknown) {
    this.w.auth.authorize(owner, csrf);
    const q = fields(value, [
      "runtime_id",
      "connection_id",
      "project_id",
      "task_id",
      "target",
      "configuration_fingerprint",
      "soft_tokens",
      "expires_at",
      "route",
      "model",
    ]);
    if (
      !uuid(q.runtime_id) ||
      !uuid(q.connection_id) ||
      !uuid(q.project_id) ||
      !uuid(q.task_id) ||
      q.target !== "codex" ||
      !fingerprint(q.configuration_fingerprint) ||
      typeof q.soft_tokens !== "number" ||
      !Number.isSafeInteger(q.soft_tokens) ||
      q.soft_tokens < 1 ||
      q.soft_tokens > 30000 ||
      typeof q.expires_at !== "string" ||
      !Number.isFinite(Date.parse(q.expires_at)) ||
      new Date(q.expires_at).toISOString() !== q.expires_at ||
      typeof q.route !== "string" ||
      !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}(?:\/[a-zA-Z0-9_/-]{0,64})?$/.test(
        q.route,
      ) ||
      Number(q.route.split(":")[2]!.split("/")[0]) > 65535 ||
      typeof q.model !== "string" ||
      !/^[A-Za-z0-9_.-]{1,128}$/.test(q.model)
    )
      reject(400, "INVALID_REQUEST");
    const request = q as unknown as Approval;
    return this.w.store.transaction(() => {
      const old = this.load(request.runtime_id);
      if (old) {
        if (old.project_id !== request.project_id)
          reject(404, "NOT_FOUND_OR_DENIED");
        if (canonical(request) !== canonical(old.data.request))
          reject(409, "ACTION_PAYLOAD_CONFLICT");
        return this.view(old);
      }
      const c = new ConnectionRegistry(this.w).registered(
          request.connection_id,
        ),
        task = this.w.store.getResource(request.task_id);
      if (
        !c ||
        c.project_id !== request.project_id ||
        c.target !== request.target ||
        c.configuration_fingerprint !== request.configuration_fingerprint ||
        task?.kind !== "task" ||
        task.project_id !== request.project_id
      )
        reject(404, "NOT_FOUND_OR_DENIED");
      if (
        Date.parse(request.expires_at) <= this.w.now() ||
        Date.parse(request.expires_at) >
          Math.min(this.w.now() + 300000, Date.parse(c.expires_at)) ||
        this.w.store.getResource(request.runtime_id)
      )
        reject(409, "AUTHORIZATION_NOT_AVAILABLE");
      const r: Resource<RecordData> = {
        id: "owner-task:" + request.runtime_id,
        project_id: request.project_id,
        kind,
        revision: "1",
        domain: task.domain,
        acl: [],
        dependencies: [],
        data: { request, state: "approved", task_revision: task.revision },
      };
      this.w.store.putResource(r);
      return this.view(r);
    });
  }
  revoke(owner: string, csrf: string, value: unknown) {
    this.w.auth.authorize(owner, csrf);
    const q = fields(value, ["runtime_id", "project_id"]);
    if (!uuid(q.runtime_id) || !uuid(q.project_id))
      reject(400, "INVALID_REQUEST");
    const id = q.runtime_id;
    return this.w.store.transaction(() => {
      const r = this.load(id);
      if (!r || r.project_id !== q.project_id)
        reject(404, "NOT_FOUND_OR_DENIED");
      if (r.data.state !== "revoked") {
        r.data.state = "revoked";
        r.revision = nextRevision(r.revision);
        this.w.store.putResource(r);
      }
      return this.view(r);
    });
  }
}
