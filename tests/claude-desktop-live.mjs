// Known launch prerequisite failure. Never retry the installed packaged client here.
// The first actual attempt and owned-Job limitation are recorded in W13 evidence.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { isAbsolute } from "node:path";
import { parseArgs } from "node:util";
const { values } = parseArgs({
  options: {
    "allow-claude-desktop-probe": { type: "boolean" },
    config: { type: "string" },
    output: { type: "string" },
  },
  strict: true,
});
assert.equal(
  values["allow-claude-desktop-probe"],
  true,
  "Explicit fresh-profile Desktop probe authorization required",
);
assert.equal(process.platform, "win32");
assert.ok(values.config && isAbsolute(values.config));
assert.ok(values.output && isAbsolute(values.output));
// Never reuse an earlier attempt directory or even read a supplied profile/config.
mkdirSync(values.output);
throw new Error(
  "CLAUDE_PACKAGED_LIFETIME_UNQUALIFIED: original client survived owned Job cleanup; real retry disabled until launch ownership is repaired",
);
