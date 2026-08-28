import { readdir, readFile, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";

const workspaceRoot = process.cwd();
const cacheRoot = resolve(workspaceRoot, ".local/test-review-cache");
const args = process.argv.slice(2);
const removeAll = args.includes("--all");
const dryRun = args.includes("--dry-run");
const positional = args.filter((value) => !value.startsWith("--"));
if (args.some((value) => !["--all", "--dry-run"].includes(value) && value.startsWith("--"))) {
  throw new Error("Usage: cleanup-review-workbook-cache.ts [maxEntries>=1] | --all [--dry-run]");
}
if (positional.length > 1 || (removeAll && positional.length)) {
  throw new Error("Usage: cleanup-review-workbook-cache.ts [maxEntries>=1] | --all [--dry-run]");
}
const maxEntries = removeAll ? 0 : Number(positional[0] ?? "24");

if (!Number.isInteger(maxEntries) || maxEntries < 0) {
  throw new Error("Usage: cleanup-review-workbook-cache.ts [maxEntries>=1] | --all [--dry-run]");
}

const entries = await Promise.all((await readdir(cacheRoot, { withFileTypes: true }).catch(() => []))
  .filter((entry) => entry.isDirectory())
  .map(async (entry) => {
    const path = resolve(cacheRoot, entry.name);
    let lastUsedAt = 0;
    try {
      const metadata = JSON.parse(await readFile(resolve(path, "cache.json"), "utf8")) as { lastUsedAt?: unknown };
      lastUsedAt = typeof metadata.lastUsedAt === "string" ? Date.parse(metadata.lastUsedAt) : 0;
    } catch {
      lastUsedAt = (await stat(path)).mtimeMs;
    }
    return { name: entry.name, lastUsedAt: Number.isFinite(lastUsedAt) ? lastUsedAt : 0 };
  }));
for (const entry of entries.sort((left, right) => right.lastUsedAt - left.lastUsedAt).slice(maxEntries)) {
  if (!dryRun) await rm(resolve(cacheRoot, entry.name), { recursive: true, force: true });
  process.stdout.write(`${dryRun ? "would remove" : "removed"} ${entry.name}\n`);
}
