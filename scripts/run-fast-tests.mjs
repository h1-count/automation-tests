import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testpacksDirectory = path.join(rootDirectory, "testpacks");
const playwrightCli = path.join(rootDirectory, "node_modules", "@playwright", "test", "cli.js");

async function collectSpecs(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "artifacts" || entry.name === "review") return [];
      return collectSpecs(entryPath);
    }
    return entry.name.endsWith(".spec.ts") ? [entryPath] : [];
  }));
  return nested.flat();
}

function isSpecPath(argument) {
  return argument.endsWith(".spec.ts");
}

function assertTestpack(specPath) {
  const relativePath = path.relative(testpacksDirectory, specPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`测试脚本必须位于 testpacks/：${specPath}`);
  }
}

function runPlaywright(specPath, passthroughArguments) {
  const packDirectory = path.dirname(specPath);
  const relativeSpecPath = path.relative(rootDirectory, specPath);
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [playwrightCli, "test", "--config=playwright.fast.config.ts", relativeSpecPath, ...passthroughArguments],
      {
        cwd: rootDirectory,
        env: { ...process.env, TEST_PACK_DIR: packDirectory },
        stdio: "inherit"
      }
    );
    child.on("error", (error) => {
      process.stderr.write(`无法启动 ${relativeSpecPath}：${error.message}\n`);
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

const argumentsList = process.argv.slice(2);
const explicitSpecArguments = argumentsList.filter(isSpecPath);
const passthroughArguments = argumentsList.filter((argument) => !isSpecPath(argument));
const specs = explicitSpecArguments.length > 0
  ? explicitSpecArguments.map((argument) => path.resolve(rootDirectory, argument))
  : await collectSpecs(testpacksDirectory);

if (specs.length === 0) {
  throw new Error("testpacks/ 中未找到 *.spec.ts 测试脚本。");
}

let failed = false;
for (const specPath of specs.sort()) {
  assertTestpack(specPath);
  const exitCode = await runPlaywright(specPath, passthroughArguments);
  failed ||= exitCode !== 0;
}
process.exitCode = failed ? 1 : 0;
