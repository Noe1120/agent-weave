// Staged-content gate for this repository.
//
// Scans the blobs that are actually staged (`git diff --cached`), not the working
// tree, so an untracked local secret cannot hide behind an ignore rule and a
// staged secret cannot be missed because the file was edited afterwards.
//
//   node scripts/scan-staged.mjs
//
// Checks: credentials, forbidden artifact types, and broken relative markdown
// links in staged documents. Exit code 0 only when every check passes.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";

const git = process.env.BROKER_GIT ?? "git";
const repoRoot = resolve(".");
const staged = execFileSync(git, ["diff", "--cached", "--name-only", "-z"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
})
  .split("\0")
  .filter(Boolean);

if (staged.length === 0) {
  console.log(
    JSON.stringify({ scanned: 0, failures: [], status: "PASS" }, null, 2),
  );
  process.exit(0);
}
const blob = (path) =>
  execFileSync(git, ["show", ":" + path], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
const failures = [];
const fail = (check, file, detail) => failures.push({ check, file, detail });

// 1. Credentials. Synthetic acceptance labels are the only allowed token values.
const credentialPatterns = [
  { name: "private_key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "openai_style_key", pattern: /\bsk-[A-Za-z0-9]{20,}/ },
  { name: "jwt_like", pattern: /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}/ },
  { name: "aws_key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
];
const bearerAssignment = /experimental_bearer_token\s*=\s*"([^"]*)"/g;
const allowedBearerValues = new Set([
  "synthetic-local-only",
  "not-a-real-credential",
  "local-only-token",
]);

// 2. Artifact types that must never be published.
const forbidden = [
  /\.sqlite(-wal|-shm)?$/i,
  /\.db$/i,
  /\.env(\.|$)/i,
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)\.runtime\//,
  /(^|\/)\.tools\//,
  /\.pfx$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.log$/i,
];

// 3. Relative markdown links in staged documents must resolve.
const linkPattern = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

for (const file of staged) {
  if (forbidden.some((pattern) => pattern.test(file)))
    fail("forbidden_artifact", file, "this file type must not be published");

  let text;
  try {
    text = blob(file);
  } catch {
    fail("unreadable_blob", file, "git show failed");
    continue;
  }
  if (text.includes("\0")) continue; // binary: nothing to scan as text

  for (const { name, pattern } of credentialPatterns)
    if (pattern.test(text)) fail("credential", file, name);

  for (const match of text.matchAll(bearerAssignment)) {
    const value = match[1] ?? "";
    // A template that interpolates a value is code, not a committed credential;
    // a literal must be one of the synthetic labels.
    const interpolated = /[+$\`(]/.test(value);
    if (!interpolated && !allowedBearerValues.has(value))
      fail(
        "credential",
        file,
        "experimental_bearer_token is not a synthetic label",
      );
  }

  if (!file.endsWith(".md")) continue;
  for (const match of text.matchAll(linkPattern)) {
    const target = match[1];
    if (/^(https?:|mailto:|#)/i.test(target)) continue;
    const hashless = target.split("#")[0];
    if (!hashless) continue;
    const resolved = isAbsolute(hashless)
      ? normalize(hashless)
      : normalize(join(dirname(join(repoRoot, file)), hashless));
    const relative = resolved.startsWith(repoRoot)
      ? resolved
      : join(repoRoot, file, "..", hashless);
    if (!existsSync(relative)) fail("broken_link", file, target);
  }
}

const report = {
  scanned: staged.length,
  failures,
  status: failures.length === 0 ? "PASS" : "FAIL",
};
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
