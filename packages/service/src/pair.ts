import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { Store } from "./store.ts";
import { OwnerAuth } from "./workspace-auth.ts";
const filename = resolve(process.env.CORE_DB ?? ".runtime/core.sqlite");
if (!existsSync(filename)) {
  console.error("尚无工作区数据库，请先运行 npm start。");
  process.exitCode = 1;
} else {
  const store = new Store(filename);
  try {
    const pairing = new OwnerAuth(store).newPairing();
    console.log("一次性配对码（10分钟有效，请勿分享）：" + pairing.code);
  } finally {
    store.close();
  }
}
