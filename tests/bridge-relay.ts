import { createServer, connect, type Socket } from "node:net";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Readable, Writable } from "node:stream";
import type { BridgeSupervisor, HostExit } from "./bridge-supervisor.ts";
import { readFrames, writeFrame } from "./bridge-relay-io.ts";

interface Descriptor {
  port: number;
  instance: string;
  token: string;
}
const bounded = async <T>(
  p: Promise<T>,
  ms: number,
  reason: string,
): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(reason)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
const reason = (error: unknown) =>
  ["ECONNRESET", "EPIPE", "ERR_STREAM_PREMATURE_CLOSE"].includes(
    (error as NodeJS.ErrnoException)?.code ?? "",
  )
    ? "RELAY_DISCONNECTED"
    : error instanceof Error &&
        /^(RELAY|BRIDGE|HOST)_[A-Z_]+$/.test(error.message)
      ? error.message
      : "RELAY_FAILED";
const object = (v: any) => v && typeof v === "object" && !Array.isArray(v);
function checkDescriptor(d: Descriptor) {
  if (
    !object(d) ||
    !Number.isInteger(d.port) ||
    d.port < 1 ||
    d.port > 65535 ||
    !/^[a-f0-9]{64}$/.test(d.token) ||
    !/^[a-f0-9]{32}$/.test(d.instance)
  )
    throw new Error("RELAY_CONFIG");
}
function checkRpc(f: any) {
  if (
    !object(f) ||
    f.jsonrpc !== "2.0" ||
    typeof f.method !== "string" ||
    !f.method ||
    f.method.length > 128 ||
    Object.keys(f).some(
      (k) => !["jsonrpc", "id", "method", "params"].includes(k),
    ) ||
    ("id" in f &&
      !(
        Number.isSafeInteger(f.id) ||
        (typeof f.id === "string" && f.id.length > 0 && f.id.length <= 128)
      ))
  )
    throw new Error("RELAY_PROTOCOL");
}

