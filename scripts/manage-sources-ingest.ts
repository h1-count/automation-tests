import { readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { renderScanReport, runScan } from "../src/support/sources-ingest/ingest.js";
import { applyPendingItem } from "../src/support/sources-ingest/apply.js";
import { backfillManifestSha256, loadSourcesManifest } from "../src/support/sources-ingest/sourcesManifest.js";

const projectRoot = resolve(import.meta.dirname, "..");
const defaultStagingRoot = resolve(projectRoot, ".dsh-filess");

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function listOption(args: string[], name: string): string[] | undefined {
  const value = option(args, name);
  return value ? value.split(",").map((entry) => entry.trim()).filter(Boolean) : undefined;
}

function flag(args: string[], name: string): boolean {
  return args.includes(name);
}

function discoverStagingRoots(): string[] {
  if (!existsSync(defaultStagingRoot)) {
    return [];
  }
  return readdirSync(defaultStagingRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(defaultStagingRoot, entry.name));
}

function usage(): never {
  process.stdout.write(`用法：
  npm run sources:ingest -- scan [--staging <dir>]     扫描上传暂存区并刷新待审队列（只读）
  npm run sources:ingest -- status                     列出当前待审项
  npm run sources:ingest -- backfill                   为 manifest 存量材料补齐 sha256（幂等）
  npm run sources:ingest -- apply --item <id> --mode <register|request-scoped|ignore>
      [--dry-run] [--material-id <id>] [--type <type>] [--dir <sources子目录>]
      [--source-version <ver>] [--projects <a,b>] [--scopes <a,b>] [--notes <text>]
      [--supersedes <materialId>] [--force-new]
`);
  process.exit(0);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? "scan";
  const extraStaging = option(args, "--staging");
  const stagingRoots = [...discoverStagingRoots(), ...(extraStaging ? [resolve(extraStaging)] : [])];

  if (command === "scan") {
    const result = runScan({ stagingRoots });
    process.stdout.write(`${renderScanReport(result)}\n`);
    if (result.pending.length > 0) {
      process.stdout.write(`\n确认后执行：npm run sources:ingest -- apply --item <id> --mode <register|request-scoped|ignore> […]\n`);
    }
    return;
  }
  if (command === "status") {
    const manifest = loadSourcesManifest();
    process.stdout.write(`manifest v${manifest.version}，${manifest.materials.length} 份材料（带 sha256 ${manifest.materials.filter((m) => m.sha256).length} 份）。\n`);
    const result = runScan({ stagingRoots });
    const handled = result.pending.length === 0;
    process.stdout.write(`${renderScanReport(result)}\n`);
    if (handled && result.duplicates > 0) {
      process.stdout.write("（重复项已自动识别为 no-op。）\n");
    }
    return;
  }
  if (command === "backfill") {
    const result = backfillManifestSha256();
    process.stdout.write(
      `补齐 ${result.updatedMaterialIds.length} 份材料的 sha256；已有 ${result.alreadyHashedCount} 份；缺失文件 ${result.missingFiles.length} 份${
        result.missingFiles.length > 0 ? `：${result.missingFiles.join("、")}` : ""
      }。\n`
    );
    if (result.missingFiles.length > 0) process.exitCode = 2;
    return;
  }
  if (command === "apply") {
    const itemId = option(args, "--item");
    const mode = option(args, "--mode");
    if (!itemId || !mode || !["register", "request-scoped", "ignore"].includes(mode)) {
      process.stderr.write("apply 需要 --item <id> 与 --mode <register|request-scoped|ignore>。\n");
      process.exitCode = 2;
      return;
    }
    const result = applyPendingItem({
      itemId,
      mode: mode as "register" | "request-scoped" | "ignore",
      dryRun: flag(args, "--dry-run"),
      materialId: option(args, "--material-id"),
      targetType: option(args, "--type"),
      targetDir: option(args, "--dir"),
      sourceVersion: option(args, "--source-version"),
      projects: listOption(args, "--projects"),
      scopes: listOption(args, "--scopes"),
      notes: option(args, "--notes"),
      supersedes: option(args, "--supersedes"),
      forceNew: flag(args, "--force-new")
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status === "rejected") process.exitCode = 2;
    return;
  }
  usage();
}

void main();
