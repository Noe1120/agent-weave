import test from "node:test";
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import {
  readFrames,
  writeFrame,
} from "../packages/service/src/bridge-relay-io.ts";

async function collect(input: Readable, frame = 64, total = 128) {
  const result = [];
  for await (const value of readFrames(input, frame, total)) result.push(value);
  return result;
}
test("relay framing preserves split UTF8 and multiple frames", async () => {
  const bytes = Buffer.from('{"text":"中"}\n{"id":2}\n');
  assert.deepEqual(
    await collect(Readable.from([bytes.subarray(0, 10), bytes.subarray(10)])),
    [{ text: "中" }, { id: 2 }],
  );
});
for (const [name, bytes, frame, total, fault] of [
  ["truncated", Buffer.from('{"id":1}'), 64, 128, "RELAY_TRUNCATED"],
  ["invalid utf8", Buffer.from([0xff, 10]), 64, 128, "RELAY_PROTOCOL"],
  ["invalid json", Buffer.from("no\n"), 64, 128, "RELAY_PROTOCOL"],
  [
    "oversized frame",
    Buffer.from("x".repeat(65)),
    64,
    128,
    "RELAY_FRAME_LIMIT",
  ],
  [
    "cumulative notifications",
    Buffer.from("{}\n".repeat(44)),
    64,
    128,
    "RELAY_TOTAL_LIMIT",
  ],
] as const)
  test(`relay rejects ${name}`, async () => {
    await assert.rejects(
      collect(Readable.from([bytes]), frame, total),
      new RegExp(fault),
    );
  });
test("relay waits for writable completion and rejects blocked output by deadline", async () => {
  let done!: () => void;
  const slow = new Writable({
    write(_chunk, _encoding, callback) {
      done = callback;
    },
  });
  let completed = false;
  const writing = writeFrame(slow, { id: 7 }, 3000).then(() => {
    completed = true;
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(completed, false);
  done();
  await writing;
  const blocked = new Writable({ write() {} });
  await assert.rejects(writeFrame(blocked, {}, 30), /RELAY_WRITE_TIMEOUT/);
  assert.equal(blocked.listenerCount("error"), 0);
  slow.destroy();
  blocked.destroy();
});
test("relay rejects closed output without unhandled error", async () => {
  const output = new Writable({
    write(_c, _e, cb) {
      cb(new Error("private detail"));
    },
  });
  await assert.rejects(writeFrame(output, {}, 1000), /RELAY_WRITE/);
});

test("relay bounds cumulative output as well as input, including notifications", async () => {
  const sink = new Writable({
    write(_c, _e, cb) {
      cb();
    },
  });
  for (let i = 0; i < 16; i++)
    await writeFrame(sink, { text: "x".repeat(65520) }, 1000);
  await assert.rejects(
    writeFrame(sink, { text: "x".repeat(65520) }, 1000),
    /RELAY_TOTAL_LIMIT/,
  );
});
