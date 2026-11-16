// Acceptance tooling only: never imported by the production service.
import { createServer } from "node:http";
import {
  lstatSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { resolve, relative, isAbsolute, join, dirname } from "node:path";
import { listenLoopback } from "../packages/service/src/loopback-listener.ts";

export function operatorJson(text) {
  return JSON.parse(text.replace(/^\uFEFF/, ""));
}

export async function taskRelay({ path, entryToken, read }) {
  let grant,
    reads = 0;
  const server = createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(body));
    };
    if (
      !grant ||
      req.url !== path ||
      req.method !== "GET" ||
      req.headers.host !== new URL(origin).host ||
      req.headers.origin ||
      req.headers.cookie ||
      req.headers["transfer-encoding"] ||
      Number(req.headers["content-length"] ?? 0) !== 0 ||
      req.headers.authorization !== "Bearer " + entryToken
    ) {
      send(404, { code: "NOT_FOUND_OR_DENIED" });
      return;
    }
    Promise.resolve()
      .then(() => read(grant))
      .then((result) => {
        if (result.status === 200) reads++;
        send(result.status, result.body);
      })
      .catch(() => send(500, { code: "RELAY_READ_FAILED" }));
  });
  await listenLoopback(server);
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    get reads() {
      return reads;
    },
    activate(token) {
      if (grant || !token) throw new Error("ALREADY_ACTIVE_OR_EMPTY");
      grant = token;
    },
    async close() {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}

export function cleanCredentials(root, files, secrets) {
  root = resolve(root);
  const check = (file) => {
    file = resolve(file);
    const rel = relative(root, file);
    if (
      rel === ".." ||
      rel.startsWith("..\\") ||
      rel.startsWith("../") ||
      isAbsolute(rel)
    )
      throw new Error("OUTSIDE_OWNED_ROOT");
    for (let p = file; ; p = dirname(p)) {
      if (existsSync(p) && lstatSync(p).isSymbolicLink())
        throw new Error("LINK_IN_OWNED_ROOT");
      if (p === root) break;
    }
    return file;
  };
  // Validate all targets before any deletion. No recursive deletion.
  const targets = files.map(check);
  let deleted = 0;
  for (const file of targets)
    if (existsSync(file)) {
      unlinkSync(file);
      deleted++;
    }
  let scanned = 0,
    residual_files = 0;
  const visit = (dir) => {
    check(dir);
    for (const name of readdirSync(dir)) {
      const file = check(join(dir, name)),
        stat = lstatSync(file);
      if (stat.isDirectory()) visit(file);
      else if (stat.isFile()) {
        const bytes = readFileSync(file);
        scanned++;
        if (secrets.some((s) => s && bytes.includes(Buffer.from(s))))
          residual_files++;
      } else throw new Error("UNSCANNABLE_ENTRY");
    }
  };
  visit(root);
  return { deleted, scanned, residual_files };
}

export function jointVerdict(checks) {
  const required = [
    "native",
    "turn",
    "task",
    "bridge",
    "read_only",
    "revoke",
    "exit",
    "preserved",
    "cleanup",
  ];
  return required.every((name) =>
    checks.some((c) => c.name === name && c.passed === true),
  ) && checks.every((c) => c.passed === true)
    ? "PASSED_FIXED_CONFIG"
    : "FAILED";
}
