import { cp, mkdir } from "node:fs/promises";
await mkdir("dist/packages/service", { recursive: true });
await cp("packages/service/migrations", "dist/packages/service/migrations", {
  recursive: true,
});
await cp("packages/web", "dist/packages/web", { recursive: true });
