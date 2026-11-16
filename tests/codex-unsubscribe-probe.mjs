// Diagnostic only. No public service/controller method or automatic close change.
export function ownThreadProbe(handle) {
  let thread,
    used = false;
  return {
    async start() {
      if (thread || used) throw new Error("DIAGNOSTIC_ALREADY_STARTED");
      thread = await handle.startThread(handle.workDirectory);
    },
    async unsubscribe() {
      if (!thread || used || handle.statistics.generation !== 0)
        throw new Error("DIAGNOSTIC_NOT_FRESH");
      used = true; // Even rejected/unknown delivery cannot be resent.
      // Deliberate diagnostic-only access to the existing bounded transport.
      // No generic RPC endpoint is added to production or exported to a client.
      const reply = await handle.request("thread/unsubscribe", {
        threadId: thread,
      });
      if (
        !reply ||
        !["notLoaded", "notSubscribed", "unsubscribed"].includes(reply.status)
      )
        throw new Error("DIAGNOSTIC_UNSUBSCRIBE_RESPONSE");
      return reply.status;
    },
  };
}
