import { fixture, id } from "./helpers.ts";
import {
  AdapterRegistry,
  type AdapterBinding,
} from "../packages/service/src/adapter-registry.ts";
import type { AdapterRegistration } from "../packages/service/src/adapter-contract.ts";
export function adapterFixture(filename = ":memory:") {
  const f = fixture(filename);
  const binding = id();
  f.p.actions.push("adapter_configure", "adapter_read");
  f.g.actions = [...f.p.actions];
  f.p.resource_ids.push(binding);
  f.g.resource_ids.push(binding);
  f.s.putPolicy(f.p);
  f.s.updateGrant(f.g);
  const registry = new AdapterRegistry(f.s, f.now);
  const request = (
    patch: Partial<AdapterRegistration> = {},
  ): AdapterRegistration => ({
    project_id: f.ids.project,
    binding_id: binding,
    scope_id: f.ids.scope,
    action_id: id(),
    expected_revision: "0",
    target: "codex",
    binding_mode: "attached_session",
    client_version: "fixture-1",
    protocol_version: "fixture-1",
    instance_id: "synthetic-instance",
    session_id: "synthetic-session",
    configuration_fingerprint: "a".repeat(64),
    capabilities: ["progress", "detach", "interrupt"],
    ...patch,
  });
  const observe = () => {
    const r = f.s.getResource<AdapterBinding>(binding)!;
    r.data.observation = {
      source: "development_fixture",
      fingerprint: r.data.fingerprint,
      observed_at: new Date(f.now()).toISOString(),
      supported: "supported",
    };
    f.s.putResource(r);
  };
  return { ...f, binding, registry, request, observe };
}
