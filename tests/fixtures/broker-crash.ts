import { readFileSync } from "node:fs";
import { Store } from "../../packages/service/src/store.ts";
import { DevelopmentBroker } from "../../packages/service/src/broker.ts";
import type {
  FaultPoint,
  WriteRequest,
} from "../../packages/service/src/broker.ts";
const config = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as {
  db: string;
  git: string;
  now: number;
  token: string;
  request: WriteRequest;
  point: FaultPoint;
};
const store = new Store(config.db);
const broker = new DevelopmentBroker(
  store,
  config.git,
  () => config.now,
  (point) => {
    if (point === config.point) process.exit(86);
  },
);
broker.write(config.token, config.request);
store.close();
process.exit(1);
