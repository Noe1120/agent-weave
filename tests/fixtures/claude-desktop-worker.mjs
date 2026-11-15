// This fixture starts only after RunnerHost assigned its Job and sent begin.
// It is not a sandbox, Desktop attachment API or production client launcher.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { isAbsolute } from "node:path";
let began = false,
  child;
const emit = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const reader = createInterface({ input: process.stdin });
const deadline = setTimeout(() => {
  emit({ kind: "worker_fault", code: "BOOTSTRAP_TIMEOUT" });
  process.exit(1);
}, 5000);
reader.on("line", (line) => {
  if (began) return;
  try {
    const message = JSON.parse(line),
      p = message.input;
    if (
      message.kind !== "begin" ||
      !p ||
      !isAbsolute(p.executable) ||
      !isAbsolute(p.cwd) ||
      !Array.isArray(p.args) ||
      !p.args.every((a) => typeof a === "string") ||
      !p.env ||
      typeof p.env !== "object"
    )
      throw new Error("BOOTSTRAP_INVALID");
    began = true;
    clearTimeout(deadline);
    child = spawn(p.executable, p.args, {
      cwd: p.cwd,
      env: p.env,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.once("spawn", () =>
      emit({ kind: "desktop_started", pid: child.pid }),
    );
    let stdout = 0,
      stderr = 0;
    child.stdout.on("data", (b) => {
      const first = stdout === 0;
      stdout += b.length;
      if (first) emit({ kind: "desktop_output", stdout_bytes: stdout });
      if (stdout > 65536)
        emit({ kind: "worker_fault", code: "DESKTOP_STDOUT_LIMIT" });
    });
    child.stderr.on("data", (b) => {
      stderr += b.length;
      if (stderr > 65536)
        emit({ kind: "worker_fault", code: "DESKTOP_STDERR_LIMIT" });
    });
    child.once("error", () =>
      emit({ kind: "worker_fault", code: "DESKTOP_SPAWN" }),
    );
    child.once("close", (code, signal) => {
      emit({
        kind: "desktop_exited",
        code,
        signal,
        stdout_bytes: stdout,
        stderr_bytes: stderr,
      });
      reader.close();
      process.stdin.destroy();
    });
  } catch {
    clearTimeout(deadline);
    emit({ kind: "worker_fault", code: "BOOTSTRAP_INVALID" });
    process.exitCode = 1;
    reader.close();
    process.stdin.destroy();
  }
});
reader.once("close", () => {
  clearTimeout(deadline);
  if (!began) {
    emit({ kind: "worker_fault", code: "BOOTSTRAP_EOF" });
    process.exitCode = 1;
  }
});
