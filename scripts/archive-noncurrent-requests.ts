import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync
} from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const unsupportedArgs = args.filter((argument) => argument !== "--dry-run");
const archiveStamp = new Date()
  .toISOString()
  .replace(/[-:]/g, "")
  .replace(/\.\d{3}Z$/, "")
  .replace("T", "-");

const CURRENT_WORKFLOW_VERSION = "v7";
const CURRENT_PLAN_MARKERS = [
  "test-design-index-v3",
  "rule-design-ledger-v3",
  "case-relation-projection-v3"
] as const;
const CURRENT_TESTCASE_MARKER = "testcase-v6-layered";
const TERMINAL_EVENT_TYPES = new Set(["WorkflowCompleted", "WorkflowCancelled"]);

if (unsupportedArgs.length > 0) {
  throw new Error(`Unsupported arguments: ${unsupportedArgs.join(", ")}. Only --dry-run is supported.`);
}

export interface RequestVersionInspection {
  requestId: string;
  requestRoot: string;
  current: boolean;
  reasons: string[];
  testRoot?: string;
  destination: string;
}

const inspections = inspectRequests(projectRoot, archiveStamp);
const currentRequests = inspections.filter((inspection) => inspection.current);
const archiveRequests = inspections.filter((inspection) => !inspection.current);
const conflicts = archiveRequests.flatMap(preflightIssues);

console.log(`保留当前版本请求：${currentRequests.length} 项。`);
console.log(`${dryRun ? "将" : ""}归档非当前版本请求：${archiveRequests.length} 项。`);
for (const inspection of archiveRequests) {
  console.log(`- ${inspection.requestId}：${inspection.reasons.join("；")}`);
}

if (conflicts.length > 0) {
  console.error(`非当前请求归档已停止：${conflicts.join("；")}。`);
  console.error("归档范围无法安全确定；未移动任何文件。");
  process.exit(2);
}

if (dryRun) {
  console.log("Dry run 完成：未移动或删除文件；运行产物、认证、台账、来源、稳定套件及当前版本请求均未处理。");
  process.exit(0);
}

for (const inspection of archiveRequests) {
  movePath(inspection.requestRoot, inspection.destination);
  if (inspection.testRoot) {
    movePath(inspection.testRoot, resolve(inspection.destination, "automation/tests"));
  }
  console.log(`已归档 ${inspection.requestId} -> ${relative(projectRoot, inspection.destination)}`);
}

removeEmptyDirectories(resolve(projectRoot, "testcases"));
removeEmptyDirectories(resolve(projectRoot, "tests"));
console.log(`非当前请求归档完成：${archiveRequests.length} 个请求；${currentRequests.length} 个当前版本请求保持原位。`);

export function inspectRequests(root: string, stamp: string): RequestVersionInspection[] {
  const testcaseRoot = resolve(root, "testcases");
  const testsRoot = resolve(root, "tests");
  return collectRequestIds(testcaseRoot).map((requestId) => {
    const requestRoot = resolve(testcaseRoot, requestId);
    const testRoot = resolve(testsRoot, requestId);
    const reasons = inspectRequestVersion(requestRoot, requestId);
    const requestName = basename(requestRoot);
    return {
      requestId,
      requestRoot,
      current: reasons.length === 0,
      reasons,
      ...(existsSync(testRoot) ? { testRoot } : {}),
      destination: resolve(
        testcaseRoot,
        "archive",
        dirname(requestId),
        `${requestName}-archived-${stamp}`
      )
    };
  });
}

