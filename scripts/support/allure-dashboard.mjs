import fs from "node:fs/promises";
import path from "node:path";

const DASHBOARD_REPORT_ID = "allure-dashboard";
const MAX_REQUESTS = 5;
const DASHBOARD_HISTORY_LIMIT = 50;
const DASHBOARD_REPORT_NAME = "开放平台自动化测试报告（最近 5 个请求）";

function collectAttachments(node, collected = []) {
  if (!node || typeof node !== "object") return collected;
  if (Array.isArray(node.attachments)) collected.push(...node.attachments);
  for (const step of node.steps ?? []) collectAttachments(step, collected);
  return collected;
}

function requestDate(manifest) {
  const timestamp = manifest.finishedAt ?? manifest.startedAt ?? new Date().toISOString();
  return new Date(timestamp).toISOString().slice(0, 10);
}

function requestKey(date, reportId) {
  return `${date}--${reportId}`.replaceAll(/[^A-Za-z0-9._-]/gu, "_");
}

function displayDate(date) {
  return `执行日期：${date}`;
}

function isDashboardDate(segment) {
  return typeof segment === "string" && /^(?:执行日期：)?\d{4}-\d{2}-\d{2}$/u.test(segment);
}

function businessTitlePath(titlePath) {
  const specIndex = titlePath.findIndex(
    (segment) => typeof segment === "string" && /\.spec\.[cm]?[jt]sx?$/u.test(segment)
  );
  return specIndex >= 0 && specIndex < titlePath.length - 1 ? titlePath.slice(specIndex + 1) : titlePath;
}

function decorateResult(result, date, reportId) {
  const existingPath = Array.isArray(result.titlePath) ? result.titlePath : [];
  // 已在共享首页的历史结果会再次经过规范化；先去掉已有请求前缀，避免重复嵌套。
  const originalPath = isDashboardDate(existingPath[0]) && typeof existingPath[1] === "string"
    ? existingPath.slice(2)
    : existingPath;
  // 共享首页仅展示执行日期、请求标识及业务语义，避免技术路径形成冗长且误导的套件层级。
  const titlePath = [displayDate(date), reportId, ...businessTitlePath(originalPath)];
  result.titlePath = titlePath;
  if (Array.isArray(result.labels)) {
    const label = result.labels.find((item) => item?.name === "titlePath");
    if (label) label.value = ` > ${titlePath.join(" > ")}`;
    else result.labels.push({ name: "titlePath", value: ` > ${titlePath.join(" > ")}` });
  }
}

async function normalizeDashboardTitlePaths(resultsDirectory) {
  const files = (await fs.readdir(resultsDirectory)).filter((file) => file.endsWith("-result.json"));
  await Promise.all(files.map(async (file) => {
    const target = path.join(resultsDirectory, file);
    const result = JSON.parse(await fs.readFile(target, "utf8"));
    const titlePath = Array.isArray(result.titlePath) ? result.titlePath : [];
    if (!isDashboardDate(titlePath[0]) || typeof titlePath[1] !== "string") return;
    const date = titlePath[0].replace("执行日期：", "");
    decorateResult(result, date, titlePath[1]);
    await fs.writeFile(target, JSON.stringify(result), "utf8");
  }));
}

async function writeJsonAtomic(target, value) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, target);
}

