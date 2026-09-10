import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testpacksDirectory = path.join(rootDirectory, "testpacks");
const playwrightCli = path.join(rootDirectory, "node_modules", "@playwright", "test", "cli.js");
const allureCli = path.join(rootDirectory, "node_modules", ".bin", process.platform === "win32" ? "allure.cmd" : "allure");
const caseIdPattern = /OP-[A-Z]+-\d{3}/g;
const { requestArtifactDirectories } = await import("./support/request-report-location.mjs");
const { hasGeneratedData, readRequestPlan, validateRequestPlan } = await import("./support/test-request-plan.mjs");
const { startReportServer, stopReportServer } = await import("./support/report-server.mjs");
const { loadExecutionContract } = await import("./support/test-execution-contract.mjs");

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

function timestampId() {
  return `${new Date().toISOString().replace(/[-:.]/gu, "")}-${randomUUID().slice(0, 8)}`;
}

function packSlug(packDirectory) {
  return path.relative(testpacksDirectory, packDirectory).replaceAll(path.sep, "__");
}

async function prepareCurrentArtifacts(reportId, packDirectories, requestPlanPath, manifestExtra = {}) {
  const directories = requestArtifactDirectories(rootDirectory, packDirectories, reportId);
  const preservedPlan = requestPlanPath ? await fs.readFile(requestPlanPath, "utf8") : undefined;
  let preservedDesignSummary;
  if (requestPlanPath) {
    try { preservedDesignSummary = await fs.readFile(path.join(path.dirname(requestPlanPath), "design-summary.json"), "utf8"); } catch { /* 设计汇总可不存在 */ }
  }
  // 初始全量建立新基线；补测和影响回归只能覆盖请求级聚合中的命中用例。
  if (manifestExtra.runMode === "initial_full") await fs.rm(directories.currentDirectory, { recursive: true, force: true });
  await fs.mkdir(directories.currentDirectory, { recursive: true });
  await fs.rm(directories.attemptDirectory, { recursive: true, force: true });
  await fs.mkdir(directories.attemptDirectory, { recursive: true });
  const manifest = {
    schema: "test-request-current-run-v1",
    reportId,
    startedAt: new Date().toISOString(),
    packs: packDirectories.map((directory) => path.relative(rootDirectory, directory).replaceAll(path.sep, "/")).sort(),
    ...manifestExtra
  };
  await fs.writeFile(directories.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  if (preservedPlan) await fs.writeFile(directories.requestPlanPath, preservedPlan, "utf8");
  if (preservedDesignSummary) await fs.writeFile(directories.designSummaryPath, preservedDesignSummary, "utf8");
  return directories;
}

function resultPackPath(result, packDirectories) {
  const source = `${result.fullName ?? ""} ${(result.labels ?? []).map((label) => label.value).join(" ")}`.replaceAll("\\", "/");
  return packDirectories
    .map((directory) => path.relative(testpacksDirectory, directory).replaceAll(path.sep, "/"))
    .find((candidate) => source.includes(candidate));
}

function resultKeys(result, packDirectories) {
  const packPath = resultPackPath(result, packDirectories);
  const ids = [...new Set(`${result.name ?? ""} ${result.fullName ?? ""}`.match(caseIdPattern) ?? [])];
  return packPath && ids.length ? ids.map((id) => `${packPath}:${id}`) : [];
}

async function mergeAttemptIntoAggregate(directories, packDirectories) {
  let entries;
  try { entries = await fs.readdir(directories.attemptResultsDirectory, { withFileTypes: true }); } catch { return; }
  await fs.mkdir(directories.resultsDirectory, { recursive: true });
  let index = {};
  try { index = JSON.parse(await fs.readFile(directories.aggregateIndexPath, "utf8")); } catch { /* 新基线 */ }
  for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith("-result.json"))) {
    const resultPath = path.join(directories.attemptResultsDirectory, entry.name);
    const result = JSON.parse(await fs.readFile(resultPath, "utf8"));
    const keys = resultKeys(result, packDirectories);
    if (keys.length === 0) continue;
    const canonical = keys.join("__").replaceAll(/[^A-Za-z0-9_-]/gu, "_");
    const previousFiles = [...new Set(keys.flatMap((key) => index[key]?.files ?? []))];
    await Promise.all(previousFiles.map((file) => fs.rm(path.join(directories.resultsDirectory, file), { force: true })));
    const files = [];
    for (const attachment of result.attachments ?? []) {
      if (!attachment.source) continue;
      const source = path.join(directories.attemptResultsDirectory, attachment.source);
      const targetName = `${canonical}--${attachment.source}`;
      try { await fs.copyFile(source, path.join(directories.resultsDirectory, targetName)); attachment.source = targetName; files.push(targetName); } catch { /* 缺失附件不影响结果 */ }
    }
    const resultName = `${canonical}-result.json`;
    await fs.writeFile(path.join(directories.resultsDirectory, resultName), JSON.stringify(result), "utf8");
    files.push(resultName);
    for (const key of keys) index[key] = { files };
  }
  await fs.writeFile(directories.aggregateIndexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  await fs.rm(directories.attemptDirectory, { recursive: true, force: true });
}

