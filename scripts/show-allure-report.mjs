import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { requestArtifactDirectories } from "./support/request-report-location.mjs";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const packs = args.flatMap((value, index) => value === "--pack" && args[index + 1] ? [path.resolve(rootDirectory, args[index + 1])] : []);
const reportIdIndex = args.indexOf("--report-id");
const reportId = reportIdIndex === -1 ? undefined : args[reportIdIndex + 1];
if (packs.length === 0 || !reportId) throw new Error("用法：npm run report:allure -- --report-id <请求报告标识> --pack <功能包> [--pack <功能包> ...]");
const directories = requestArtifactDirectories(rootDirectory, packs, reportId);
try {
  await fs.access(path.join(directories.reportDirectory, "index.html"));
} catch {
  throw new Error(`未找到请求 ${reportId} 的当前 Allure 明细：${path.relative(rootDirectory, directories.reportDirectory)}。请先运行 npm run test:fast。`);
}
const server = spawn(process.execPath, [path.join(rootDirectory, "scripts", "serve-report.mjs"), "--dir", directories.currentDirectory], { stdio: "inherit" });
server.on("exit", (code) => { process.exitCode = code ?? 0; });
