import { createInterface } from "node:readline";
import { Store } from "../../packages/service/src/store.ts";
import { DevelopmentBroker } from "../../packages/service/src/broker.ts";
import { RunnerController } from "../../packages/service/src/runner.ts";
const lines = createInterface({ input: process.stdin });
lines.once("line", async (text) => {
  const config = JSON.parse(text),
    store = new Store(config.db),
    broker = new DevelopmentBroker(store, config.git, () => config.now),
    runner = new RunnerController(
      store,
      broker,
      config.profile,
      () => config.now,
    );
  if (config.mode === "startup_failure") {
    let error: string | null = null;
    try {
      runner.start(config.token, config.request);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    await runner.shutdown();
    const row = store.db
      .prepare("SELECT data FROM runner_executions WHERE id=?")
      .get(config.request.execution_id);
    process.stdout.write(
      JSON.stringify({ error, execution: JSON.parse(String(row!.data)) }) +
        "\n",
    );
    store.close();
    process.exit(0);
  }
  runner.start(config.token, config.request);
  const timer = setInterval(() => {
    const row = store.db
      .prepare("SELECT data FROM runner_executions WHERE id=?")
      .get(config.request.execution_id);
    const execution = JSON.parse(String(row!.data));
    if (execution.seq > 0) {
      clearInterval(timer);
      process.stdout.write(
        JSON.stringify({
          worker_pid: execution.worker_pid,
          host_pid: execution.host_pid,
        }) + "\n",
      );
    }
  }, 20);
});
