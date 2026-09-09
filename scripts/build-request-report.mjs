import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const machineDataStart = "<!-- automation-report-data";
const machineDataEnd = "-->";

function required(name) {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (!value) throw new Error(`缺少 ${name}`);
  return value;
}

async function resultFiles(directory) {
  return (await fs.readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith("-result.json"))
    .map((entry) => path.join(directory, entry.name));
}

function markdownCell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function redact(value) {
  return String(value ?? "")
    .replace(/(password|passwd|token|secret|cookie|authorization)\s*[:=]\s*[^\s,;]+/giu, "$1=[已脱敏]")
    .replace(/Bearer\s+[\w.-]+/giu, "Bearer [已脱敏]")
    .slice(0, 500);
}

function resultKey(result) {
  return result.historyId ?? result.fullName ?? result.name;
}

function caseNumber(result) {
  const match = String(result.name ?? "").match(/^(\d+)\.\s/u);
  return match ? Number(match[1]) : undefined;
}

function failureSummary(result) {
  if (result.status === "passed") return "";
  return redact(result.statusDetails?.message ?? result.statusDetails?.trace?.split("\n")[0] ?? "");
}

async function loadPreviousReport(reportPath, reportId) {
  try {
    const content = await fs.readFile(reportPath, "utf8");
    const start = content.indexOf(machineDataStart);
    const end = content.indexOf(machineDataEnd, start);
    if (start < 0 || end < 0) throw new Error("缺少机器数据块");
    const report = JSON.parse(content.slice(start + machineDataStart.length, end).trim());
    if (report.schema !== "test-request-report-v1" || report.reportId !== reportId) throw new Error("报告标识或 schema 不匹配");
    return report;
  } catch (error) {
    if (error.code === "ENOENT") {
      return { schema: "test-request-report-v1", reportId, createdAt: new Date().toISOString(), packs: [], attempts: [], cases: {} };
    }
    throw new Error(`无法读取既有 Markdown 报告：${error.message}`);
  }
}

function makeMarkdown(report) {
  const rows = Object.values(report.cases).sort((left, right) => left.number - right.number);
  const statusCounts = Object.groupBy(rows, (item) => item.status ?? "unknown");
  return `${[
    `# 自动化测试报告：${report.reportId}`,
    "",
    `- 创建时间：${report.createdAt}`,
    `- 最后执行：${report.updatedAt}`,
    `- 功能包：${report.packs.join("、")}`,
    `- 请求执行批次：${report.attempts.length}`,
    `- 最终结果：${rows.length} 条；通过 ${statusCounts.passed?.length ?? 0}；失败 ${(statusCounts.failed?.length ?? 0) + (statusCounts.broken?.length ?? 0)}`,
    "",
    "| 序号 | 用例 | 最终状态 | 执行次数 | 来源 | 失败摘要 |",
    "| ---: | --- | --- | ---: | --- | --- |",
    ...rows.map((item) => `| #${item.number} | ${markdownCell(item.name)} | ${markdownCell(item.status)} | ${item.executions} | ${markdownCell(item.source)} | ${markdownCell(item.failureSummary || "—")} |`),
    "",
    "<!-- automation-report-data",
    JSON.stringify(report),
    "-->"
  ].join("\n")}\n`;
}

/** 从本轮 Allure 原始结果合并出唯一、可提交的 Markdown 结论。 */
export async function buildRequestReport({ currentDirectory, durableReportPath }) {
  const manifest = JSON.parse(await fs.readFile(path.join(currentDirectory, "manifest.json"), "utf8"));
  const resultsDirectory = path.join(currentDirectory, "allure-results");
  const results = await Promise.all((await resultFiles(resultsDirectory)).map(async (file) => JSON.parse(await fs.readFile(file, "utf8"))));
  const grouped = new Map();
  for (const result of results.sort((left, right) => (left.stop ?? 0) - (right.stop ?? 0))) {
    const key = resultKey(result);
    const attempts = grouped.get(key) ?? [];
    attempts.push(result);
    grouped.set(key, attempts);
  }

  const report = await loadPreviousReport(durableReportPath, manifest.reportId);
  let nextNumber = Math.max(0, ...Object.values(report.cases).map((item) => item.number)) + 1;
  report.packs = [...new Set([...report.packs, ...manifest.packs])].sort();
  report.attempts.push({ startedAt: manifest.startedAt, finishedAt: new Date().toISOString(), packs: manifest.packs });
  for (const [key, attempts] of grouped) {
    const result = attempts.at(-1);
    const previous = report.cases[key];
    const number = previous?.number ?? caseNumber(result) ?? nextNumber++;
    if (number >= nextNumber) nextNumber = number + 1;
    report.cases[key] = {
      number,
      name: String(result.name ?? previous?.name ?? key).replace(/^\d+\.\s/u, ""),
      status: result.status ?? "unknown",
      executions: (previous?.executions ?? 0) + attempts.length,
      source: result.fullName ?? previous?.source ?? "",
      failureSummary: failureSummary(result)
    };
  }
  report.updatedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(durableReportPath), { recursive: true });
  await fs.writeFile(durableReportPath, makeMarkdown(report), "utf8");
  return { reportPath: durableReportPath, testcaseCount: Object.keys(report.cases).length, attemptCount: report.attempts.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildRequestReport({
    currentDirectory: path.resolve(rootDirectory, required("--current")),
    durableReportPath: path.resolve(rootDirectory, required("--output"))
  }).then((summary) => process.stdout.write(`${JSON.stringify(summary)}\n`));
}
