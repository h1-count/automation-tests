import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadBrowserExplorationPolicy, type BrowserExplorationPolicy } from "./browserExploration.js";

const marker = "# browser-exploration-managed-v1";
const digestPrefix = "# managed-digest: ";
const localConfigPath = ".codex/config.toml";

export type LocalHostConfigStatus = "configured" | "not_configured" | "unmanaged" | "invalid";

export async function inspectLocalHostConfig(workspaceRoot = process.cwd()): Promise<LocalHostConfigStatus> {
  const path = resolve(workspaceRoot, localConfigPath);
  if (!existsSync(path)) return "not_configured";
  const content = await readFile(path, "utf8");
  if (!content.includes(marker)) return "unmanaged";
  return isValidManagedConfig(content) ? "configured" : "invalid";
}

export async function ensureLocalHostConfig(workspaceRoot = process.cwd()): Promise<"created" | "updated" | "unchanged"> {
  const path = resolve(workspaceRoot, localConfigPath);
  const policy = await loadBrowserExplorationPolicy(workspaceRoot);
  const rendered = renderLocalHostConfig(policy);
  if (existsSync(path)) {
    const existing = await readFile(path, "utf8");
    if (!existing.includes(marker) || !isValidManagedConfig(existing)) {
      throw new Error("Local host configuration exists but is not a valid managed browser exploration configuration; refusing to overwrite it.");
    }
    if (existing === rendered) return "unchanged";
    await writeFile(path, rendered, { encoding: "utf8", mode: 0o600 });
    return "updated";
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, rendered, { encoding: "utf8", mode: 0o600 });
  return "created";
}

export async function removeLocalHostConfig(workspaceRoot = process.cwd()): Promise<boolean> {
  const path = resolve(workspaceRoot, localConfigPath);
  if (!existsSync(path)) return false;
  const content = await readFile(path, "utf8");
  if (!isValidManagedConfig(content)) {
    throw new Error("Refusing to remove an unmanaged or altered local host configuration.");
  }
  await unlink(path);
  return true;
}

export function renderLocalHostConfig(policy: BrowserExplorationPolicy): string {
  const lines = [
    marker,
    "# Generated from config/browser-exploration/chrome-devtools-mcp-policy.json.",
    "[mcp_servers.browser_exploration]",
    'command = "node"',
    'args = ["--import", "tsx", "scripts/run-browser-exploration-mcp.ts"]',
    "enabled = true",
    "required = false",
    "startup_timeout_sec = 30",
    "tool_timeout_sec = 60",
    'default_tools_approval_mode = "writes"',
    `enabled_tools = [${policy.allowedTools.map((tool) => JSON.stringify(tool)).join(", ")}]`,
    "",
    "[mcp_servers.browser_exploration.env]",
    'CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS = "1"',
    "",
    "[mcp_servers.browser_exploration.tools.take_screenshot]",
    'approval_mode = "prompt"'
  ];
  const body = `${lines.join("\n")}\n`;
  const digest = createHash("sha256").update(body, "utf8").digest("hex");
  return `${marker}\n${digestPrefix}${digest}\n${lines.slice(1).join("\n")}\n`;
}

function isValidManagedConfig(content: string): boolean {
  const lines = content.split("\n");
  if (lines[0] !== marker || !lines[1]?.startsWith(digestPrefix)) return false;
  const supplied = lines[1].slice(digestPrefix.length);
  const body = [lines[0], ...lines.slice(2)].join("\n");
  return /^[a-f0-9]{64}$/u.test(supplied)
    && createHash("sha256").update(body, "utf8").digest("hex") === supplied;
}
