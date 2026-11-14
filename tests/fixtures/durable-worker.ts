import { Store } from "../../packages/service/src/store.ts";
import { CoreService } from "../../packages/service/src/service.ts";
let store: Store | undefined;
process.on("message", (message: unknown) => {
  const m = message as {
    db: string;
    token: string;
    request: unknown;
    now: number;
  };
  try {
    store = new Store(m.db);
    const result = new CoreService(store, () => m.now).execute(
      m.token,
      m.request,
    );
    process.send?.({ result });
  } catch (e) {
    process.send?.({
      error: e instanceof Error ? e.message : "worker failure",
    });
  }
});
process.on("disconnect", () => {
  store?.close();
  process.exit(0);
});
process.send?.({ ready: true });
