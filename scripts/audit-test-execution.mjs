import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadExecutionContract } from "./support/test-execution-contract.mjs";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
async function packsFrom(args) {
  if (args.length) return args.map((item) => path.resolve(rootDirectory, item));
  const found = [];
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (!entry.isDirectory()) continue;
      if (await fs.access(path.join(target, "cases.md")).then(() => true).catch(() => false)) found.push(target);
      else await walk(target);
    }
  }
  await walk(path.join(rootDirectory, "testpacks"));
  return found;
}
let failed = false;
for (const pack of await packsFrom(process.argv.slice(2))) {
  try {
    const contract = await loadExecutionContract(rootDirectory, pack);
    console.log(`[执行契约] ${contract.packPath}（${contract.caseIds.length} 条） ✓`);
  } catch (error) {
    failed = true;
    console.error(`[执行契约] ✗ ${error.message}`);
  }
}
if (failed) process.exitCode = 1;
