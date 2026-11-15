import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync, mkdtempSync } from "node:fs";
import { isAbsolute, join, dirname, resolve } from "node:path";
import { canonical } from "./domain.ts";
import { demandRunner, RunnerFault } from "./runner-protocol.ts";
import type { RunnerInput } from "./runner-protocol.ts";
// Constructor configuration is a trusted development-only composition root, never request input.
export interface PinnedFile {
  path: string;
  sha256: string;
}
export interface RunnerProfile {
  dotnet: PinnedFile;
  node: PinnedFile;
  host: PinnedFile;
  deps: PinnedFile;
  runtime: PinnedFile;
  worker: PinnedFile;
  scratch_parent: string;
}
export function verifyProfile(profile: RunnerProfile): string {
  for (const p of [
    profile.dotnet,
    profile.node,
    profile.host,
    profile.deps,
    profile.runtime,
    profile.worker,
  ]) {
    demandRunner(
      isAbsolute(p.path) && /^[a-f\d]{64}$/.test(p.sha256),
      "INVALID_PROFILE",
    );
    try {
      demandRunner(
        statSync(p.path).isFile() &&
          createHash("sha256").update(readFileSync(p.path)).digest("hex") ===
            p.sha256,
        "PROFILE_DRIFT",
      );
    } catch (e) {
      if (e instanceof RunnerFault) throw e;
      throw new RunnerFault("PROFILE_UNAVAILABLE");
    }
  }
  demandRunner(
    resolve(profile.deps.path) ===
      join(dirname(profile.host.path), "Team.RunnerHost.deps.json") &&
      resolve(profile.runtime.path) ===
        join(
          dirname(profile.host.path),
          "Team.RunnerHost.runtimeconfig.json",
        ) &&
      profile.host.path.endsWith("Team.RunnerHost.dll"),
    "INVALID_PROFILE",
  );
  demandRunner(
    isAbsolute(profile.scratch_parent) &&
      statSync(profile.scratch_parent).isDirectory(),
    "INVALID_PROFILE",
  );
  return createHash("sha256").update(canonical(profile)).digest("hex");
}
export type HostEvent =
  | { kind: "started"; pid: number; job_assigned: true }
  | { kind: "worker"; line: string }
  | { kind: "diagnostic"; stderr_bytes: number }
  | { kind: "fault"; code: string };
export interface ExitEvidence {
  exit_code: number;
  job_empty: true;
  reason: string | null;
}
export interface HostResult {
  evidence: ExitEvidence | null;
  fault: string | null;
}
export class RunnerHost {
  readonly process;
  readonly closed: Promise<HostResult>;
  private stopped = false;
  constructor(
    profile: RunnerProfile,
    input: RunnerInput,
    onEvent: (event: HostEvent) => void,
  ) {
    const scratch = mkdtempSync(join(profile.scratch_parent, "runner-"));
    this.process = spawn(profile.dotnet.path, [profile.host.path], {
      windowsHide: true,
      shell: false,
      cwd: scratch,
      env: {
        SystemRoot: process.env.SystemRoot ?? "",
        TEMP: scratch,
        TMP: scratch,
        DOTNET_EnableDiagnostics: "0",
        DOTNET_CLI_TELEMETRY_OPTOUT: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const p = this.process;
    let buffer = Buffer.alloc(0),
      total = 0,
      lines = 0,
      evidence: ExitEvidence | null = null,
      fault: string | null = null,
      invalidOutput = false,
      started = false,
      finished = false;
    const fail = (code: string, invalidatesOutput = true) => {
      invalidOutput ||= invalidatesOutput;
      if (fault) return;
      fault = code;
      onEvent({ kind: "fault", code });
      this.stop();
    };
    this.closed = new Promise((resolveClosed) => {
      p.on("error", () => fail("HOST_SPAWN_FAILED"));
      p.stdin.on("error", () => {
        if (!this.stopped) fail("HOST_INPUT_CLOSED", false);
      });
      p.stderr.on("data", () => fail("HOST_UNEXPECTED_STDERR"));
      p.stdout.on("data", (chunk: Buffer) => {
        if (invalidOutput) return;
        total += chunk.length;
        if (total > 8 * 1024 * 1024) {
          fail("HOST_OUTPUT_LIMIT");
          return;
        }
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > 512 * 1024) {
          fail("HOST_FRAME_LIMIT");
          return;
        }
        let end;
        while ((end = buffer.indexOf(10)) >= 0) {
          const line = buffer.subarray(0, end);
          buffer = buffer.subarray(end + 1);
          lines++;
          if (lines > 520) {
            fail("HOST_OUTPUT_LIMIT");
            return;
          }
          let e: Record<string, unknown>;
          try {
            e = JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(line),
            ) as Record<string, unknown>;
          } catch {
            fail("HOST_PROTOCOL");
            return;
          }
          if (!e || typeof e !== "object" || finished) {
            fail("HOST_PROTOCOL");
            return;
          }
          if (
            e.kind === "started" &&
            !started &&
            Number.isSafeInteger(e.pid) &&
            Number(e.pid) > 0 &&
            e.job_assigned === true
          ) {
            started = true;
            onEvent(e as HostEvent);
          } else if (
            e.kind === "worker" &&
            started &&
            typeof e.line === "string"
          ) {
            onEvent(e as HostEvent);
          } else if (
            e.kind === "diagnostic" &&
            started &&
            Number.isSafeInteger(e.stderr_bytes) &&
            Number(e.stderr_bytes) <= 16384
          ) {
            onEvent(e as HostEvent);
          } else if (
            e.kind === "exited" &&
            started &&
            e.job_empty === true &&
            Number.isInteger(e.exit_code) &&
            (e.reason === null || typeof e.reason === "string")
          ) {
            finished = true;
            evidence = {
              exit_code: Number(e.exit_code),
              job_empty: true,
              reason: e.reason as string | null,
            };
          } else if (e.kind === "fault" && typeof e.code === "string") {
            fail(e.code);
            return;
          } else {
            fail("HOST_PROTOCOL");
            return;
          }
          if (invalidOutput) return;
        }
      });
      p.once("close", (code) => {
        if (buffer.length) {
          invalidOutput = true;
          fault ??= "HOST_PARTIAL_FRAME";
        }
        resolveClosed({
          evidence: code === 0 && !invalidOutput ? evidence : null,
          fault:
            fault ?? (code !== 0 || !evidence ? "HOST_EXIT_UNCONFIRMED" : null),
        });
      });
    });
    this.send({
      node: profile.node.path,
      worker: profile.worker.path,
      cwd: scratch,
      input,
    });
  }
  send(message: unknown) {
    if (!this.process.stdin.destroyed && !this.stopped)
      this.process.stdin.write(JSON.stringify(message) + "\n");
  }
  stop() {
    if (this.stopped) return;
    this.send({ kind: "stop" });
    this.stopped = true;
    this.process.stdin.end();
  }
  // Only this newly created host is owned; no persisted PID is ever used for killing.
  abort() {
    this.stopped = true;
    this.process.kill();
  }
}
