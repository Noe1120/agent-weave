import { createServer as nodeServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { CoreService } from "./service.ts";
import {
  errorMapping,
  operations,
  resourceKinds,
  validateRequest,
} from "../../contracts/src/index.ts";
import type { ResourceKind } from "../../contracts/src/index.ts";
import { TransportFault } from "./errors.ts";
import { readJson as body, sendJson as send } from "./http-transport.ts";
import { WorkspaceService } from "./workspace-service.ts";
import { handleWorkspace } from "./workspace-http.ts";
import { ExecutionFeed } from "./workspace-feed.ts";
import { WorkspaceFault } from "./workspace-auth.ts";
import { ServiceFault } from "./errors.ts";
import { randomUUID } from "node:crypto";
export function createServer(
  service: CoreService,
  workspace = new WorkspaceService(service.store, service.now),
) {
  const feed = new ExecutionFeed(service.store, service.now);
  const server = nodeServer(
    { maxHeaderSize: 8192, requestTimeout: 10000, headersTimeout: 5000 },
    (req, res) => {
      void (async () => {
        const address = server.address();
        if (!address || typeof address === "string")
          throw new TransportFault(500, "INTERNAL_ERROR");
        const expected = "127.0.0.1:" + address.port;
        if (
          req.headers.host !== expected ||
          (req.headers.origin !== undefined &&
            req.headers.origin !== "http://" + expected)
        )
          throw new TransportFault(403, "UNTRUSTED_ORIGIN_OR_HOST");
        if (await handleWorkspace(req, res, workspace, expected)) return;
        if (
          !req.url ||
          !req.url.startsWith("/") ||
          req.url.includes("?") ||
          req.url.includes("#") ||
          req.headers.cookie
        )
          throw new TransportFault(400, "BAD_REQUEST");
        const credential = req.headers.authorization?.match(
          /^Bearer ([A-Za-z0-9_-]{43})$/,
        );
        if (!credential) throw new TransportFault(401, "UNAUTHENTICATED");
        const token = credential[1]!;
        if (req.url === "/v1/feed") {
          if (req.method !== "POST")
            throw new TransportFault(405, "METHOD_NOT_ALLOWED");
          send(res, 200, feed.read(token, await body(req)));
          return;
        }
        const core = /^\/v1\/core\/([a-z_]+)$/.exec(req.url);
        if (
          core &&
          operations.includes(core[1] as (typeof operations)[number])
        ) {
          if (req.method !== "POST")
            throw new TransportFault(405, "METHOD_NOT_ALLOWED");
          const q = await body(req);
          if (!validateRequest(q) || q.kind !== core[1])
            throw new TransportFault(400, "BAD_REQUEST");
          const result = service.execute(token, q);
          send(
            res,
            result.kind === "service_error"
              ? errorMapping[result.code].http_status
              : 200,
            result,
          );
          return;
        }
        const resource =
          /^\/v1\/projects\/([0-9a-fA-F-]{36})\/([a-z_]+)\/([0-9a-fA-F-]{36})$/.exec(
            req.url,
          );
        if (resource && resourceKinds.includes(resource[2] as ResourceKind)) {
          if (req.method !== "GET")
            throw new TransportFault(405, "METHOD_NOT_ALLOWED");
          if (
            req.headers["transfer-encoding"] ||
            Number(req.headers["content-length"] ?? 0) !== 0
          )
            throw new TransportFault(400, "BAD_REQUEST");
          const result = service.readResource(
            token,
            resource[1]!,
            resource[2] as ResourceKind,
            resource[3]!,
          );
          send(res, 200, result);
          return;
        }
        throw new TransportFault(404, "NOT_FOUND_OR_DENIED");
      })().catch((e: unknown) => {
        const isWorkspace =
          req.url?.startsWith("/v1/console") || req.url === "/v1/feed";
        if (e instanceof WorkspaceFault) {
          send(res, e.status, { kind: "workspace_error", code: e.code });
        } else if (isWorkspace && e instanceof ServiceFault) {
          send(res, errorMapping[e.code].http_status, {
            kind: "workspace_error",
            code: e.code,
          });
        } else {
          const fault =
            e instanceof TransportFault
              ? e
              : new TransportFault(500, "INTERNAL_ERROR");
          if (fault.status === 500) {
            const id = randomUUID();
            const error = e as Error & { code?: string };
            console.error(
              JSON.stringify({
                event: "http_internal_error",
                incident_id: id,
                error_type: error.name,
                error_code: error.code ?? "UNKNOWN",
                stack_locations: error.stack?.split("\n").slice(1, 5),
              }),
            );
            send(
              res,
              500,
              isWorkspace
                ? {
                    kind: "workspace_error",
                    code: "INTERNAL_ERROR",
                    incident_id: id,
                  }
                : { kind: "transport_error", code: "INTERNAL_ERROR" },
            );
          } else
            send(res, fault.status, {
              kind: isWorkspace ? "workspace_error" : "transport_error",
              code: fault.code,
            });
        }
        req.resume();
      });
    },
  );
  server.maxRequestsPerSocket = 100;
  server.keepAliveTimeout = 1000;
  server.setTimeout(10000, (socket) => socket.destroy());
  return server;
}
