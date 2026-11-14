import { authenticate, requireActive, requireResource } from "./auth.ts";
import {
  canonical,
  nextRevision,
  type Context,
  type Resource,
  type TaskData,
} from "./domain.ts";
import { fail } from "./errors.ts";
import { Store, digest } from "./store.ts";
import { uuid, revision } from "./adapter-contract.ts";
import type { Ref } from "../../contracts/src/index.ts";
export class DependencyFault extends Error {}
export interface SnapshotEntry {
  ref: Ref;
  source_commit: string;
  tree_digest: string;
  content_digest: string;
}
export interface InputSnapshot {
  task_id: string;
  roots: Ref[];
  entries: SnapshotEntry[];
  created_at: string;
}
interface CaptureRequest {
  project_id: string;
  snapshot_id: string;
  action_id: string;
  task_ref: Ref;
  inputs: Ref[];
}
function demand(ok: unknown, code = "DEPENDENCY_CONTRACT"): asserts ok {
  if (!ok) throw new DependencyFault(code);
}
function isRef(v: unknown): v is Ref {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const r = v as Ref;
  return (
    Object.keys(r).length === 2 &&
    uuid(r.id) &&
    revision(r.revision) &&
    r.revision !== "0"
  );
}
function validate(v: unknown): CaptureRequest {
  demand(v !== null && typeof v === "object" && !Array.isArray(v));
  const r = v as CaptureRequest;
  demand(
    Object.keys(r).length === 5 &&
      [r.project_id, r.snapshot_id, r.action_id].every(uuid) &&
      isRef(r.task_ref) &&
      Array.isArray(r.inputs) &&
      r.inputs.length > 0 &&
      r.inputs.length <= 128 &&
      r.inputs.every(isRef) &&
      new Set(r.inputs.map((r) => r.id)).size === r.inputs.length,
  );
  return structuredClone(r);
}
function accepted(r: Resource) {
  return (
    r.data.validity === "valid" &&
    r.data.readiness === "ready" &&
    r.data.review_state === "approved" &&
    [r.data.base_commit, r.data.source_commit, r.data.tree_digest].every(
      (v) => typeof v === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(v),
    )
  );
}
function collect(
  store: Store,
  ctx: Context,
  taskId: string,
  roots: Ref[],
): SnapshotEntry[] {
  const done = new Map<string, SnapshotEntry>(),
    active = new Set<string>();
  function visit(ref: Ref) {
    if (active.has(ref.id)) throw new DependencyFault("DEPENDENCY_CYCLE");
    const existing = done.get(ref.id);
    if (existing) {
      demand(existing.ref.revision === ref.revision, "DEPENDENCY_STALE");
      return;
    }
    demand(done.size + active.size < 256, "DEPENDENCY_LIMIT");
    const r = requireResource(store, ctx, ref.id, "changeset");
    demand(r.revision === ref.revision && accepted(r), "DEPENDENCY_STALE");
    demand(r.data.producer_task_id !== taskId, "DEPENDENCY_CYCLE");
    const upstream = r.data.upstream_refs ?? [];
    demand(
      Array.isArray(upstream) &&
        upstream.length <= 128 &&
        upstream.every(isRef),
    );
    demand(r.dependencies.every((id) => upstream.some((ref) => ref.id === id)));
    active.add(ref.id);
    for (const parent of upstream) visit(parent);
    active.delete(ref.id);
    done.set(ref.id, {
      ref: { id: r.id, revision: r.revision },
      source_commit: r.data.source_commit as string,
      tree_digest: r.data.tree_digest as string,
      content_digest: digest(
        canonical({ data: r.data, dependencies: r.dependencies }),
      ),
    });
  }
  for (const r of roots) visit(r);
  return [...done.values()].sort((a, b) => a.ref.id.localeCompare(b.ref.id));
}
export function snapshotCurrent(
  store: Store,
  ctx: Context,
  snapshot: Resource<InputSnapshot>,
): boolean {
  for (const e of snapshot.data.entries) {
    const r = requireResource(store, ctx, e.ref.id, "changeset");
    if (
      r.revision !== e.ref.revision ||
      !accepted(r) ||
      digest(canonical({ data: r.data, dependencies: r.dependencies })) !==
        e.content_digest
    )
      return false;
  }
  return true;
}
export function assertTaskInputsCurrent(
  store: Store,
  ctx: Context,
  taskId: string,
): void {
  const active = new Set<string>(),
    done = new Set<string>();
  function visit(id: string) {
    if (active.has(id) || active.size + done.size >= 256) fail("PLAN_STALE");
    if (done.has(id)) return;
    active.add(id);
    const task = requireResource<TaskData>(store, ctx, id, "task");
    if (!task.data.inputs_valid) fail("PLAN_STALE");
    if (task.data.input_snapshot_ref) {
      const ref = task.data.input_snapshot_ref;
      const snapshot = requireResource<InputSnapshot>(
        store,
        ctx,
        ref.id,
        "input_snapshot",
      );
      if (
        snapshot.data.task_id !== id ||
        snapshot.revision !== ref.revision ||
        !snapshotCurrent(store, ctx, snapshot)
      )
        fail("PLAN_STALE");
    }
    for (const parentId of task.data.prerequisite_ids ?? []) {
      const parent = requireResource<TaskData>(store, ctx, parentId, "task");
      if (parent.data.status !== "completed") fail("PLAN_STALE");
      if (parent.data.candidate_ref) {
        const candidate = requireResource(
          store,
          ctx,
          parent.data.candidate_ref.id,
          "changeset",
        );
        if (
          candidate.revision !== parent.data.candidate_ref.revision ||
          !accepted(candidate)
        )
          fail("PLAN_STALE");
      }
      visit(parentId);
    }
    active.delete(id);
    done.add(id);
  }
  visit(taskId);
}
export function taskInputRefs(
  store: Store,
  ctx: Context,
  taskId: string,
): Ref[] {
  assertTaskInputsCurrent(store, ctx, taskId);
  const task = requireResource<TaskData>(store, ctx, taskId, "task");
  return task.data.input_snapshot_ref
    ? requireResource<InputSnapshot>(
        store,
        ctx,
        task.data.input_snapshot_ref.id,
        "input_snapshot",
      ).data.entries.map((e) => e.ref)
    : [];
}
export class DependencyService {
  private readonly store: Store;
  private readonly now: () => number;
  constructor(store: Store, now: () => number = Date.now) {
    this.store = store;
    this.now = now;
  }
  setPrerequisites(token: string, value: unknown) {
    demand(
      value !== null && typeof value === "object" && !Array.isArray(value),
    );
    const q = value as {
      project_id: string;
      action_id: string;
      task_ref: Ref;
      prerequisite_ids: string[];
    };
    demand(
      Object.keys(q).length === 4 &&
        uuid(q.project_id) &&
        uuid(q.action_id) &&
        isRef(q.task_ref) &&
        Array.isArray(q.prerequisite_ids) &&
        q.prerequisite_ids.length <= 128 &&
        q.prerequisite_ids.every(uuid) &&
        new Set(q.prerequisite_ids).size === q.prerequisite_ids.length,
    );
    return this.store.transaction(() => {
      const ctx = authenticate(
        this.store,
        token,
        q.project_id,
        "dependency_capture",
        this.now(),
      );
      requireActive(ctx);
      const task = requireResource<TaskData>(
        this.store,
        ctx,
        q.task_ref.id,
        "task",
      );
      for (const id of q.prerequisite_ids)
        requireResource(this.store, ctx, id, "task");
      const actionId = "task-dependency-action:" + q.action_id;
      const saved = this.store.getResource<{
        grant_id: string;
        fingerprint: string;
        receipt: Ref;
      }>(actionId);
      if (saved) {
        if (
          saved.project_id !== q.project_id ||
          saved.kind !== "dependency_action" ||
          saved.domain !== ctx.grant.domain ||
          saved.data.grant_id !== ctx.grant.id
        )
          fail("NOT_FOUND_OR_DENIED");
        demand(
          saved.data.fingerprint === digest(canonical(q)),
          "ACTION_CONFLICT",
        );
        return saved.data.receipt;
      }
      demand(
        task.revision === q.task_ref.revision &&
          ["draft", "queued"].includes(task.data.status),
        "DEPENDENCY_TASK_STALE",
      );
      const active = new Set([task.id]),
        done = new Set<string>();
      const visit = (id: string) => {
        demand(!active.has(id), "DEPENDENCY_CYCLE");
        if (done.has(id)) return;
        demand(active.size + done.size < 256, "DEPENDENCY_LIMIT");
        active.add(id);
        const parent = requireResource<TaskData>(this.store, ctx, id, "task");
        for (const next of parent.data.prerequisite_ids ?? []) visit(next);
        active.delete(id);
        done.add(id);
      };
      for (const id of q.prerequisite_ids) visit(id);
      // Retain provenance ACL dependencies even when an ordering edge is removed.
      task.dependencies = [
        ...new Set([...task.dependencies, ...q.prerequisite_ids]),
      ];
      task.data.prerequisite_ids = [...q.prerequisite_ids];
      task.revision = nextRevision(task.revision);
      this.store.putResource(task);
      const receipt = { id: task.id, revision: task.revision };
      this.store.putResource({
        id: actionId,
        project_id: q.project_id,
        kind: "dependency_action",
        revision: "1",
        domain: task.domain,
        acl: [ctx.grant.id],
        dependencies: [task.id, ...q.prerequisite_ids],
        data: {
          grant_id: ctx.grant.id,
          fingerprint: digest(canonical(q)),
          receipt,
        },
      });
      return receipt;
    });
  }
  capture(token: string, value: unknown) {
    const q = validate(value);
    return this.store.transaction(() => {
      const ctx = authenticate(
        this.store,
        token,
        q.project_id,
        "dependency_capture",
        this.now(),
      );
      requireActive(ctx);
      const task = requireResource<TaskData>(
        this.store,
        ctx,
        q.task_ref.id,
        "task",
      );
      if (
        !ctx.grant.resource_ids.includes(q.snapshot_id) ||
        !ctx.policy.resource_ids.includes(q.snapshot_id)
      )
        fail("NOT_FOUND_OR_DENIED");
      for (const input of q.inputs)
        requireResource(this.store, ctx, input.id, "changeset");
      const actionId = "dependency-action:" + q.action_id;
      const saved = this.store.getResource<{
        grant_id: string;
        fingerprint: string;
        receipt: Ref;
      }>(actionId);
      if (saved) {
        if (
          saved.project_id !== q.project_id ||
          saved.kind !== "dependency_action" ||
          saved.domain !== ctx.grant.domain ||
          saved.data.grant_id !== ctx.grant.id
        )
          fail("NOT_FOUND_OR_DENIED");
        requireResource(
          this.store,
          ctx,
          saved.data.receipt.id,
          "input_snapshot",
        );
        demand(
          saved.data.fingerprint === digest(canonical(q)),
          "ACTION_CONFLICT",
        );
        return saved.data.receipt;
      }
      demand(
        task.revision === q.task_ref.revision &&
          ["draft", "queued"].includes(task.data.status),
        "DEPENDENCY_TASK_STALE",
      );
      demand(!this.store.getResource(q.snapshot_id), "DEPENDENCY_ID_CONFLICT");
      const entries = collect(this.store, ctx, task.id, q.inputs);
      const snapshot: Resource<InputSnapshot> = {
        id: q.snapshot_id,
        project_id: q.project_id,
        kind: "input_snapshot",
        revision: "1",
        domain: task.domain,
        acl: [ctx.grant.id],
        dependencies: [task.id, ...entries.map((e) => e.ref.id)],
        data: {
          task_id: task.id,
          roots: q.inputs,
          entries,
          created_at: new Date(this.now()).toISOString(),
        },
      };
      this.store.putResource(snapshot);
      task.data.input_snapshot_ref = {
        id: snapshot.id,
        revision: snapshot.revision,
      };
      task.data.inputs_valid = true;
      task.revision = nextRevision(task.revision);
      this.store.putResource(task);
      const receipt = { id: snapshot.id, revision: snapshot.revision };
      this.store.putResource({
        id: actionId,
        project_id: q.project_id,
        kind: "dependency_action",
        revision: "1",
        domain: task.domain,
        acl: [ctx.grant.id],
        dependencies: [task.id, snapshot.id],
        data: {
          grant_id: ctx.grant.id,
          fingerprint: digest(canonical(q)),
          receipt,
        },
      });
      return receipt;
    });
  }
  read(token: string, projectId: string, snapshotId: string) {
    const ctx = authenticate(
      this.store,
      token,
      projectId,
      "dependency_read",
      this.now(),
    );
    const r = requireResource<InputSnapshot>(
      this.store,
      ctx,
      snapshotId,
      "input_snapshot",
    );
    return {
      id: r.id,
      revision: r.revision,
      ...r.data,
      validity: snapshotCurrent(this.store, ctx, r)
        ? ("valid" as const)
        : ("stale" as const),
    };
  }
}
