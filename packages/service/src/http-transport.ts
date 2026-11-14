import type { IncomingMessage, ServerResponse } from "node:http";
import { TransportFault } from "./errors.ts";
const MAX_BODY = 65536;
export function sendJson(res: ServerResponse, status: number, value: unknown) {
  if (res.headersSent || res.destroyed) return;
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    connection: "close",
  });
  res.end(body);
}
export async function readJson(req: IncomingMessage): Promise<unknown> {
  const contentType = req.headers["content-type"] ?? "";
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(contentType))
    throw new TransportFault(415, "UNSUPPORTED_MEDIA_TYPE");
  if (
    req.headers["content-encoding"] &&
    req.headers["content-encoding"] !== "identity"
  )
    throw new TransportFault(415, "UNSUPPORTED_MEDIA_TYPE");
  if (Number(req.headers["content-length"] ?? 0) > MAX_BODY)
    throw new TransportFault(413, "BODY_TOO_LARGE");
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += b.length;
    if (length > MAX_BODY) throw new TransportFault(413, "BODY_TOO_LARGE");
    chunks.push(b);
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    );
  } catch {
    throw new TransportFault(400, "BAD_REQUEST");
  }
}
