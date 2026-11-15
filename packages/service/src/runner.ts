import { createHash } from "node:crypto";
import type { Store } from "./store.ts";
import type { DevelopmentBroker } from "./broker.ts";
import { canonical } from "./domain.ts";
import type { Context } from "./domain.ts";
import { authenticate, requireActive, requireResource } from "./auth.ts";
import { RunnerHost, verifyProfile } from "./runner-host.ts";
import type {
  RunnerProfile,
  HostEvent,
  HostResult,
  ExitEvidence,
} from "./runner-host.ts";
import {
  demandRunner,
  validateStart,
  parseWorkerFrame,
  RunnerFault,
} from "./runner-protocol.ts";
import type { WorkerFrame } from "./runner-protocol.ts";
import { ServiceFault, TransportFault } from "./errors.ts";
import { BrokerFault } from "./broker-paths.ts";
type State =
  | "starting"
  | "running"
  | "stopping"
  | "succeeded"
  | "stopped"
  | "failed"
  | "unknown";
interface Execution {
  execution_id: string;
  project_id: string;
  grant_id: string;
  run_id: string;
  scope_id: string;
  claim_id: string;
  task_id: string;
  candidate_id: string;
  profile_digest: string;
  binding_mode: "owned_process";
  adapter: "development_fixture";
  state: State;
  reason: string | null;
  worker_pid: number | null;
  host_pid: number | null;
  seq: number;
  complete: boolean;
  exit: ExitEvidence | null;
  started_at: number;
  ended_at: number | null;
  input_count: number;
  stderr_bytes: number;
}
interface Live {
  frames: number;
  bytes: number;
  token: string;
  host: RunnerHost;
  timeout: NodeJS.Timeout;
  watch: NodeJS.Timeout;
  kill: NodeJS.Timeout | null;
  done: Promise<void>;
}
interface Scope {
  task_id: string;
  candidate_id: string;
}
export const runnerTerminal = (state: string) =>
  ["succeeded", "stopped", "failed", "unknown"].includes(state);
