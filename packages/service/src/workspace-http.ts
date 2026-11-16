import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { WorkspaceService } from "./workspace-service.ts";
import { reject } from "./workspace-auth.ts";
import { readJson, sendJson } from "./http-transport.ts";
import { ConnectionRegistry } from "./connection-registry.ts";
const assets: Record<string, [string, string]> = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
};
const csp =
  "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";
function ownerToken(req: IncomingMessage) {
  const pairs = (req.headers.cookie ?? "")
    .split(";")
    .map((x) => x.trim())
    .filter((x) => x.startsWith("team_owner="));
  if (pairs.length !== 1) return "";
  return pairs[0]!.slice("team_owner=".length);
}
function result(res: ServerResponse, data: unknown) {
  sendJson(res, 200, {
    contract_version: "workspace/0.1",
    kind: "console_result",
    data,
  });
}
export async function handleWorkspace(
  req: IncomingMessage,
  res: ServerResponse,
  w: WorkspaceService,
  host: string,
): Promise<boolean> {
  const asset = assets[req.url ?? ""];
  if (asset) {
    if (req.method !== "GET") reject(405, "METHOD_NOT_ALLOWED");
    const content = await readFile(
      new URL("../../web/" + asset[0], import.meta.url),
    );
    res.writeHead(200, {
      "content-type": asset[1],
      "content-length": content.length,
      "cache-control": "no-store",
      "content-security-policy": csp,
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      connection: "close",
    });
    res.end(content);
    return true;
  }
  if (!req.url?.startsWith("/v1/console/")) return false;
  if (req.headers.authorization) reject(400, "INVALID_REQUEST");
  if (req.headers["sec-fetch-site"] === "cross-site")
    reject(403, "ORIGIN_REJECTED");
  const url = new URL(req.url, "http://" + host),
    path = url.pathname;
  const searchRoute = new RegExp(
    "^/v1/console/projects/([0-9a-f-]{36})/search$",
    "i",
  ).exec(path);
  const historyRoute = new RegExp(
    "^/v1/console/projects/([0-9a-f-]{36})/messages$",
    "i",
  ).exec(path);
  const allowed = searchRoute ? ["q"] : historyRoute ? ["before"] : [];
  for (const key of url.searchParams.keys())
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1)
      reject(400, "INVALID_REQUEST");
  if (req.method === "POST") {
    if (req.headers.origin !== "http://" + host) reject(403, "ORIGIN_REJECTED");
    const body = await readJson(req);
    if (path === "/v1/console/pair") {
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).join() !== "code" ||
        typeof (body as { code?: unknown }).code !== "string" ||
        !(body as { code: string }).code.match(/^[A-Za-z0-9_-]{43}$/)
      )
        reject(400, "INVALID_REQUEST");
      const session = w.auth.pair((body as { code: string }).code);
      res.setHeader(
        "set-cookie",
        "team_owner=" +
          session.token +
          "; HttpOnly; SameSite=Strict; Path=/v1/console; Max-Age=28800",
      );
      result(res, { csrf: session.csrf, expires_at: session.expires_at });
      return true;
    }
    const token = ownerToken(req),
      csrf = req.headers["x-csrf-token"];
    w.auth.authorize(token, typeof csrf === "string" ? csrf : "");
    if (
      path === "/v1/console/connections/invite" ||
      path === "/v1/console/connections/revoke"
    ) {
      const connections = new ConnectionRegistry(w);
      const operation = path.endsWith("/invite") ? "invite" : "revoke";
      result(
        res,
        connections[operation](
          token,
          typeof csrf === "string" ? csrf : "",
          body,
        ),
      );
      return true;
    }
    if (path === "/v1/console/logout") {
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).length
      )
        reject(400, "INVALID_REQUEST");
      w.auth.logout(token);
      res.setHeader(
        "set-cookie",
        "team_owner=; HttpOnly; SameSite=Strict; Path=/v1/console; Max-Age=0",
      );
      result(res, { logged_out: true });
      return true;
    }
    if (path === "/v1/console/commands") {
      result(res, w.command(token, typeof csrf === "string" ? csrf : "", body));
      return true;
    }
    reject(404, "NOT_FOUND_OR_DENIED");
  }
  if (req.method !== "GET") reject(405, "METHOD_NOT_ALLOWED");
  if (
    req.headers["transfer-encoding"] ||
    Number(req.headers["content-length"] ?? 0) !== 0
  )
    reject(400, "INVALID_REQUEST");
  const token = ownerToken(req);
  w.auth.authorize(token);
  const connections =
    /^\/v1\/console\/projects\/([0-9a-f-]{36})\/connections$/i.exec(path);
  if (connections) {
    result(res, new ConnectionRegistry(w).list(token, connections[1]!));
    return true;
  }
  if (path === "/v1/console/session") {
    result(res, w.auth.session(token));
    return true;
  }
  if (path === "/v1/console/projects") {
    result(res, w.projects(token));
    return true;
  }
  const project = new RegExp(
    "^/v1/console/projects/([0-9a-f-]{36})$",
    "i",
  ).exec(path);
  if (project) {
    result(res, w.project(token, project[1]!));
    return true;
  }
  if (historyRoute) {
    result(
      res,
      w.messages(
        token,
        historyRoute[1]!,
        url.searchParams.get("before") ?? undefined,
      ),
    );
    return true;
  }
  if (searchRoute) {
    result(
      res,
      w.search(token, searchRoute[1]!, url.searchParams.get("q") ?? ""),
    );
    return true;
  }
  reject(404, "NOT_FOUND_OR_DENIED");
}