async function acquireReportRunLock(directories) {
  await fs.mkdir(path.dirname(directories.runLockPath), { recursive: true });
  try {
    const handle = await fs.open(directories.runLockPath, "wx");
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`, "utf8");
    await handle.close();
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    let owner = {};
    try { owner = JSON.parse(await fs.readFile(directories.runLockPath, "utf8")); } catch { /* 锁文件损坏同样按占用处理 */ }
    let alive = false;
    if (Number.isInteger(owner.pid)) {
      try { process.kill(owner.pid, 0); alive = true; } catch { /* 已退出的进程留下的是陈旧锁 */ }
    }
    if (alive) throw new Error(`请求 ${path.basename(directories.currentDirectory)} 正在执行（pid ${owner.pid}）；同一 report-id 不允许并发复测`);
    await fs.rm(directories.runLockPath, { force: true });
    return acquireReportRunLock(directories);
  }
  return async () => fs.rm(directories.runLockPath, { force: true });
}

async function hasLiveReportRunLock(lockPath) {
  let owner;
  try { owner = JSON.parse(await fs.readFile(lockPath, "utf8")); } catch { return false; }
  if (!Number.isInteger(owner.pid)) return false;
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch {
    await fs.rm(lockPath, { force: true });
    return false;
  }
}

// 当前目录不是归档：保留仍在执行的并发请求，下一次请求启动时回收已完成请求的完整 Allure 材料。
// 可提交的 Markdown 与 runtime/ 下的历史、台账均不在此清理范围内。
async function cleanupCompletedCurrentArtifacts(directories) {
  let entries;
  try { entries = await fs.readdir(directories.currentRootDirectory, { withFileTypes: true }); } catch { return []; }
  const removed = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === path.basename(directories.currentDirectory)) continue;
    const candidateDirectory = path.join(directories.currentRootDirectory, entry.name);
    const lockPath = path.join(directories.assetRoot, "artifacts", ".locks", `${entry.name}.lock`);
    if (await hasLiveReportRunLock(lockPath)) continue;
    await stopReportServer(candidateDirectory);
    await fs.rm(candidateDirectory, { recursive: true, force: true });
    removed.push(entry.name);
  }
  return removed;
}

function runCommand(command, argumentsList, description, environment) {
  return new Promise((resolve) => {
    const child = spawn(command, argumentsList, { cwd: rootDirectory, stdio: "inherit", env: { ...process.env, ...environment } });
    child.on("error", (error) => {
      process.stderr.write(`无法${description}：${error.message}\n`);
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

function runPlaywright(specPath, passthroughArguments, requestDirectory, caseIds = []) {
  const packDirectory = path.dirname(specPath);
  const relativeSpecPath = path.relative(rootDirectory, specPath);
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [playwrightCli, "test", "--config=playwright.fast.config.ts", relativeSpecPath, ...(caseIds.length ? ["--grep", `(?:${caseIds.map((id) => id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|")})`] : []), ...passthroughArguments],
      {
        cwd: rootDirectory,
        env: { ...process.env, TEST_PACK_DIR: packDirectory, TEST_PACK_SLUG: packSlug(packDirectory), TEST_REQUEST_REPORT_DIR: requestDirectory },
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

// 全量 Allure 明细（含录屏/trace）仅在 artifacts/current/<report-id>/ 中重建。
// Allure 3 已移除 --clean：生成前先删输出目录；历史由独立 JSONL 限制为最近 20 次。
async function generateAllureReport(requestDirectories) {
  const { resultsDirectory, reportDirectory } = requestDirectories;
  try {
    const hasResults = await fs.stat(resultsDirectory).then(() => true).catch(() => false);
    if (!hasResults) return 0;
    await fs.rm(reportDirectory, { recursive: true, force: true });
    await fs.mkdir(path.dirname(requestDirectories.historyPath), { recursive: true });
    const exitCode = await runCommand(
      allureCli,
      ["generate", resultsDirectory, "--output", reportDirectory, "--config", path.join(rootDirectory, "allurerc.mjs"), "--history-limit", "20"],
      "生成全量 Allure 明细",
      { ALLURE_HISTORY_PATH: requestDirectories.historyPath }
    );
    if (exitCode === 0) {
      await fs.writeFile(
        path.join(requestDirectories.currentDirectory, "index.html"),
        "<!doctype html><meta http-equiv=\"refresh\" content=\"0; url=allure-report/index.html\">",
        "utf8"
      );
    }
    return exitCode;
  } catch (error) {
    process.stderr.write(`全量明细生成失败（不影响汇总页）：${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function numberAllureCases(resultsDirectory, packDirectories) {
  const sequence = new Map();
  let index = 1;
  for (const packDirectory of packDirectories.sort()) {
    const packKey = path.relative(rootDirectory, packDirectory).replaceAll(path.sep, "/");
    const cases = await fs.readFile(path.join(packDirectory, "cases.md"), "utf8");
    for (const id of cases.match(caseIdPattern) ?? []) {
      const key = `${packKey}:${id}`;
      if (!sequence.has(key)) sequence.set(key, index++);
    }
  }
  for (const entry of await fs.readdir(resultsDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith("-result.json")) continue;
    const resultPath = path.join(resultsDirectory, entry.name);
    const result = JSON.parse(await fs.readFile(resultPath, "utf8"));
    const id = result.name?.match(caseIdPattern)?.[0];
    const source = `${result.fullName ?? ""} ${(result.labels ?? []).map((label) => label.value).join(" ")}`.replaceAll("\\", "/");
    const packKey = packDirectories
      .map((directory) => path.relative(rootDirectory, directory).replaceAll(path.sep, "/"))
      .find((candidate) => source.includes(candidate));
    const number = id && packKey ? sequence.get(`${packKey}:${id}`) : undefined;
    if (!number || /^\d+\.\s/u.test(result.name)) continue;
    result.name = `${String(number).padStart(3, "0")}. ${result.name}`;
    await fs.writeFile(resultPath, JSON.stringify(result), "utf8");
  }
}

// 跑前健康探测（2026-09-02）：仅本地 dev server（127.0.0.1/localhost）需要。
// 首页 200 只能证明端口活着；Vite 按需编译的入口模块（/src/main.ts）能及时返回才说明转换管线健康。
// 卡顿窗口（模块请求挂起、渲染停顿）曾让 13 条用例拖到 48 分钟且 3 条超时——探测不过就提示重启后重跑，
// 从源头避免把整轮跑进卡顿窗口。FAST_SKIP_HEALTH_PROBE=1 可跳过。
async function probeLocalDevServer() {
  if (process.env.FAST_SKIP_HEALTH_PROBE === "1") return true;
  const baseURL = process.env.FAST_BASE_URL?.trim() || process.env.OPEN_PLATFORM_WEB_BASE_URL_TEST || "http://127.0.0.1:3098/";
  const { hostname } = new URL(baseURL);
  if (hostname !== "127.0.0.1" && hostname !== "localhost") return true;
  const checks = [
    { label: "首页可达", url: baseURL, timeoutMs: 5_000 },
    { label: "Vite 模块编译 /src/main.ts", url: new URL("/src/main.ts", baseURL).toString(), timeoutMs: 15_000 }
  ];
  for (const check of checks) {
    const startedAt = Date.now();
    try {
      const response = await fetch(check.url, { signal: AbortSignal.timeout(check.timeoutMs) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      process.stdout.write(`[健康探测] ${check.label} 正常（${response.status}，耗时 ${Date.now() - startedAt}ms）\n`);
    } catch (error) {
      process.stderr.write(
        `[健康探测] ${check.label} 未通过（${error.message}）。dev server 疑似处于卡顿窗口，整轮跑进去会成倍拖长，` +
          `建议重启前端 dev server 后重跑；确认要继续可设 FAST_SKIP_HEALTH_PROBE=1。\n`
      );
      return false;
    }
  }
  return true;
}

const rawArguments = process.argv.slice(2);
const reportIdIndex = rawArguments.indexOf("--report-id");
const requestedReportId = reportIdIndex === -1 ? undefined : rawArguments[reportIdIndex + 1];
if (reportIdIndex !== -1 && !requestedReportId) throw new Error("--report-id 需要一个请求报告标识，例如 login-register-001");
const requestPlanIndex = rawArguments.indexOf("--request-plan");
const requestPlanArgument = requestPlanIndex === -1 ? undefined : rawArguments[requestPlanIndex + 1];
if (requestPlanIndex !== -1 && !requestPlanArgument) throw new Error("--request-plan 需要 request-plan.json 路径");
const runModeIndex = rawArguments.indexOf("--run-mode");
const runMode = runModeIndex === -1 ? "initial_full" : rawArguments[runModeIndex + 1];
if (!new Set(["initial_full", "targeted_repair", "impact_regression"]).has(runMode)) throw new Error("--run-mode 非法");
const caseIdsIndex = rawArguments.indexOf("--case-ids");
const requestedCaseIds = caseIdsIndex === -1 ? [] : rawArguments[caseIdsIndex + 1]?.split(",").map((id) => id.trim()).filter(Boolean);
if (caseIdsIndex !== -1 && requestedCaseIds.length === 0) throw new Error("--case-ids 需要至少一个用例 ID");
const reportPacks = rawArguments.flatMap((value, index) => value === "--report-pack" && rawArguments[index + 1] ? [path.resolve(rootDirectory, rawArguments[index + 1])] : []);
// 未传 --request-plan 时 requestPlanIndex=-1，"index !== requestPlanIndex + 1" 会恒排除首参（spec 路径），
// 导致文档口径的单包命令静默回退全量收集（2026-09-09 修复）：仅在实际出现该旗标时剔除其自身与取值。
const argumentsList = rawArguments.filter((_, index) => {
  if (reportIdIndex !== -1 && (index === reportIdIndex || index === reportIdIndex + 1)) return false;
  if (requestPlanIndex !== -1 && (index === requestPlanIndex || index === requestPlanIndex + 1)) return false;
  if (runModeIndex !== -1 && (index === runModeIndex || index === runModeIndex + 1)) return false;
  if (caseIdsIndex !== -1 && (index === caseIdsIndex || index === caseIdsIndex + 1)) return false;
  if (rawArguments[index] === "--report-pack" || rawArguments[index - 1] === "--report-pack") return false;
  return true;
});
const explicitSpecArguments = argumentsList.filter(isSpecPath);
const passthroughArguments = argumentsList.filter((argument) => !isSpecPath(argument));
const specs = explicitSpecArguments.length > 0
  ? explicitSpecArguments.map((argument) => path.resolve(rootDirectory, argument))
  : await collectSpecs(testpacksDirectory);

if (specs.length === 0) {
  throw new Error("testpacks/ 中未找到 *.spec.ts 测试脚本。");
}

const requestPlanPath = requestPlanArgument ? path.resolve(rootDirectory, requestPlanArgument) : undefined;
const requestPlan = requestPlanPath ? await readRequestPlan(requestPlanPath) : undefined;
if (requestPlan) {
  const planProblems = validateRequestPlan(requestPlan);
  if (planProblems.length > 0) throw new Error(`请求计划未通过：${planProblems.join("；")}`);
  if (requestedReportId && requestedReportId !== requestPlan.reportId) throw new Error("--report-id 必须与 request-plan.json 的 reportId 一致");
}

if (!(await probeLocalDevServer())) {
  process.exitCode = 1;
} else {
  // 完整性闸门不允许用环境变量绕过：范围契约先于用例-脚本锚点，确保 Playwright 启动前即失败。
  const packSet = [...new Set(specs.map((specPath) => path.dirname(specPath)))];
  const reportPackSet = reportPacks.length ? [...new Set(reportPacks)] : packSet;
  if (packSet.some((pack) => !reportPackSet.includes(pack))) throw new Error("--report-pack 必须覆盖本轮实际执行的全部功能包");
  const packPaths = packSet.map((directory) => path.relative(testpacksDirectory, directory).replaceAll(path.sep, "/"));
  let orderedSpecs = [...specs].sort();
  if (requestPlan) {
    const plannedPacks = requestPlan.packs.map((pack) => pack.path);
    if (plannedPacks.length !== packPaths.length || plannedPacks.some((pack) => !packPaths.includes(pack))) {
      throw new Error("测试脚本所属功能包必须与 request-plan.json 完全一致");
    }
    const order = new Map(requestPlan.executionOrder.map((pack, index) => [pack, index]));
    orderedSpecs = [...specs].sort((left, right) => order.get(path.relative(testpacksDirectory, path.dirname(left)).replaceAll(path.sep, "/")) - order.get(path.relative(testpacksDirectory, path.dirname(right)).replaceAll(path.sep, "/")));
  }
  const scopeAuditExitCode = await runCommand(
    process.execPath,
    [path.join(rootDirectory, "scripts", "audit-case-completeness.mjs"), ...(requestPlanPath ? ["--request-plan", requestPlanPath] : []), ...packSet],
    "范围完整性检查"
  );
  if (scopeAuditExitCode !== 0) process.exitCode = 1;
  if (process.exitCode === undefined || process.exitCode === 0) {
    const coverageAuditExitCode = await runCommand(
      process.execPath,
      [path.join(rootDirectory, "scripts", "audit-case-coverage.mjs"), ...packSet],
      "用例-脚本完整性检查"
    );
    if (coverageAuditExitCode !== 0) process.exitCode = 1;
  }
  if (process.exitCode === undefined || process.exitCode === 0) {
    const executionAuditExitCode = await runCommand(
      process.execPath,
      [path.join(rootDirectory, "scripts", "audit-test-execution.mjs"), ...reportPackSet],
      "用例执行契约检查"
    );
    if (executionAuditExitCode !== 0) process.exitCode = 1;
  }
  if (process.exitCode === undefined || process.exitCode === 0) {
    let failed = false;
    const contracts = await Promise.all(reportPackSet.map((pack) => loadExecutionContract(rootDirectory, pack)));
    const contractByPack = new Map(contracts.map((contract) => [contract.packPath, contract]));
    const knownIds = new Set(contracts.flatMap((contract) => contract.caseIds));
    for (const id of requestedCaseIds) if (!knownIds.has(id)) throw new Error(`--case-ids 包含本次请求不存在的用例：${id}`);
    const reportId = requestedReportId ?? requestPlan?.reportId ?? `request-${timestampId()}`;
    const expectedDirectories = requestArtifactDirectories(rootDirectory, reportPackSet, reportId);
    if (requestPlan && path.resolve(requestPlanPath) !== path.resolve(expectedDirectories.requestPlanPath)) {
      throw new Error(`request-plan.json 必须位于本次请求公共目录的 artifacts/current/${reportId}/request-plan.json`);
    }
    const releaseRunLock = await acquireReportRunLock(expectedDirectories);
    try {
      const removedReports = await cleanupCompletedCurrentArtifacts(expectedDirectories);
      if (removedReports.length > 0) {
        process.stdout.write(`已清理 ${removedReports.length} 个已完成的旧 Allure 临时报告：${removedReports.join("、")}\n`);
      }
      // 复测前置检查：仅关闭同一 report-id 的上一轮服务，避免影响并发请求。
      const previousServer = await stopReportServer(expectedDirectories.currentDirectory);
      if (previousServer.stopped) {
        process.stdout.write(`已关闭上一轮报告服务（pid ${previousServer.pid}，端口 ${previousServer.port}）\n`);
      }
      if (runMode === "initial_full") await fs.rm(expectedDirectories.durableReportPath, { force: true });
      // 当前诊断目录只保存本轮证据；复测的历史结果由 Markdown 报告合并保存。
      const caseCatalog = contracts.flatMap((contract) => contract.caseIds.map((caseId) => ({
        key: `${contract.packPath}:${caseId}`, packPath: contract.packPath, caseId, dependsOn: contract.dependsOn[caseId]
      })));
      const plannedCaseIds = requestedCaseIds.length
        ? contracts.flatMap((contract) => contract.caseIds.filter((caseId) => requestedCaseIds.some((requested) => contract.titleByCaseId.get(requested) === contract.titleByCaseId.get(caseId))))
        : caseCatalog.filter((item) => packSet.some((pack) => item.packPath === path.relative(testpacksDirectory, pack).replaceAll(path.sep, "/"))).map((item) => item.caseId);
      const requestDirectories = await prepareCurrentArtifacts(reportId, reportPackSet, requestPlanPath, {
        executedPacks: packSet.map((directory) => path.relative(rootDirectory, directory).replaceAll(path.sep, "/")).sort(),
        runMode,
        plannedCaseIds,
        caseCatalog,
        dependencies: requestPlan?.dependencies?.filter((item) => item.status === "confirmed") ?? []
      });
      process.stdout.write(`当前 Allure：${path.relative(rootDirectory, requestDirectories.currentDirectory)}\n长期报告：${path.relative(rootDirectory, requestDirectories.durableReportPath)}（复测请追加 --report-id ${reportId}）\n`);
      const completedPacks = new Map();
      for (const specPath of orderedSpecs) {
        assertTestpack(specPath);
        const relativePack = path.relative(testpacksDirectory, path.dirname(specPath)).replaceAll(path.sep, "/");
        if (requestPlan) {
          for (const dependency of requestPlan.dependencies.filter((item) => item.status === "confirmed" && item.to === relativePack && item.kind === "runtime_data")) {
            if (completedPacks.get(dependency.from) !== 0 || !(await hasGeneratedData(rootDirectory, dependency.from))) {
              throw new Error(`下游功能包 ${relativePack} 需要上游 ${dependency.from} 的本轮运行数据，但上游未成功产生台账记录`);
            }
          }
        }
        const contract = contractByPack.get(relativePack);
        const selectedCaseIds = requestedCaseIds.filter((id) => contract.caseIds.includes(id));
        const exitCode = await runPlaywright(specPath, passthroughArguments, requestDirectories.attemptDirectory, selectedCaseIds);
        completedPacks.set(relativePack, exitCode);
        failed ||= exitCode !== 0;
      }
      await numberAllureCases(requestDirectories.attemptResultsDirectory, packSet);
      await mergeAttemptIntoAggregate(requestDirectories, packSet);
      const reportExitCode = await generateAllureReport(requestDirectories);
      failed ||= reportExitCode !== 0;
      const summaryExitCode = await runCommand(
        process.execPath,
        [path.join(rootDirectory, "scripts", "build-request-report.mjs"), "--current", requestDirectories.currentDirectory, "--output", requestDirectories.durableReportPath],
        "生成长期 Markdown 报告"
      );
      failed ||= summaryExitCode !== 0;
      // 自动拉起常驻报告服务并输出可点击链接（复测时运行器会先自动关闭本服务）。
      try {
        const server = await startReportServer(requestDirectories.currentDirectory);
        process.stdout.write(
          `报告服务已启动（后台常驻）：\n` +
          `  当前 Allure：${server.detailUrl}\n`
        );
      } catch (error) {
        process.stderr.write(`报告服务启动失败：${error instanceof Error ? error.message : String(error)}\n可手动打开：npm run report:allure -- --report-id ${reportId} --pack ${path.relative(rootDirectory, packSet[0])}\n`);
      }
      process.exitCode = failed ? 1 : 0;
    } finally {
      await releaseRunLock();
    }
  }
}
