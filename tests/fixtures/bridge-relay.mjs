import { runRelay } from "../../packages/service/src/bridge-relay.ts";
try {
  const descriptor = JSON.parse(process.env.TEAM_RELAY ?? "null");
  delete process.env.TEAM_RELAY;
  await runRelay(descriptor, process.stdin, process.stdout);
  process.stdout.end();
} catch (error) {
  const code =
    error instanceof Error &&
    /^(RELAY|BRIDGE|HOST)_[A-Z_]+$/.test(error.message)
      ? error.message
      : "RELAY_FAILED";
  process.stderr.write(code + "\n");
  process.exitCode = 1;
  process.stdin.destroy();
}
