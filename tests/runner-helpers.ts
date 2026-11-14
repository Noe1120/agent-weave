import { brokerFixture } from "./broker-helpers.ts";
import { id } from "./helpers.ts";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RunnerController } from "../packages/service/src/runner.ts";
import type { RunnerProfile } from "../packages/service/src/runner-host.ts";
import type { RunnerInput } from "../packages/service/src/runner-protocol.ts";
export const pinned = (path: string) => ({
  path: resolve(path),
  sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
});
export function runnerFixture() {
  const f = brokerFixture();
  f.p.actions.push("runner_start", "runner_read", "runner_stop");
  f.g.actions.push("runner_start");
  f.s.putPolicy(f.p);
  f.s.updateGrant(f.g);
  const observer = {
    ...f.g,
    id: id(),
    run_id: id(),
    actions: ["runner_read", "runner_stop"] as const,
  };
  f.s.putRun({
    id: observer.run_id,
    project_id: f.ids.project,
    epoch: "1",
    native_binding: observer.native_binding,
    state: "active",
  });
  const observerToken = f.s.issueGrant({
    ...observer,
    actions: [...observer.actions],
  });
  for (const rid of f.g.resource_ids) {
    const r = f.s.getResource(rid);
    if (r) {
      r.acl.push(observer.id);
      f.s.putResource(r);
    }
  }
  const profile: RunnerProfile = {
    dotnet: pinned(".tools/dotnet/dotnet.exe"),
    node: pinned(process.execPath),
    host: pinned("artifacts/runner-host/Team.RunnerHost.dll"),
    deps: pinned("artifacts/runner-host/Team.RunnerHost.deps.json"),
    runtime: pinned("artifacts/runner-host/Team.RunnerHost.runtimeconfig.json"),
    worker: pinned("tests/fixtures/runner-worker.mjs"),
    scratch_parent: f.tmp.directory,
  };
  const runner = new RunnerController(f.s, f.broker, profile, f.now);
  const request = (scenario: RunnerInput["scenario"] = "success") => ({
    execution_id: id(),
    claim: { ...f.request },
    adapter: "development_fixture" as const,
    input: { scenario },
    timeout_ms: 10000,
  });
  return {
    ...f,
    observer,
    observerToken,
    profile,
    runner,
    request,
    async dispose() {
      await runner.shutdown();
      f.dispose();
    },
  };
}
export async function until<T>(
  read: () => T,
  ready: (v: T) => boolean,
  ms = 10000,
): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = read();
    if (ready(v)) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("Timed out waiting for observed runner state");
}
export const terminal = (s: string) =>
  ["succeeded", "stopped", "failed", "unknown"].includes(s);
