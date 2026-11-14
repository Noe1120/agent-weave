import { fixture, id } from "./helpers.ts";
import { tempWorkspace } from "./temp.ts";
import { join } from "node:path";
import { DevelopmentBroker } from "../packages/service/src/broker.ts";
export const gitExe = process.env.BROKER_GIT ?? "git";
export function brokerFixture() {
  const tmp = tempWorkspace(),
    f = fixture(tmp.db);
  f.ids.scope = id();
  f.p.resource_ids.push(f.ids.scope);
  f.g.resource_ids.push(f.ids.scope);
  f.p.actions.push("broker_write", "broker_read");
  f.g.actions = [...f.p.actions];
  f.s.putPolicy(f.p);
  f.s.updateGrant(f.g);
  f.resource("scope", "broker_scope", {
    task_id: f.ids.task,
    candidate_id: f.ids.candidate,
    paths: ["src/main.txt", "src/extra.txt"],
  });
  f.resource("task", "task", {
    status: "queued",
    candidate_ref: null,
    inputs_valid: true,
    acceptance_ref: { id: f.ids.acceptance, revision: "1" },
  });
  f.resource("candidate", "changeset", {
    readiness: "wip",
    review_state: "pending",
    validity: "valid",
  });
  const broker = new DevelopmentBroker(f.s, gitExe, f.now);
  const root = join(tmp.directory, "repo");
  const workspace = id();
  broker.createWorkspace(f.ids.project, workspace, root);
  const request = {
    project_id: f.ids.project,
    workspace_id: workspace,
    scope_id: f.ids.scope,
    claim_id: id(),
    expected_task_revision: "1",
    lease_ms: 60000,
  };
  return {
    ...f,
    tmp,
    root,
    workspace,
    broker,
    request,
    dispose() {
      f.close();
      tmp.dispose();
    },
  };
}
