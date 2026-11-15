// Acceptance preparation only: no launching, provider requests or original-history access.
import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileHash, prepareClaudeProbe } from "./claude-desktop-launch.ts";

interface Route {
  source_library: string;
  metadata_sha256: string;
  selected_sha256: string;
}
function object(v: unknown): Record<string, any> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("CLAUDE_3P_CONFIG");
  return v as Record<string, any>;
}
async function pinnedJson(path: string, hash: string) {
  for (let p = path; ; p = dirname(p)) {
    const s = await lstat(p);
    if (
      s.isSymbolicLink() ||
      (p === path && (!s.isFile() || s.nlink !== 1 || s.size > 65536))
    )
      throw new Error("CLAUDE_3P_UNSAFE_SOURCE");
    if (dirname(p) === p) break;
  }
  const bytes = await readFile(path);
  if (createHash("sha256").update(bytes).digest("hex") !== hash)
    throw new Error("CLAUDE_3P_SOURCE_CHANGED");
  try {
    return object(JSON.parse(bytes.toString("utf8")));
  } catch {
    throw new Error("CLAUDE_3P_CONFIG");
  }
}
export async function prepareClaudeThirdPartyProbe(
  config: unknown,
  route: unknown,
  allowCredentialReuse: boolean,
) {
  if (allowCredentialReuse !== true)
    throw new Error("CLAUDE_CREDENTIAL_REUSE_AUTHORIZATION_REQUIRED");
  const r = object(route) as unknown as Route;
  if (
    Object.keys(r).sort().join() !==
      "metadata_sha256,selected_sha256,source_library" ||
    typeof r.source_library !== "string" ||
    !isAbsolute(r.source_library) ||
    ![r.metadata_sha256, r.selected_sha256].every(
      (h) => typeof h === "string" && /^[a-f0-9]{64}$/.test(h),
    )
  )
    throw new Error("CLAUDE_3P_CONFIG");
  const source = resolve(r.source_library);
  const meta = await pinnedJson(join(source, "_meta.json"), r.metadata_sha256);
  const id = meta.appliedId;
  if (
    typeof id !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)
  )
    throw new Error("CLAUDE_3P_CONFIG");
  const selected = await pinnedJson(
    join(source, id + ".json"),
    r.selected_sha256,
  );
  const allowed = new Set([
    "inferenceProvider",
    "inferenceGatewayBaseUrl",
    "inferenceGatewayApiKey",
    "inferenceGatewayAuthScheme",
    "inferenceModels",
    "coworkEgressAllowedHosts",
    "disableDeploymentModeChooser",
    "modelDiscoveryEnabled",
  ]);
  if (
    Object.keys(selected).some((k) => !allowed.has(k)) ||
    selected.inferenceProvider !== "gateway" ||
    selected.inferenceGatewayAuthScheme !== "bearer" ||
    typeof selected.inferenceGatewayApiKey !== "string" ||
    selected.inferenceGatewayApiKey.length < 1 ||
    selected.inferenceGatewayApiKey.length > 4096 ||
    typeof selected.inferenceGatewayBaseUrl !== "string" ||
    !Array.isArray(selected.inferenceModels) ||
    selected.inferenceModels.length < 1
  )
    throw new Error("CLAUDE_3P_CONFIG");
  let url: URL;
  try {
    url = new URL(selected.inferenceGatewayBaseUrl);
  } catch {
    throw new Error("CLAUDE_3P_CONFIG");
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("CLAUDE_3P_LOOPBACK_REQUIRED");
  const p = await prepareClaudeProbe(config);
  // The installed Desktop relocates 3p userData here, even with --user-data-dir.
  const profile = join(p.env.LOCALAPPDATA!, "Claude-3p");
  const library = join(profile, "configLibrary");
  await mkdir(library, { recursive: true });
  await writeFile(
    join(library, "_meta.json"),
    JSON.stringify({
      entries: [{ id, name: "Agent Weave acceptance" }],
      appliedId: id,
    }) + "\n",
    { flag: "wx" },
  );
  const prefs = JSON.parse(
    await readFile(join(p.profile, "claude_desktop_config.json"), "utf8"),
  );
  const mcpPath = join(profile, "claude_desktop_config.json");
  await writeFile(
    mcpPath,
    JSON.stringify({ deploymentMode: "3p", ...prefs }) + "\n",
    { flag: "wx" },
  );
  // Copy credentials only after all non-secret profile preparation succeeds.
  const credential = await open(join(library, id + ".json"), "wx");
  try {
    await credential.writeFile(JSON.stringify(selected) + "\n");
    await credential.sync();
  } catch (failure) {
    try {
      await credential.truncate(0);
      await credential.sync();
    } catch (cleanup) {
      throw new AggregateError([failure, cleanup], "CLAUDE_3P_CLEANUP_FAILED");
    }
    throw failure;
  } finally {
    await credential.close();
  }
  return {
    ...p,
    profile,
    args: ["--user-data-dir=" + profile],
    mcp_config_path: mcpPath,
    third_party_config_library_path: library,
    third_party_mode: "3p" as const,
  };
}

// Used only before any client is launched; never redact a running client's file.
export async function checkPreparedProbe<T>(
  prepared: { root: string; third_party_config_library_path?: string },
  check: () => Promise<T>,
): Promise<T> {
  try {
    return await check();
  } catch (failure) {
    if (prepared.third_party_config_library_path) {
      try {
        await redactProbeCredential({
          root: prepared.root,
          third_party_config_library_path:
            prepared.third_party_config_library_path,
        });
      } catch (cleanup) {
        throw new AggregateError(
          [failure, cleanup],
          "CLAUDE_3P_CLEANUP_FAILED",
        );
      }
    }
    throw failure;
  }
}

export async function redactProbeCredential(p: {
  root: string;
  third_party_config_library_path: string;
}) {
  const expected = join(
    p.root,
    "user",
    "AppData",
    "Local",
    "Claude-3p",
    "configLibrary",
  );
  if (resolve(p.third_party_config_library_path) !== resolve(expected))
    throw new Error("CLAUDE_3P_CLEANUP_SCOPE");
  const metaPath = join(expected, "_meta.json");
  const meta = await pinnedJson(metaPath, await fileHash(metaPath));
  if (
    typeof meta.appliedId !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      meta.appliedId,
    )
  )
    throw new Error("CLAUDE_3P_CLEANUP_SCOPE");
  const selectedPath = join(expected, meta.appliedId + ".json");
  const selected = await pinnedJson(selectedPath, await fileHash(selectedPath));
  if (selected.inferenceProvider !== "gateway")
    throw new Error("CLAUDE_3P_CLEANUP_SCOPE");
  selected.inferenceGatewayApiKey = "";
  const handle = await open(selectedPath, "r+");
  try {
    const bytes = Buffer.from(JSON.stringify(selected) + "\n");
    await handle.writeFile(bytes);
    await handle.truncate(bytes.length);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
