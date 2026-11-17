import { spawn, type ChildProcess } from "node:child_process";
import { isAbsolute } from "node:path";
import type { RelayExitObservation } from "./codex-relay-handle.ts";
import type { HostExit } from "./bridge-supervisor.ts";

/** Trusted OS identity input only. Does not discover or authorize the target. */
export async function observeWindowsExit(input: {
  pid: number;
  startedTicks: string;
}): Promise<RelayExitObservation> {
  if (
    process.platform !== "win32" ||
    !Number.isSafeInteger(input.pid) ||
    input.pid <= 0 ||
    input.pid > 4294967295 ||
    !/^[1-9][0-9]{0,18}$/.test(input.startedTicks)
  )
    throw new Error("WINDOWS_EXIT_OPTIONS");
  // Only validated decimal values enter this fixed script; no free commands.
  const script = `
$ErrorActionPreference = 'Stop'
$p = $null
try {
  $p = Get-Process -Id ${input.pid}
  $null = $p.Handle
  if ($p.StartTime.ToUniversalTime().Ticks.ToString() -ne '${input.startedTicks}') { throw 'IDENTITY' }
  [Console]::Out.WriteLine('{"kind":"ready"}')
  [Console]::Out.Flush()
  $p.WaitForExit()
  [Console]::Out.WriteLine((@{kind='exit';code=$p.ExitCode} | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
} catch { exit 1 } finally { if ($null -ne $p) { $p.Dispose() } }
`;
  return runObserver(script);
}

/** Only accepts an owned live ChildProcess, never a client-supplied parent PID. */
export async function observeWindowsChildExit(
  parent: ChildProcess,
  entry: string,
): Promise<RelayExitObservation> {
  if (
    process.platform !== "win32" ||
    !parent.pid ||
    parent.exitCode !== null ||
    parent.signalCode !== null ||
    !isAbsolute(entry)
  )
    throw new Error("WINDOWS_EXIT_OPTIONS");
  const encoded = (s: string) => Buffer.from(s, "utf8").toString("base64");
  const script = `
$ErrorActionPreference = 'Stop'
$parent = $null; $p = $null
try {
  $parent = Get-Process -Id ${parent.pid}
  $null = $parent.Handle
  $exe = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded(process.execPath)}'))
  $entry = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded(entry)}'))
  $commands = @(('"' + $exe + '" "' + $entry + '"'), ('"' + $exe + '" ' + $entry), ($exe + ' "' + $entry + '"'), ($exe + ' ' + $entry))
  $matches = @(Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${parent.pid}' | Where-Object { $_.ExecutablePath -eq $exe -and $commands -contains $_.CommandLine })
  if ($matches.Count -ne 1 -or $parent.HasExited) { throw 'AMBIGUOUS' }
  $p = Get-Process -Id $matches[0].ProcessId
  $null = $p.Handle
  $again = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $p.Id)
  if ($parent.HasExited -or $p.StartTime -lt $parent.StartTime -or $again.ParentProcessId -ne $parent.Id -or $again.ExecutablePath -ne $exe -or $commands -notcontains $again.CommandLine) { throw 'IDENTITY' }
  [Console]::Out.WriteLine('{"kind":"ready"}')
  [Console]::Out.Flush()
  $p.WaitForExit()
  [Console]::Out.WriteLine((@{kind='exit';code=$p.ExitCode} | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
} catch { exit 1 } finally { if ($null -ne $p) { $p.Dispose() }; if ($null -ne $parent) { $parent.Dispose() } }
`;
  const observer = await runObserver(script);
  if (parent.exitCode !== null || parent.signalCode !== null) {
    await observer.dispose();
    throw new Error("WINDOWS_EXIT_PARENT_CLOSED");
  }
  return observer;
}

async function runObserver(script: string): Promise<RelayExitObservation> {
  const child = spawn(
    "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] },
  );
  let ready = false,
    disposed = false,
    bytes = 0,
    buffer = "";
  let proof: HostExit | undefined, fault: Error | undefined;
  let resolveReady!: () => void, rejectReady!: (e: Error) => void;
  let resolveExit!: (e: HostExit) => void, rejectExit!: (e: Error) => void;
  const prepared = new Promise<void>((r, j) => {
    resolveReady = r;
    rejectReady = j;
  });
  const exited = new Promise<HostExit>((r, j) => {
    resolveExit = r;
    rejectExit = j;
  });
  void exited.catch(() => {});
  const fail = (code: string) => {
    fault ??= new Error(code);
    rejectReady(fault);
    rejectExit(fault);
  };
  const closed = new Promise<void>((resolve) =>
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && ready && proof && !fault && !buffer.trim())
        resolveExit(proof);
      else fail("WINDOWS_EXIT_UNPROVEN");
      resolve();
    }),
  );
  child.on("error", () => fail("WINDOWS_EXIT_HELPER"));
  child.stderr.resume();
  child.stdout.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > 4096) {
      fail("WINDOWS_EXIT_PROTOCOL");
      child.kill();
      return;
    }
    buffer += chunk.toString("utf8");
    for (;;) {
      const end = buffer.indexOf("\n");
      if (end < 0) break;
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      try {
        const value = JSON.parse(line);
        if (
          !ready &&
          Object.keys(value).length === 1 &&
          value.kind === "ready"
        ) {
          ready = true;
          clearTimeout(timer);
          resolveReady();
        } else if (
          ready &&
          !proof &&
          Object.keys(value).length === 2 &&
          value.kind === "exit" &&
          Number.isInteger(value.code)
        ) {
          proof = { code: value.code, exit_observed: true, forced: false };
        } else throw new Error();
      } catch {
        fail("WINDOWS_EXIT_PROTOCOL");
        child.kill();
      }
    }
  });
  const timer = setTimeout(() => {
    fail("WINDOWS_EXIT_READY_TIMEOUT");
    child.kill();
  }, 10000);
  let disposing: Promise<void> | undefined;
  const dispose = () => {
    if (disposing) return disposing;
    disposed = true;
    disposing = (async () => {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) {
        fail("WINDOWS_EXIT_DISPOSED");
        child.kill();
      }
      let timeout: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          closed,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error("WINDOWS_EXIT_DISPOSE_TIMEOUT")),
              5000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
    })();
    return disposing;
  };
  try {
    await prepared;
  } catch (error) {
    await dispose();
    throw error;
  }
  return {
    async waitExit() {
      if (disposed && !proof) throw new Error("WINDOWS_EXIT_DISPOSED");
      return { ...(await exited) };
    },
    dispose,
  };
}
