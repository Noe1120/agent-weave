// Trusted acceptance composition only. Not a default production launcher.
import assert from "node:assert/strict";
import { composeCodexRelayHandle } from "../dist/packages/service/src/codex-relay-handle.js";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  readFrames,
  writeFrame,
} from "../dist/packages/service/src/bridge-relay-io.js";

const ps = "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const query = (script) =>
  JSON.parse(
    execFileSync(ps, ["-NoProfile", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
    }).trim() || "[]",
  );
async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("RELAY_PROOF_TIMEOUT");
    await pause(25);
  }
}
export function relayJointComposition(
  prepared,
  base,
  { root, bridgeData, synthetic },
) {
  let raw,
    relay,
    ended,
    frames,
    serial = 0,
    watcher;
  const facts = {};
  const rpc = async (method, params = {}) => {
    await writeFrame(
      relay.stdin,
      { jsonrpc: "2.0", id: ++serial, method, params },
      3000,
    );
    const frame = (await frames.next()).value;
    assert.equal(frame.id, serial);
    return frame;
  };
  const launcher = {
    fingerprint: base.fingerprint,
    clientVersion: base.clientVersion,
    source: base.source,
    async launch(allowed) {
      raw = await base.launch(allowed);
      const host = {
        get status() {
          return raw.status;
        },
        get statistics() {
          return raw.statistics;
        },
        workDirectory: raw.workDirectory,
        ready: raw.ready,
        closed: raw.closed,
        async startThread(cwd) {
          const thread = await raw.startThread(cwd);
          if (synthetic) {
            relay = spawn(prepared.launch.command, prepared.launch.args, {
              windowsHide: true,
              stdio: ["pipe", "pipe", "pipe"],
              env: {
                SystemRoot: process.env.SystemRoot,
                ...prepared.launch.env,
              },
            });
            ended = once(relay, "close");
            relay.stderr.resume();
            frames = readFrames(relay.stdout, 131072, 1048576);
            await rpc("initialize", {
              protocolVersion: "2025-06-18",
              capabilities: {},
              clientInfo: { name: "w25-rehearsal", version: "1" },
            });
            await writeFrame(
              relay.stdin,
              {
                jsonrpc: "2.0",
                method: "notifications/initialized",
                params: {},
              },
              3000,
            );
            await rpc("tools/list");
          }
          await prepared.ready;
          return thread;
        },
        startTurn: (...args) => raw.startTurn(...args),
        interruptTurn: (...args) => raw.interruptTurn(...args),
        close() {
          facts.host_close_requested_at ??= new Date().toISOString();
          raw.close();
        },
      };
      return composeCodexRelayHandle({
        host,
        bridge: prepared,
        stillAuthorized: allowed,
        // Watcher is armed near revocation, avoiding its 60s wait during a turn.
        observeRelay: async () => ({
          async waitExit() {
            if (!watcher) throw new Error("RELAY_PROOF_MISSING");
            await until(() => existsSync(watcher.path));
            assert.equal((await watcher.ended)[0], 0);
            facts.relay_os_exit = JSON.parse(
              readFileSync(watcher.path, "utf8"),
            );
            return {
              code: facts.relay_os_exit.exit_code,
              exit_observed: facts.relay_os_exit.exit_observed,
              forced: false,
            };
          },
          async dispose() {
            if (watcher) {
              if (watcher.child.exitCode === null) watcher.child.kill();
              await watcher.ended;
            }
          },
        }),
        // The acceptance harness owns home cleanup after controller disposal.
        cleanup: async () => {
          facts.snapshot = prepared.snapshot();
        },
      });
    },
  };
  return {
    launcher,
    facts,
    rpc,
    async arm() {
      assert.ok(raw && !watcher && raw.status.state !== "closed");
      let pid = relay?.pid;
      if (!synthetic) {
        const entry = prepared.launch.args[0].replaceAll("'", "''");
        const children = [].concat(
          query(
            `@(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.ParentProcessId -eq ${raw.child.pid} -and $_.CommandLine.Contains('${entry}') } | Select-Object ProcessId,CreationDate) | ConvertTo-Json -Compress`,
          ),
        );
        assert.equal(children.length, 1);
        pid = children[0].ProcessId;
      }
      const path = join(root, "relay-exit.json");
      const child = spawn(
        ps,
        [
          "-NoProfile",
          "-File",
          resolve("tests/watch-owned-exit.ps1"),
          "-TargetId",
          String(pid),
          "-OutputFile",
          path,
        ],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      const done = once(child, "close");
      child.stdout.resume();
      child.stderr.resume();
      watcher = { path, child, ended: done };
      await until(() => {
        if (child.exitCode !== null) throw new Error("RELAY_WATCH_FAILED");
        return existsSync(path + ".ready");
      });
    },
    reports() {
      return readdirSync(bridgeData).map((name) =>
        JSON.parse(readFileSync(join(bridgeData, name, "report.json"), "utf8")),
      );
    },
    async cleanup() {
      await prepared.abort();
      if (relay) {
        if (relay.exitCode === null && relay.signalCode === null) relay.kill();
        await ended;
      }
      if (watcher) {
        if (watcher.child.exitCode === null) watcher.child.kill();
        await watcher.ended;
      }
    },
  };
}
