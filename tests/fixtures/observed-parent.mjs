import { spawn } from "node:child_process";
const children = [];
for (let i = 0; i < Number(process.argv[3] ?? 1); i++) {
  const child = spawn(process.execPath, [process.argv[2]], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.push(child);
  child.stdout.once("data", () => process.stdout.write("ready\n"));
}
process.stdin.on("data", () => {
  for (const child of children) child.stdin.end();
});
process.stdin.on("end", () => {
  for (const child of children) child.stdin.end();
});