async function acquireLock(lockPath) {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  for (let waited = 0; waited < 15_000; waited += 100) {
    try {
      const handle = await fs.open(lockPath, "wx");
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`, "utf8");
      await handle.close();
      return async () => fs.rm(lockPath, { force: true });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("共享 Allure 首页正在更新，请稍后重试。");
}

async function readRegistry(registryPath) {
  try {
    const parsed = JSON.parse(await fs.readFile(registryPath, "utf8"));
    return Array.isArray(parsed.requests) ? parsed : { schema: "allure-dashboard-v1", requests: [] };
  } catch {
    return { schema: "allure-dashboard-v1", requests: [] };
  }
}

async function removeRequestFiles(resultsDirectory, request) {
  await Promise.all((request.files ?? []).map((file) => fs.rm(path.join(resultsDirectory, file), { force: true })));
}

/**
 * 将一个请求的最终结果纳入共享首页输入池。调用者负责随后生成 Allure HTML；锁覆盖整个复制和淘汰过程，
 * 以避免两个测试请求同时完成时互相覆盖。
 */
export async function mergeRequestIntoAllureDashboard({ rootDirectory, requestDirectories, reportId, generate }) {
  const dashboardDirectory = path.join(rootDirectory, "testpacks", "artifacts", "allure-dashboard");
  const resultsDirectory = path.join(dashboardDirectory, "allure-results");
  const registryPath = path.join(dashboardDirectory, "registry.json");
  const releaseLock = await acquireLock(path.join(dashboardDirectory, ".update.lock"));
  try {
    const manifest = JSON.parse(await fs.readFile(requestDirectories.manifestPath, "utf8"));
    const date = requestDate(manifest);
    const key = requestKey(date, reportId);
    const registry = await readRegistry(registryPath);
    const previous = registry.requests.find((item) => item.reportId === reportId);
    if (previous) await removeRequestFiles(resultsDirectory, previous);

    const sourceFiles = (await fs.readdir(requestDirectories.resultsDirectory))
      .filter((file) => file.endsWith("-result.json"));
    const files = [];
    await fs.mkdir(resultsDirectory, { recursive: true });
    for (const sourceFile of sourceFiles) {
      const result = JSON.parse(await fs.readFile(path.join(requestDirectories.resultsDirectory, sourceFile), "utf8"));
      decorateResult(result, date, reportId);
      const copiedSources = new Map();
      for (const attachment of collectAttachments(result)) {
        if (!attachment.source) continue;
        const originalSource = attachment.source;
        let targetName = copiedSources.get(originalSource);
        if (!targetName) {
          targetName = `${key}--${path.basename(originalSource)}`;
          try {
            await fs.copyFile(
              path.join(requestDirectories.resultsDirectory, originalSource),
              path.join(resultsDirectory, targetName)
            );
          } catch (error) {
            // 旧报告可能引用已在历史清理中移除的媒体；保留用例结果，不让一个失效附件阻断整份共享报告。
            if (error?.code !== "ENOENT") throw error;
            delete attachment.source;
            continue;
          }
          copiedSources.set(originalSource, targetName);
          files.push(targetName);
        }
        attachment.source = targetName;
      }
      const resultName = `${key}--${sourceFile}`;
      await fs.writeFile(path.join(resultsDirectory, resultName), JSON.stringify(result), "utf8");
      files.push(resultName);
    }

    const current = { reportId, date, completedAt: new Date().toISOString(), files };
    registry.requests = [...registry.requests.filter((item) => item.reportId !== reportId), current]
      .sort((left, right) => right.completedAt.localeCompare(left.completedAt));
    const expired = registry.requests.slice(MAX_REQUESTS);
    for (const request of expired) await removeRequestFiles(resultsDirectory, request);
    registry.requests = registry.requests.slice(0, MAX_REQUESTS);
    await normalizeDashboardTitlePaths(resultsDirectory);
    await writeJsonAtomic(registryPath, registry);
    await writeJsonAtomic(path.join(dashboardDirectory, "manifest.json"), {
      reportId: DASHBOARD_REPORT_ID,
      updatedAt: new Date().toISOString(),
      requests: registry.requests.map(({ reportId: id, date: requestDay, completedAt }) => ({ reportId: id, date: requestDay, completedAt }))
    });
    await fs.writeFile(
      path.join(dashboardDirectory, "index.html"),
      "<!doctype html><meta http-equiv=\"refresh\" content=\"0; url=allure-report/index.html\">",
      "utf8"
    );
    const dashboard = {
      dashboardDirectory,
      resultsDirectory,
      reportDirectory: path.join(dashboardDirectory, "allure-report"),
      historyPath: path.join(dashboardDirectory, "allure-history.jsonl"),
      historyLimit: DASHBOARD_HISTORY_LIMIT,
      reportName: DASHBOARD_REPORT_NAME,
      requestCount: registry.requests.length
    };
    if (typeof generate === "function") await generate(dashboard);
    return dashboard;
  } finally {
    await releaseLock();
  }
}
