import { fixture, id, ref } from "./helpers.ts";
import type { Resource, Action } from "../packages/service/src/domain.ts";
import { DependencyService } from "../packages/service/src/dependencies.ts";
export function provision(
  f: ReturnType<typeof fixture>,
  ids: string[],
  actions: Action[],
) {
  f.p.actions.push(...actions);
  f.g.actions = [...f.p.actions];
  f.p.resource_ids.push(...ids);
  f.g.resource_ids.push(...ids);
  f.s.putPolicy(f.p);
  f.s.updateGrant(f.g);
}
export function dependencyFixture(f = fixture()) {
  const snapshot = id(),
    upstream = id(),
    base = id();
  provision(
    f,
    [snapshot, upstream, base],
    ["dependency_capture", "dependency_read", "knowledge_read"],
  );
  const changeset = (
    rid: string,
    upstream_refs: ReturnType<typeof ref>[] = [],
  ): Resource => ({
    id: rid,
    project_id: f.ids.project,
    kind: "changeset",
    revision: "1",
    domain: f.g.domain,
    acl: [f.g.id],
    dependencies: upstream_refs.map((r) => r.id),
    data: {
      readiness: "ready",
      review_state: "approved",
      validity: "valid",
      base_commit: "a".repeat(40),
      source_commit: "b".repeat(40),
      tree_digest: "c".repeat(40),
      upstream_refs,
    },
  });
  f.s.putResource(changeset(base));
  f.s.putResource(changeset(upstream, [ref(base)]));
  const service = new DependencyService(f.s, f.now);
  const request = () => ({
    project_id: f.ids.project,
    snapshot_id: snapshot,
    action_id: id(),
    task_ref: ref(f.ids.task),
    inputs: [ref(upstream)],
  });
  return {
    ...f,
    snapshot,
    upstream,
    base,
    changeset,
    dependencies: service,
    request,
  };
}
