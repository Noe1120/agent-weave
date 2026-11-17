import { runRelay } from "./bridge-relay.ts";
try {
  const text = process.env.TEAM_RELAY;
  delete process.env.TEAM_RELAY;
  if (!text || Buffer.byteLength(text) > 1024) throw new Error("RELAY_CONFIG");
  await runRelay(JSON.parse(text), process.stdin, process.stdout);
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
