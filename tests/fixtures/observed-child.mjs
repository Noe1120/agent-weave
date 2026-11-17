process.stdin.resume();
process.stdout.write("ready");
process.stdin.on("end", () => process.exit(0));
