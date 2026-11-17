import { openRelayEndpoint } from "../bridge-relay.ts";
// Crash transport fixture only: no MCP responses, no successful bridge evidence.
const endpoint = await openRelayEndpoint(
  {
    request() {
      throw new Error("UNEXPECTED_RPC");
    },
    notify() {
      throw new Error("UNEXPECTED_RPC");
    },
    stop() {
      throw new Error("UNEXPECTED_STOP");
    },
  },
  { deadlineMs: 3000, ttlMs: 30000 },
);
process.send(endpoint.descriptor);
const timer = setInterval(() => {
  if (endpoint.snapshot().consumed) {
    clearInterval(timer);
    process.send("bound");
  }
}, 10);