function inspectRequestVersion(requestRoot: string, requestId: string): string[] {
  const reasons: string[] = [];
  const plan = readFileSync(resolve(requestRoot, "plan.md"), "utf8");
  const missingPlanMarkers = CURRENT_PLAN_MARKERS.filter((marker) => !plan.includes(marker));
  if (missingPlanMarkers.length > 0) {
    reasons.push(`plan 非当前版本（缺少 ${missingPlanMarkers.join("、")}）`);
  }

  const historyPath = resolve(requestRoot, "workflow-history.ndjson");
  if (!existsSync(historyPath)) {
    reasons.push("缺少 workflow-history.ndjson");
  } else {
    try {
      const firstLine = readFileSync(historyPath, "utf8")
        .split("\n")
        .find((line) => line.trim().length > 0);
      const firstEvent = firstLine ? JSON.parse(firstLine) as Record<string, unknown> : undefined;
      if (!firstEvent || firstEvent.type !== "WorkflowStarted") {
        reasons.push("workflow history 缺少有效 WorkflowStarted");
      } else {
        if (firstEvent.requestId !== requestId) reasons.push("workflow requestId 与目录不一致");
        if (firstEvent.definitionVersion !== CURRENT_WORKFLOW_VERSION) {
          reasons.push(`workflow ${String(firstEvent.definitionVersion ?? "unknown")} 非当前 ${CURRENT_WORKFLOW_VERSION}`);
        }
      }
    } catch {
      reasons.push("workflow history 首事件无法解析");
    }
  }

  const caseFiles = readdirSync(requestRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^(?:cases|cases-[a-z0-9][a-z0-9-]*)\.md$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const oldCaseFiles = caseFiles.filter((name) =>
    !readFileSync(resolve(requestRoot, name), "utf8").includes(CURRENT_TESTCASE_MARKER)
  );
  if (oldCaseFiles.length > 0) {
    reasons.push(`用例非当前 ${CURRENT_TESTCASE_MARKER}（${oldCaseFiles.join("、")}）`);
  }
  return reasons;
}

function collectRequestIds(testcaseRoot: string): string[] {
  if (!existsSync(testcaseRoot)) return [];
  const requestIds: string[] = [];
  for (const type of readdirSync(testcaseRoot, { withFileTypes: true })) {
    if (!type.isDirectory() || type.name.startsWith(".") || type.name.startsWith("_") || type.name === "archive") continue;
    for (const project of readdirSync(resolve(testcaseRoot, type.name), { withFileTypes: true })) {
      if (!project.isDirectory() || project.name.startsWith(".") || project.name.startsWith("_") || ["shared", "common"].includes(project.name)) continue;
      for (const request of readdirSync(resolve(testcaseRoot, type.name, project.name), { withFileTypes: true })) {
        if (
          request.isDirectory()
          && !request.name.startsWith(".")
          && !request.name.startsWith("_")
          && request.name !== "suites"
          && existsSync(resolve(testcaseRoot, type.name, project.name, request.name, "plan.md"))
        ) {
          requestIds.push(`${type.name}/${project.name}/${request.name}`);
        }
      }
    }
  }
  return requestIds.sort();
}

function preflightIssues(inspection: RequestVersionInspection): string[] {
  const issues: string[] = [];
  if (existsSync(inspection.destination)) {
    issues.push(`归档目标已存在：${relative(projectRoot, inspection.destination)}`);
  }
  if (findSymbolicLinks(inspection.requestRoot).length > 0) {
    issues.push(`请求包含符号链接：${inspection.requestId}`);
  }
  if (inspection.testRoot && findSymbolicLinks(inspection.testRoot).length > 0) {
    issues.push(`请求测试实现包含符号链接：${inspection.requestId}`);
  }
  if (existsSync(resolve(inspection.requestRoot, "automation/tests")) && inspection.testRoot) {
    issues.push(`请求归档目标会产生重复 automation/tests：${inspection.requestId}`);
  }
  const lastEvent = lastHistoryEvent(resolve(inspection.requestRoot, "workflow-history.ndjson"));
  if (!lastEvent || !TERMINAL_EVENT_TYPES.has(String(lastEvent.type))) {
    issues.push(`工作流未到终态：${inspection.requestId}；先推进到 WorkflowCompleted/WorkflowCancelled 再归档`);
  }
  const runtimeConflict = inFlightRuntimeConflict(inspection.requestId);
  if (runtimeConflict) issues.push(runtimeConflict);
  return issues;
}

function lastHistoryEvent(historyPath: string): Record<string, unknown> | undefined {
  if (!existsSync(historyPath)) return undefined;
  const lastLine = readFileSync(historyPath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .at(-1);
  if (!lastLine) return undefined;
  try {
    return JSON.parse(lastLine) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function inFlightRuntimeConflict(requestId: string): string | undefined {
  const runtimePath = resolve(projectRoot, ".local/test-task-runtime", ...requestId.split("/"), "runtime.json");
  if (!existsSync(runtimePath)) return undefined;
  let runtime: Record<string, unknown>;
  try {
    runtime = JSON.parse(readFileSync(runtimePath, "utf8")) as Record<string, unknown>;
  } catch {
    return `runtime.json 无法解析：${requestId}；确认为无在途回合后可删除该可丢弃 runtime 目录再重试`;
  }
  const now = Date.now();
  const leases = (runtime.leases ?? {}) as Record<string, Record<string, unknown>>;
  const activeLease = Object.values(leases).find((lease) =>
    typeof lease.releasedAt !== "string"
    && (typeof lease.expiresAt !== "string" || Date.parse(lease.expiresAt) > now));
  if (activeLease) {
    return `存在在途 Activity 租约：${requestId}；等待该回合结束或租约过期后重试`;
  }
  const reviewers = (runtime.reviewerBindings ?? {}) as Record<string, Record<string, unknown>>;
  if (Object.values(reviewers).some((binding) => binding.status === "running")) {
    return `存在运行中的 reviewer 绑定：${requestId}；等待 reviewer 结束或确认其已退出后重试`;
  }
  return undefined;
}

function findSymbolicLinks(root: string): string[] {
  if (!existsSync(root)) return [];
  const links: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (lstatSync(path).isSymbolicLink()) links.push(path);
    else if (entry.isDirectory()) links.push(...findSymbolicLinks(path));
  }
  return links;
}

function movePath(source: string, destination: string): void {
  mkdirSync(dirname(destination), { recursive: true });
  if (existsSync(destination)) throw new Error(`Archive destination already exists: ${relative(projectRoot, destination)}`);
  renameSync(source, destination);
}

function removeEmptyDirectories(directory: string): void {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) removeEmptyDirectories(resolve(directory, entry.name));
  }
  if (readdirSync(directory).length === 0) rmSync(directory, { recursive: true, force: true });
}