/** Offline single-instance capability transport. Never launches or attaches a client. */
export async function openRelayEndpoint(
  supervisor: BridgeSupervisor,
  options: { deadlineMs: number; ttlMs: number },
) {
  if (
    ![options.deadlineMs, options.ttlMs].every(
      (n) => Number.isInteger(n) && n > 0 && n <= 30000,
    )
  )
    throw new Error("RELAY_CONFIG");
  const token = randomBytes(32).toString("hex"),
    instance = randomBytes(16).toString("hex"),
    expires = Date.now() + options.ttlMs;
  let state = "waiting",
    fault: string | null = null,
    consumed = false,
    peer: Socket | undefined,
    sealed = false,
    active: Promise<void> = Promise.resolve(),
    stopping: Promise<void> | undefined,
    expectedClose = false;
  const sockets = new Set<Socket>(),
    seen = new Set<string>();
  function fail(error: unknown) {
    fault ??= reason(error);
    state = "failed";
    peer?.destroy();
  }
  const server = createServer((socket) => {
    if (sockets.size >= 4) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.on("error", () => {});
    socket.once("close", () => {
      sockets.delete(socket);
      if (peer === socket && !expectedClose && !fault)
        fail(new Error("RELAY_DISCONNECTED"));
    });
    void serve(socket);
  });
  async function serve(socket: Socket) {
    let authenticated = false;
    const frames = readFrames(socket, 65536, 1048576);
    try {
      const first = await bounded(
        frames.next(),
        options.deadlineMs,
        "RELAY_AUTH_TIMEOUT",
      );
      const auth = first.value;
      if (
        first.done ||
        !object(auth) ||
        auth.type !== "auth" ||
        auth.instance !== instance ||
        typeof auth.token !== "string" ||
        !/^[a-f0-9]{64}$/.test(auth.token) ||
        !timingSafeEqual(
          Buffer.from(auth.token, "hex"),
          Buffer.from(token, "hex"),
        ) ||
        consumed ||
        Date.now() >= expires ||
        state !== "waiting"
      )
        throw new Error("RELAY_AUTH");
      consumed = true;
      authenticated = true;
      peer = socket;
      state = "open";
      await writeFrame(socket, { type: "ready" }, options.deadlineMs);
      for (;;) {
        const next = await frames.next();
        if (next.done) {
          if (!expectedClose) throw new Error("RELAY_DISCONNECTED");
          break;
        }
        const packet = next.value;
        if (
          object(packet) &&
          packet.type === "sealed" &&
          Object.keys(packet).length === 1 &&
          !sealed
        ) {
          sealed = true;
          continue;
        }
        if (state !== "open" || sealed) throw new Error("RELAY_NOT_OPEN");
        if (
          !object(packet) ||
          packet.type !== "rpc" ||
          Object.keys(packet).length !== 2
        )
          throw new Error("RELAY_PROTOCOL");
        const f = packet.frame;
        checkRpc(f);
        if (Object.hasOwn(f, "id")) {
          const key = JSON.stringify(f.id);
          if (seen.has(key)) throw new Error("RELAY_REPLAY");
          seen.add(key);
          if (seen.size > 1024) throw new Error("RELAY_TOTAL_LIMIT");
        }
        active = (async () => {
          let response;
          if (Object.hasOwn(f, "id")) {
            const result = await bounded(
              supervisor.request(f.method, f.params),
              options.deadlineMs,
              "RELAY_REQUEST_TIMEOUT",
            );
            response = {
              jsonrpc: "2.0",
              id: f.id,
              ...(result && Object.hasOwn(result, "protocol_error")
                ? { error: result.protocol_error }
                : { result }),
            };
          } else supervisor.notify(f.method, f.params);
          await writeFrame(
            socket,
            {
              type: "ack",
              ...(response === undefined ? {} : { frame: response }),
            },
            options.deadlineMs,
          );
        })();
        await active;
      }
    } catch (error) {
      if (authenticated) fail(error);
    } finally {
      socket.destroy();
    }
  }
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  server.on("error", fail);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("RELAY_LISTEN");
  const descriptor = { port: address.port, instance, token };
  return {
    descriptor,
    snapshot: () => ({ state, fault, consumed, sealed }),
    stop(
      waitRelay: () => Promise<HostExit>,
      closeHost: () => Promise<HostExit>,
    ): Promise<void> {
      if (stopping) return stopping;
      if (state !== "open")
        return Promise.reject(new Error(fault ?? "RELAY_NOT_OPEN"));
      state = "draining";
      stopping = (async () => {
        try {
          await active;
          if (fault) throw new Error(fault);
          await supervisor.stop(async () => {
            try {
              if (fault) throw new Error(fault);
              expectedClose = true;
              await writeFrame(peer!, { type: "closed" }, options.deadlineMs);
              peer!.end();
              const relay = await bounded(
                waitRelay(),
                options.deadlineMs,
                "RELAY_EXIT_TIMEOUT",
              );
              if (relay.code !== 0 || !relay.exit_observed || relay.forced)
                throw new Error("RELAY_EXIT_UNPROVEN");
              if (fault) throw new Error(fault);
              return await closeHost();
            } catch (error) {
              fail(error);
              throw error;
            }
          });
          if (fault) throw new Error(fault);
          state = "closed";
        } catch (error) {
          fail(error);
          throw new Error(fault!);
        }
      })();
      return stopping;
    },
    async dispose() {
      if (state !== "closed") fail(new Error("RELAY_DISCONNECTED"));
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Thin stdio forwarder: no business tokens, discovery, retries or client controls. */
export async function runRelay(
  descriptor: Descriptor,
  input: Readable,
  output: Writable,
) {
  checkDescriptor(descriptor);
  const deadlineMs = 5000;
  const socket = connect({ host: "127.0.0.1", port: descriptor.port });
  socket.on("error", () => {});
  const frames = readFrames(socket, 131072, 1048576);
  let closed = false,
    sealed = false;
  let release: ((v: any) => void) | undefined,
    reject: ((e: Error) => void) | undefined;
  let resolveClosed!: () => void, rejectClosed!: (e: Error) => void;
  const finished = new Promise<void>((resolve, reject) => {
    resolveClosed = resolve;
    rejectClosed = reject;
  });
  // Attach rejection immediately; completion is also awaited below.
  void finished.catch(() => {});
  try {
    await bounded(
      new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      }),
      deadlineMs,
      "RELAY_CONNECT_TIMEOUT",
    );
    await writeFrame(socket, { type: "auth", ...descriptor }, deadlineMs);
    const hello = await bounded(
      frames.next(),
      deadlineMs,
      "RELAY_AUTH_TIMEOUT",
    );
    if (hello.done || hello.value?.type !== "ready")
      throw new Error("RELAY_AUTH");
    const receive = (async () => {
      try {
        for await (const packet of frames) {
          if (packet?.type === "closed" && !release) {
            closed = true;
            input.destroy();
            resolveClosed();
            return;
          }
          if (packet?.type !== "ack" || !release)
            throw new Error("RELAY_PROTOCOL");
          const done = release;
          release = undefined;
          reject = undefined;
          done(packet);
        }
        throw new Error("RELAY_DISCONNECTED");
      } catch (error) {
        const e = new Error(reason(error));
        reject?.(e);
        input.destroy();
        rejectClosed(e);
        throw e;
      }
    })();
    void receive.catch(() => {});
    try {
      for await (const frame of readFrames(input, 65536, 1048576)) {
        checkRpc(frame);
        const ack = new Promise<any>((resolve, fail) => {
          release = resolve;
          reject = fail;
        });
        void ack.catch(() => {});
        await writeFrame(socket, { type: "rpc", frame }, deadlineMs);
        const packet = await bounded(ack, deadlineMs, "RELAY_REQUEST_TIMEOUT");
        if (Object.hasOwn(frame, "id")) {
          if (!packet.frame || packet.frame.id !== frame.id)
            throw new Error("RELAY_PROTOCOL");
          await writeFrame(output, packet.frame, deadlineMs);
        } else if (packet.frame !== undefined)
          throw new Error("RELAY_PROTOCOL");
      }
    } catch (error) {
      if (
        !closed ||
        (error as NodeJS.ErrnoException)?.code !== "ERR_STREAM_PREMATURE_CLOSE"
      )
        throw error;
    }
    if (!closed) {
      sealed = true;
      await writeFrame(socket, { type: "sealed" }, deadlineMs);
    }
    await bounded(finished, deadlineMs, "RELAY_CLOSE_TIMEOUT");
    await receive;
  } finally {
    socket.destroy();
    if (!closed && !sealed) input.destroy();
  }
}
