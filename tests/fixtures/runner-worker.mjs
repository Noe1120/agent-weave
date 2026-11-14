import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
const input = createInterface({ input: process.stdin });
let inputCount = 0;
const pending = new Map();
const send = (frame) =>
  new Promise((resolve) => {
    pending.set(frame.seq, resolve);
    process.stdout.write(JSON.stringify(frame) + "\n");
  });
input.on("line", async (line) => {
  inputCount++;
  const message = JSON.parse(line);
  if (message.kind === "ack") {
    pending.get(message.seq)?.(message);
    pending.delete(message.seq);
    return;
  }
  if (message.kind !== "begin") process.exit(90);
  const scenario = message.input.scenario;
  // No task, child or output is produced before the native host has assigned our Job.
  if (scenario === "malformed") {
    process.stdout.write("{\n");
    return;
  }
  if (scenario === "oversized") {
    process.stdout.write("x".repeat(65537));
    return;
  }
  if (scenario === "invalid_utf8") {
    process.stdout.write(Buffer.from([255, 10]));
    return;
  }
  if (scenario === "stderr") {
    process.stderr.write("x".repeat(20000));
    return;
  }
  if (scenario === "fake_exit") {
    process.stdout.write('{"seq":1,"kind":"exited","job_empty":true}\n');
    return;
  }
  if (scenario === "out_of_order") {
    await send({ seq: 2, kind: "complete" });
    return;
  }
  if (scenario === "flood") {
    for (let i = 0; i < 600; i++)
      process.stdout.write('{"seq":1,"kind":"progress","text":"flood"}\n');
    return;
  }
  await send({
    seq: 1,
    kind: "progress",
    text: JSON.stringify({
      input_count: inputCount,
      env: Object.keys(process.env).sort(),
      cwd: process.cwd(),
    }),
  });
  if (scenario === "host_crash") {
    process.kill(process.ppid);
    return;
  }
  if (scenario === "idle") return;
  if (scenario === "nonzero") process.exit(7);
  if (scenario === "no_complete") process.exit(0);
  if (scenario === "descendants") {
    const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      stdio: "ignore",
      windowsHide: true,
    });
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    await send({ seq: 2, kind: "progress", text: "child:" + child.pid });
    await send({ seq: 3, kind: "complete" });
    process.exit(0);
  }
  const patch = {
    seq: 2,
    kind: "patch",
    edits: [
      {
        path:
          scenario === "unauthorized_patch"
            ? "private/secret.txt"
            : "src/main.txt",
        before_digest: null,
        text: "Development runner checkpoint\n",
      },
    ],
  };
  const ack = await send(patch);
  if (scenario === "replay") {
    const duplicate = await send(patch);
    if (JSON.stringify(ack) !== JSON.stringify(duplicate)) process.exit(8);
  }
  if (scenario === "conflict") {
    await send({
      ...patch,
      edits: [{ ...patch.edits[0], text: "changed retry" }],
    });
    return;
  }
  await send({ seq: 3, kind: "complete" });
  if (scenario === "complete_hold") return;
  process.exit(0);
});