function reason(e: unknown) {
  return e instanceof RunnerFault ||
    e instanceof BrokerFault ||
    e instanceof ServiceFault ||
    e instanceof TransportFault
    ? e.message
    : "RUNNER_INTERNAL_FAILURE";
}
function actionId(id: string, seq: number) {
  const h = createHash("sha256").update(`runner:${id}:${seq}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
// Trusted local composition only. Not HTTP/MCP exposed. No actual-client adapter enabled.
export class RunnerController {
  readonly store: Store;
  readonly broker: DevelopmentBroker;
  readonly now: () => number;
  private readonly profile: RunnerProfile;
  private readonly live = new Map<string, Live>();
  constructor(
    store: Store,
    broker: DevelopmentBroker,
    profile: RunnerProfile,
    now: () => number = Date.now,
  ) {
    this.store = store;
    this.broker = broker;
    this.profile = structuredClone(profile);
    this.now = now;
  }
  private get(id: string): Execution {
    const row = this.store.db
      .prepare("SELECT data FROM runner_executions WHERE id=?")
      .get(id);
    demandRunner(row, "NOT_FOUND_OR_DENIED");
    return JSON.parse(String(row.data)) as Execution;
  }
  private save(e: Execution) {
    this.store.db
      .prepare("UPDATE runner_executions SET state=?,data=? WHERE id=?")
      .run(e.state, JSON.stringify(e), e.execution_id);
  }
  private scope(c: Context, scopeId: string) {
    const scope = requireResource<Scope>(
      this.store,
      c,
      scopeId,
      "broker_scope",
    );
    requireResource(this.store, c, scope.data.task_id, "task");
    requireResource(this.store, c, scope.data.candidate_id, "changeset");
    return scope;
  }
  private observer(token: string, project: string, id: string, stop = false) {
    const c = authenticate(
      this.store,
      token,
      project,
      stop ? "runner_stop" : "runner_read",
      this.now(),
    );
    if (stop) requireActive(c);
    const e = this.get(id);
    demandRunner(e.project_id === project, "NOT_FOUND_OR_DENIED");
    const scope = this.scope(c, e.scope_id);
    demandRunner(
      scope.data.task_id === e.task_id &&
        scope.data.candidate_id === e.candidate_id,
      "NOT_FOUND_OR_DENIED",
    );
    return e;
  }
  start(token: string, value: unknown) {
    const q = validateStart(value);
    const c = authenticate(
      this.store,
      token,
      q.claim.project_id,
      "runner_start",
      this.now(),
    );
    requireActive(c);
    const scope = this.scope(c, q.claim.scope_id);
    const profileDigest = verifyProfile(this.profile),
      fingerprint = canonical(q);
    const old = this.store.db
      .prepare("SELECT fingerprint FROM runner_executions WHERE id=?")
      .get(q.execution_id);
    if (old) {
      const e = this.get(q.execution_id);
      demandRunner(e.grant_id === c.grant.id, "NOT_FOUND_OR_DENIED");
      demandRunner(
        old.fingerprint === fingerprint && e.profile_digest === profileDigest,
        "PAYLOAD_CONFLICT",
      );
      return { execution_id: e.execution_id, state: e.state };
    }
    const e: Execution = {
      execution_id: q.execution_id,
      project_id: q.claim.project_id,
      grant_id: c.grant.id,
      run_id: c.run.id,
      scope_id: q.claim.scope_id,
      claim_id: q.claim.claim_id,
      task_id: scope.data.task_id,
      candidate_id: scope.data.candidate_id,
      profile_digest: profileDigest,
      binding_mode: "owned_process",
      adapter: q.adapter,
      state: "starting",
      reason: null,
      worker_pid: null,
      host_pid: null,
      seq: 0,
      complete: false,
      exit: null,
      started_at: this.now(),
      ended_at: null,
      input_count: 0,
      stderr_bytes: 0,
    };
    this.store.transaction(() => {
      demandRunner(
        !this.store.db
          .prepare("SELECT id FROM runner_executions WHERE run_id=?")
          .get(c.run.id),
        "RUN_ALREADY_BOUND",
      );
      demandRunner(
        !this.store.db
          .prepare("SELECT id FROM runner_executions WHERE claim_id=?")
          .get(e.claim_id),
        "CLAIM_ALREADY_BOUND",
      );
      this.store.db
        .prepare("INSERT INTO runner_executions VALUES(?,?,?,?,?,?,?,?,?)")
        .run(
          e.execution_id,
          e.project_id,
          e.run_id,
          e.grant_id,
          e.claim_id,
          e.scope_id,
          e.state,
          fingerprint,
          JSON.stringify(e),
        );
    });
    try {
      this.broker.claim(token, q.claim);
    } catch (error) {
      e.state = "failed";
      e.reason = reason(error);
      e.ended_at = this.now();
      this.save(e);
      throw error;
    }
    try {
      // Recheck after claiming: a changed file cannot be dispatched merely because admission once passed.
      verifyProfile(this.profile);
      const host = new RunnerHost(this.profile, q.input, (event) =>
        this.event(e.execution_id, event),
      );
      e.host_pid = host.process.pid ?? null;
      const live: Live = {
        frames: 0,
        bytes: 0,
        token,
        host,
        timeout: setTimeout(
          () => this.beginStop(e.execution_id, "TIMEOUT"),
          q.timeout_ms,
        ),
        watch: setInterval(() => this.watch(e.execution_id), 100),
        kill: null,
        done: Promise.resolve(),
      };
      this.live.set(e.execution_id, live);
      live.done = host.closed.then((result) => {
        try {
          this.exited(e.execution_id, result);
        } finally {
          clearTimeout(live.timeout);
          clearInterval(live.watch);
          if (live.kill) clearTimeout(live.kill);
          this.live.delete(e.execution_id);
        }
      });
      // Track the handle and its exit promise before any fallible persistence after spawn.
      this.save(e);
    } catch (error) {
      if (this.live.has(e.execution_id))
        this.beginStop(e.execution_id, reason(error));
      else {
        this.revoke(e);
        e.state = "unknown";
        e.reason = reason(error);
        this.save(e);
      }
      throw error;
    }
    return { execution_id: e.execution_id, state: e.state };
  }
  private event(id: string, event: HostEvent) {
    const e = this.get(id);
    if (runnerTerminal(e.state)) return;
    if (event.kind === "fault") {
      this.beginStop(id, event.code);
      return;
    }
    if (event.kind === "started") {
      e.worker_pid = event.pid;
      e.input_count++;
      if (e.state === "starting") e.state = "running";
      this.save(e);
      return;
    }
    if (event.kind === "diagnostic") {
      e.stderr_bytes = event.stderr_bytes;
      this.save(e);
      return;
    }
    if (e.state !== "running") return;
    try {
      const live = this.live.get(id)!;
      live.frames++;
      live.bytes += Buffer.byteLength(event.line);
      demandRunner(
        live.frames <= 256 && live.bytes <= 1048576,
        "PROTOCOL_OUTPUT_LIMIT",
      );
      const c = authenticate(
        this.store,
        live.token,
        e.project_id,
        "runner_start",
        this.now(),
      );
      requireActive(c);
      this.scope(c, e.scope_id);
      const f = parseWorkerFrame(event.line),
        fingerprint = canonical(f);
      const old = this.store.db
        .prepare(
          "SELECT fingerprint,ack FROM runner_events WHERE execution_id=? AND seq=?",
        )
        .get(id, f.seq);
      if (old) {
        demandRunner(
          old.fingerprint === fingerprint,
          "PROTOCOL_REPLAY_CONFLICT",
        );
        live.host.send(JSON.parse(String(old.ack)));
        e.input_count++;
        this.save(e);
        return;
      }
      demandRunner(!e.complete && f.seq === e.seq + 1, "PROTOCOL_SEQUENCE");
      let receipt: unknown = null;
      if (f.kind === "patch")
        receipt = this.broker.write(live.token, {
          project_id: e.project_id,
          claim_id: e.claim_id,
          action_id: actionId(id, f.seq),
          edits: f.edits,
        });
      const ack = { kind: "ack", seq: f.seq, receipt };
      this.store.transaction(() => {
        e.seq = f.seq;
        e.complete = f.kind === "complete";
        this.store.db
          .prepare("INSERT INTO runner_events VALUES(?,?,?,?,?)")
          .run(id, f.seq, fingerprint, JSON.stringify(f), JSON.stringify(ack));
        e.input_count++;
        this.save(e);
      });
      live.host.send(ack);
    } catch (error) {
      this.beginStop(id, reason(error));
    }
  }
  private revoke(e: Execution) {
    this.store.transaction(() => {
      const g = this.store.getGrant(e.grant_id);
      if (g) {
        g.state = "revoked";
        this.store.updateGrant(g);
      }
    });
    this.broker.reconcileLiveness();
  }
  private beginStop(id: string, why: string) {
    const e = this.get(id);
    if (runnerTerminal(e.state) || e.state === "stopping") return;
    e.state = "stopping";
    e.reason = why;
    this.save(e);
    this.revoke(e);
    const live = this.live.get(id);
    if (live) {
      live.host.stop();
      live.kill = setTimeout(() => live.host.abort(), 6000);
    } else {
      e.state = "unknown";
      this.save(e);
    }
  }
  private watch(id: string) {
    const e = this.get(id);
    if (e.state === "stopping" || runnerTerminal(e.state)) return;
    try {
      const c = authenticate(
        this.store,
        this.live.get(id)!.token,
        e.project_id,
        "runner_start",
        this.now(),
      );
      requireActive(c);
      this.scope(c, e.scope_id);
      this.broker.reconcileLiveness();
      const claim = this.store.db
        .prepare("SELECT state FROM broker_claims WHERE id=?")
        .get(e.claim_id);
      demandRunner(claim?.state === "active", "CLAIM_QUARANTINED");
    } catch (error) {
      this.beginStop(id, reason(error));
    }
  }
  private exited(id: string, result: HostResult) {
    const e = this.get(id);
    e.exit = result.evidence;
    e.ended_at = this.now();
    if (!result.evidence) {
      this.revoke(e);
      e.state = "unknown";
      e.reason = result.fault ?? "HOST_EXIT_UNCONFIRMED";
      const run = this.store.getRun(e.run_id);
      if (run) {
        run.state = "unknown";
        this.store.putRun(run);
      }
    } else if (e.state === "stopping") {
      // A host stopping itself can close input before its independent output
      // reports the actual failure and Job-empty proof. Keep that root cause.
      if (
        e.reason === "HOST_INPUT_CLOSED" &&
        result.evidence.reason &&
        !["CONTROLLER_STOP", "CONTROLLER_EOF"].includes(result.evidence.reason)
      )
        e.reason = result.evidence.reason;
      e.state =
        e.reason === "USER_STOP" || e.reason === "CONTROLLER_SHUTDOWN"
          ? "stopped"
          : "failed";
    } else if (
      result.fault ||
      result.evidence.reason ||
      result.evidence.exit_code !== 0 ||
      !e.complete
    ) {
      this.revoke(e);
      e.state = "failed";
      e.reason =
        result.fault ??
        result.evidence.reason ??
        (result.evidence.exit_code !== 0
          ? "WORKER_EXIT_NONZERO"
          : "PROTOCOL_NO_COMPLETE");
    } else {
      try {
        this.broker.finish(
          this.live.get(id)!.token,
          e.project_id,
          e.claim_id,
          () => {
            e.state = "succeeded";
            this.save(e);
          },
        );
        return;
      } catch (error) {
        this.revoke(e);
        e.state = "failed";
        e.reason = reason(error);
      }
    }
    this.save(e);
  }
  read(token: string, project: string, id: string) {
    const e = this.observer(token, project, id);
    const events = this.store.db
      .prepare(
        "SELECT frame FROM runner_events WHERE execution_id=? ORDER BY seq",
      )
      .all(id)
      .map((r) => JSON.parse(String(r.frame)) as WorkerFrame);
    return { ...e, progress_source: "worker_reported" as const, events };
  }
  stop(token: string, project: string, id: string) {
    this.observer(token, project, id, true);
    this.beginStop(id, "USER_STOP");
    return this.read(token, project, id);
  }
  recoverOrphans() {
    demandRunner(this.live.size === 0, "CONTROLLER_ALREADY_ACTIVE");
    const rows = this.store.db
      .prepare(
        "SELECT id FROM runner_executions WHERE state IN ('starting','running','stopping')",
      )
      .all();
    for (const row of rows) {
      const e = this.get(String(row.id));
      this.revoke(e);
      const run = this.store.getRun(e.run_id);
      if (run) {
        run.state = "unknown";
        this.store.putRun(run);
      }
      e.state = "unknown";
      e.reason = "CONTROLLER_LOST";
      e.ended_at = this.now();
      this.save(e);
    }
    return rows.length;
  }
  async shutdown() {
    for (const id of this.live.keys())
      this.beginStop(id, "CONTROLLER_SHUTDOWN");
    await Promise.all([...this.live.values()].map((l) => l.done));
  }
}
