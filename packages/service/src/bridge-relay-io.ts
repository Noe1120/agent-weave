import type { Readable, Writable } from "node:stream";

export async function* readFrames(
  input: Readable,
  frameLimit: number,
  totalLimit: number,
): AsyncGenerator<any> {
  let buffer = Buffer.alloc(0),
    total = 0;
  for await (const chunk of input) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > totalLimit) throw new Error("RELAY_TOTAL_LIMIT");
    buffer = Buffer.concat([buffer, bytes]);
    for (;;) {
      const end = buffer.indexOf(10);
      if (end > frameLimit || (end < 0 && buffer.length > frameLimit))
        throw new Error("RELAY_FRAME_LIMIT");
      if (end < 0) break;
      const line = buffer.subarray(0, end);
      buffer = buffer.subarray(end + 1);
      let value;
      try {
        value = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(line),
        );
      } catch {
        throw new Error("RELAY_PROTOCOL");
      }
      yield value;
    }
  }
  if (buffer.length) throw new Error("RELAY_TRUNCATED");
}
const written = new WeakMap<Writable, number>();
export async function writeFrame(
  output: Writable,
  value: unknown,
  deadlineMs: number,
): Promise<void> {
  const frame = JSON.stringify(value) + "\n",
    bytes = Buffer.byteLength(frame);
  if (bytes > 131072) throw new Error("RELAY_FRAME_LIMIT");
  const total = (written.get(output) ?? 0) + bytes;
  if (total > 1048576) throw new Error("RELAY_TOTAL_LIMIT");
  written.set(output, total);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      output.off("error", fail);
      output.off("close", fail);
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("RELAY_WRITE"));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      output.destroy();
      reject(new Error("RELAY_WRITE_TIMEOUT"));
    }, deadlineMs);
    output.once("error", fail);
    output.once("close", fail);
    output.write(frame, (error) => {
      if (settled) return;
      // Node emits error after a failing write callback; let the error listener
      // consume it rather than removing that listener in the callback.
      if (error) return;
      settled = true;
      cleanup();
      resolve();
    });
  });
}
