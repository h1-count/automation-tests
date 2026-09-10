import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findDurableReport } from "./support/request-report-location.mjs";
import { expandPrerequisites } from "./support/test-execution-contract.mjs";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportIdIndex = process.argv.indexOf("--report-id");
const reportId = reportIdIndex === -1 ? undefined : process.argv[reportIdIndex + 1];
if (!reportId) throw new Error("用法：npm run test:fast:repair -- --report-id <请求报告标识>");
const reportPath = await findDurableReport(rootDirectory, reportId);
if (!reportPath) throw new Error(`未找到长期报告：${reportId}`);
const content = await fs.readFile(reportPath, "utf8");
const start = content.indexOf("<!-- automation-report-data");
const end = content.indexOf("-->", start);
if (start < 0 || end < 0) throw new Error("旧报告不包含可复测机器数据；请先完整运行一次建立新基线");
const report = JSON.parse(content.slice(start + "<!-- automation-report-data".length, end).trim());
if (!Array.isArray(report.caseCatalog) || report.caseCatalog.length === 0) throw new Error("旧报告不包含用例执行目录；请先完整运行一次建立新基线");

const failed = report.caseCatalog.filter((item) => !report.cases?.[item.key] || report.cases[item.key].status !== "passed");
if (failed.length === 0) throw new Error("没有失败或未执行用例，无需修复复测");
const selectedByPack = new Map();
for (const item of failed) {
  const current = selectedByPack.get(item.packPath) ?? new Set();
  current.add(item.caseId);
  selectedByPack.set(item.packPath, current);
}
for (const [packPath, selected] of selectedByPack) {
  const contract = { dependsOn: Object.fromEntries(report.caseCatalog.filter((item) => item.packPath === packPath).map((item) => [item.caseId, item.dependsOn ?? []])) };
  selectedByPack.set(packPath, new Set(expandPrerequisites(contract, [...selected])));
}
const allPacks = [...new Set(report.caseCatalog.map((item) => item.packPath))];
async function specFor(packPath) {
  const directory = path.join(rootDirectory, "testpacks", packPath);
  const files = (await fs.readdir(directory)).filter((name) => name.endsWith(".spec.ts"));
  if (files.length !== 1) throw new Error(`${packPath} 必须且只能有一个 *.spec.ts 才能局部复测`);
  return path.join("testpacks", packPath, files[0]);
}
function invoke(argumentsList) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(rootDirectory, "scripts", "run-fast-tests.mjs"), ...argumentsList], { cwd: rootDirectory, stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}
const reportArguments = allPacks.flatMap((pack) => ["--report-pack", path.join("testpacks", pack)]);
const targetPacks = [...selectedByPack.keys()].sort();
const targetIds = [...new Set([...selectedByPack.values()].flatMap((items) => [...items]))].sort();
const targetedExit = await invoke(["--report-id", reportId, "--run-mode", "targeted_repair", "--case-ids", targetIds.join(","), ...reportArguments, ...await Promise.all(targetPacks.map(specFor))]);
if (targetedExit !== 0) process.exit(targetedExit);
const updatedContent = await fs.readFile(reportPath, "utf8");
const updatedStart = updatedContent.indexOf("<!-- automation-report-data");
const updatedEnd = updatedContent.indexOf("-->", updatedStart);
const updatedReport = JSON.parse(updatedContent.slice(updatedStart + "<!-- automation-report-data".length, updatedEnd).trim());
const unresolved = targetIds.filter((id) => {
  const item = updatedReport.caseCatalog.find((candidate) => candidate.caseId === id);
  return !item || updatedReport.cases?.[item.key]?.status !== "passed";
});
if (unresolved.length > 0) {
  process.stderr.write(`局部复测未全部通过，不进入影响回归：${unresolved.join("、")}\n`);
  process.exitCode = 1;
  process.exit();
}

const impacted = new Set(targetPacks);
let changed = true;
while (changed) {
  changed = false;
  for (const dependency of report.dependencies ?? []) {
    if (impacted.has(dependency.from) && !impacted.has(dependency.to)) { impacted.add(dependency.to); changed = true; }
  }
}
const impactPacks = [...impacted].sort();
const impactExit = await invoke(["--report-id", reportId, "--run-mode", "impact_regression", ...reportArguments, ...await Promise.all(impactPacks.map(specFor))]);
process.exitCode = impactExit;
