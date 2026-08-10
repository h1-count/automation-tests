import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
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

if (unsupportedArgs.length > 0) {
  throw new Error(`Unsupported arguments: ${unsupportedArgs.join(", ")}. Only --dry-run is supported.`);
}

const artifactsRoot = resolve(projectRoot, "artifacts");
const artifactFiles = collectFiles(artifactsRoot, new Set(["README.md", ".gitkeep"]));
const legacyArtifactDirectories = ["allure-results"]
  .map((directory) => resolve(projectRoot, directory))
  .filter(existsSync);
const legacyLocalTestDataRoot = resolve(projectRoot, ".local/test-data");
const legacyLocalTestDataEntries = listEntries(legacyLocalTestDataRoot);
const legacyTaskStateRoot = resolve(projectRoot, ".local/test-task-state");
const legacyTaskStateEntries = listEntries(legacyTaskStateRoot);
const localTaskRuntimeRoot = resolve(projectRoot, ".local/test-task-runtime");
const localTaskRuntimeEntries = listEntries(localTaskRuntimeRoot);
const authRoot = resolve(projectRoot, ".auth");
const authEntries = listEntries(authRoot);
const localTestLedgerRoot = resolve(projectRoot, ".local/test-ledger");
const ledgerAudit = auditLedger(localTestLedgerRoot);
const requestArchives = collectRequestArchives();
const orphanTestRequests = collectOrphanTestRequests();
const symbolicLinkIssues = [
  artifactsRoot,
  legacyLocalTestDataRoot,
  legacyTaskStateRoot,
  localTaskRuntimeRoot,
  authRoot,
  resolve(projectRoot, "testcases"),
  resolve(projectRoot, "tests")
].flatMap(findSymbolicLinks);
const archiveConflicts = requestArchives.flatMap((archive) => {
  if (existsSync(archive.destination)) {
    return [`归档目标已存在：${relative(projectRoot, archive.destination)}`];
  }
  if (
    archive.testcaseSource
    && archive.testSource
    && existsSync(resolve(archive.testcaseSource, "automation/tests"))
  ) {
    return [`请求已包含 automation/tests：${relative(projectRoot, archive.testcaseSource)}`];
  }
  return [];
});
if (existsSync(resolve(projectRoot, "archive/automation"))) {
  archiveConflicts.push("仍存在已退役的 archive/automation 归档根");
}
if (orphanTestRequests.length > 0) {
  archiveConflicts.push(`未归属到 plan.md 请求的测试目录：${orphanTestRequests.join("、")}`);
}
if (symbolicLinkIssues.length > 0) {
  archiveConflicts.push(`重置范围中包含符号链接：${symbolicLinkIssues.map((path) => relative(projectRoot, path)).join("、")}`);
}

printPlan("运行产物", artifactFiles.length, "清理");
printPlan("根目录遗留运行产物", legacyArtifactDirectories.length, "清理");
printPlan("旧本地测试数据缓存", legacyLocalTestDataEntries.length, "清理");
printPlan("旧 v11 本机任务状态", legacyTaskStateEntries.length, "清理");
printPlan("可丢弃的本机任务运行句柄", localTaskRuntimeEntries.length, "清理");
printPlan("本地认证会话", authEntries.length, "清理");
printPlan("活动请求及请求专属测试实现", requestArchives.length, "归档");

if (ledgerAudit.explicitResiduals.length > 0) {
  console.log(
    `保留本机残留台账：${ledgerAudit.explicitResiduals.length} 条资源已显式标记 retained/quarantined；reset 不会删除或归档其本机追踪记录。`
  );
}

if (ledgerAudit.blockers.length > 0) {
  const details = ledgerAudit.blockers
    .map((issue) => `${relative(projectRoot, issue.path)} (${issue.reason})`)
    .join("、");
  console.error(
    `完整重置已停止：发现 ${ledgerAudit.blockers.length} 条尚未收口或无法验证的本机台账记录：${details}。`
  );
  console.error(
    "请先运行 npm run test-data:recover，或把残留资源明确裁决为 retained/quarantined 后再重试；reset 不会静默归档或遗忘外部资源。"
  );
  process.exit(2);
}

if (archiveConflicts.length > 0) {
  console.error(`完整重置已停止：${archiveConflicts.join("；")}。`);
  console.error("归档目标不唯一；未移动或删除任何文件。");
  process.exit(2);
}

if (dryRun) {
  console.log(
    "Dry run 完成：未移动或删除文件。保留 sources、test-assets、项目测试经验、用户偏好、.env、.local/repositories、共享基础能力、正式历史归档及已明确保留的残留台账。"
  );
  process.exit(0);
}

removeEntries(artifactFiles);
removeEntries(legacyArtifactDirectories);
removeEntries(legacyLocalTestDataEntries);
removeEntries(legacyTaskStateEntries);
removeEntries(localTaskRuntimeEntries);
removeEntries(authEntries);

removeEmptyDirectories(legacyLocalTestDataRoot);
removeEmptyDirectories(legacyTaskStateRoot);
removeEmptyDirectories(localTaskRuntimeRoot);
removeEmptyDirectories(authRoot);

if (ledgerAudit.explicitResiduals.length === 0) {
  removeEntries(listEntries(localTestLedgerRoot));
  removeEmptyDirectories(localTestLedgerRoot);
}

for (const archive of requestArchives) {
  if (archive.testcaseSource) {
    movePath(archive.testcaseSource, archive.destination);
  } else {
    mkdirSync(archive.destination, { recursive: true });
  }
  if (archive.testSource) {
    movePath(archive.testSource, resolve(archive.destination, "automation/tests"));
  }
}

removeEmptyDirectories(resolve(projectRoot, "tests"));
removeEmptyDirectories(resolve(projectRoot, "testcases"));

console.log(
  `完整测试状态已重置：运行缓存已清理，${requestArchives.length} 个请求范围已统一归档到 testcases/archive；外部数据未被删除。`
);

function printPlan(label: string, count: number, action: "清理" | "归档") {
  console.log(`${dryRun ? "将" : ""}${action}${label}：${count} 项。`);
}

function listEntries(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).map((entry) => resolve(directory, entry));
}

function collectFiles(directory: string, preservedNames: Set<string>): string[] {
  if (!existsSync(directory)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".DS_Store" || preservedNames.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(path, preservedNames));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files.sort();
}

interface RequestArchive {
  requestId: string;
  testcaseSource?: string;
  testSource?: string;
  destination: string;
}

function collectRequestArchives(): RequestArchive[] {
  const testcaseRoot = resolve(projectRoot, "testcases");
  const testsRoot = resolve(projectRoot, "tests");
  const candidates = new Map<string, Omit<RequestArchive, "requestId" | "destination">>();

  for (const requestId of collectRequestDirectories(testcaseRoot, requestDirectoryOptions())) {
    if (!existsSync(resolve(testcaseRoot, requestId, "plan.md"))) continue;
    candidates.set(requestId, {
      ...candidates.get(requestId),
      testcaseSource: resolve(testcaseRoot, requestId)
    });
  }
  for (const requestId of collectRequestDirectories(testsRoot, sharedTestDirectoryOptions())) {
    if (!candidates.has(requestId)) continue;
    candidates.set(requestId, {
      ...candidates.get(requestId),
      testSource: resolve(testsRoot, requestId)
    });
  }

  return [...candidates.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([requestId, sources]) => ({
      requestId,
      ...sources,
      destination: resolve(testcaseRoot, "archive", archiveRequestPath(requestId))
    }));
}

function collectOrphanTestRequests(): string[] {
  const testcaseRoot = resolve(projectRoot, "testcases");
  const testsRoot = resolve(projectRoot, "tests");
  const planned = new Set(collectRequestDirectories(testcaseRoot, requestDirectoryOptions())
    .filter((requestId) => existsSync(resolve(testcaseRoot, requestId, "plan.md"))));
  return collectRequestDirectories(testsRoot, sharedTestDirectoryOptions())
    .filter((requestId) => !planned.has(requestId));
}

function sharedTestDirectoryOptions(): { excludedTypes: Set<string>; excludedProjects: Set<string> } {
  return {
    excludedTypes: new Set(["support", "shared", "common"]),
    excludedProjects: new Set(["shared", "common"])
  };
}

function requestDirectoryOptions(): { excludedTypes: Set<string>; excludedProjects: Set<string> } {
  return {
    excludedTypes: new Set(["archive"]),
    excludedProjects: new Set(["shared", "common"])
  };
}

function collectRequestDirectories(
  root: string,
  options: {
    excludedTypes: Set<string>;
    excludedProjects?: Set<string>;
  }
): string[] {
  if (!existsSync(root)) return [];
  const requestIds: string[] = [];
  for (const type of readdirSync(root, { withFileTypes: true })) {
    if (
      !type.isDirectory()
      || type.name.startsWith(".")
      || type.name.startsWith("_")
      || options.excludedTypes.has(type.name)
    ) {
      continue;
    }
    const typePath = resolve(root, type.name);
    for (const project of readdirSync(typePath, { withFileTypes: true })) {
      if (
        !project.isDirectory()
        || project.name.startsWith(".")
        || project.name.startsWith("_")
        || options.excludedProjects?.has(project.name)
      ) {
        continue;
      }
      const projectPath = resolve(typePath, project.name);
      for (const request of readdirSync(projectPath, { withFileTypes: true })) {
        if (
          request.isDirectory()
          && !request.name.startsWith(".")
          && !request.name.startsWith("_")
          && request.name !== "suites"
        ) {
          requestIds.push(`${type.name}/${project.name}/${request.name}`);
        }
      }
    }
  }
  return requestIds.sort();
}

function findSymbolicLinks(root: string): string[] {
  if (!existsSync(root)) return [];
  const links: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (lstatSync(path).isSymbolicLink()) {
      links.push(path);
    } else if (entry.isDirectory()) {
      links.push(...findSymbolicLinks(path));
    }
  }
  return links;
}

function archiveRequestPath(requestId: string): string {
  const segments = requestId.split("/");
  const requestName = segments.pop();
  if (!requestName) {
    throw new Error(`Invalid request id: ${requestId}`);
  }
  return [...segments, `${requestName}-archived-${archiveStamp}`].join("/");
}

interface LedgerIssue {
  path: string;
  reason: string;
}

interface LedgerAudit {
  blockers: LedgerIssue[];
  explicitResiduals: LedgerIssue[];
}

function auditLedger(root: string): LedgerAudit {
  const blockers: LedgerIssue[] = [];
  const explicitResiduals: LedgerIssue[] = [];
  if (!existsSync(root)) return { blockers, explicitResiduals };

  const controlledDirectories = new Set(["runs", "resources", "intents", "summaries", "formal"]);
  const controlledFiles = new Set(["README.md", "machine-id", "ledger.lock"]);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      if (!controlledDirectories.has(entry.name)) {
        blockers.push({ path, reason: "未知台账目录" });
      }
      continue;
    }
    if (!entry.isFile() || !controlledFiles.has(entry.name)) {
      blockers.push({ path, reason: "未知台账根文件" });
      continue;
    }
    if (entry.name === "machine-id") {
      const value = readFileSync(path, "utf8").trim();
      if (!/^machine-[a-f0-9-]{36}$/i.test(value)) {
        blockers.push({ path, reason: "machine-id 格式损坏" });
      }
    }
    if (entry.name === "ledger.lock") {
      blockers.push({ path, reason: "台账仍被锁定，可能有并发写入" });
    }
  }

  const runs = readLedgerDirectory(root, "runs", blockers);
  const resources = readLedgerDirectory(root, "resources", blockers);
  const intents = readLedgerDirectory(root, "intents", blockers);
  const summaries = readLedgerDirectory(root, "summaries", blockers);
  const formalRecords = readLedgerDirectory(root, "formal", blockers);
  const runById = new Map<string, LedgerJsonRecord>();
  const resourceById = new Map<string, LedgerJsonRecord>();
  const intentById = new Map<string, LedgerJsonRecord>();

  const runStatuses = new Set(["running", "passed", "failed", "interrupted", "recovered"]);
  const dataHygieneStatuses = new Set(["clean", "retained", "cleanup_failed", "manual_required"]);
  const dataWritePolicies = new Set(["no_write", "managed_cleanup", "tracked_residual"]);
  for (const item of runs) {
    const {
      runId,
      status,
      resources: resourceIds,
      createIntents,
      dataWritePolicy,
      dataHygieneStatus
    } = item.record;
    if (
      !isNonEmptyString(runId)
      || !isStringArray(resourceIds)
      || !isStringArray(createIntents)
      || !isNonEmptyString(status)
      || !runStatuses.has(status)
      || !isNonEmptyString(dataWritePolicy)
      || !dataWritePolicies.has(dataWritePolicy)
      || (
        dataHygieneStatus !== undefined
        && (!isNonEmptyString(dataHygieneStatus) || !dataHygieneStatuses.has(dataHygieneStatus))
      )
      || basename(item.path) !== `${runId}.json`
    ) {
      blockers.push({ path: item.path, reason: "运行记录结构或文件名损坏" });
      continue;
    }
    if (runById.has(runId)) {
      blockers.push({ path: item.path, reason: `重复 runId ${runId}` });
      continue;
    }
    runById.set(runId, item);
    if (status === "running" || status === "interrupted") {
      blockers.push({ path: item.path, reason: `运行状态为 ${status}` });
    }
    if (dataHygieneStatus === "cleanup_failed" || dataHygieneStatus === "manual_required") {
      blockers.push({ path: item.path, reason: `运行数据卫生状态为 ${dataHygieneStatus}` });
    }
  }

  const resourceStates = new Set([
    "registered",
    "available",
    "leased",
    "used",
    "dirty",
    "cleanup_pending",
    "cleaning",
    "cleaned",
    "cleanup_failed",
    "manual_required",
    "retained",
    "quarantined",
    "expired"
  ]);
  for (const item of resources) {
    const { resourceId, runId, owner, state, createIntentId } = item.record;
    if (
      owner !== "local-automation-test"
      || !isNonEmptyString(resourceId)
      || !isNonEmptyString(runId)
      || !isNonEmptyString(state)
      || !resourceStates.has(state)
      || (createIntentId !== undefined && !isNonEmptyString(createIntentId))
    ) {
      blockers.push({ path: item.path, reason: "资源记录结构、状态或所有者损坏" });
      continue;
    }
    if (resourceById.has(resourceId)) {
      blockers.push({ path: item.path, reason: `重复 resourceId ${resourceId}` });
      continue;
    }
    resourceById.set(resourceId, item);
    if (state === "cleaned") continue;
    if (state === "retained" || state === "quarantined") {
      const run = runById.get(runId);
      if (!hasReviewableResidualDecision(item.record, run?.record, state)) {
        blockers.push({
          path: item.path,
          reason: `资源标记为 ${state}，但缺少可审查的残留决定`
        });
        continue;
      }
      explicitResiduals.push({ path: item.path, reason: `资源已有可审查的 ${state} 决定` });
      continue;
    }
    blockers.push({ path: item.path, reason: `资源状态为 ${state}` });
  }

  const intentStatuses = new Set([
    "planned",
    "creating",
    "created",
    "failed",
    "creation_unknown",
    "reconciled"
  ]);
  for (const item of intents) {
    const { intentId, runId, owner, status } = item.record;
    if (
      owner !== "local-automation-test"
      || !isNonEmptyString(intentId)
      || !isNonEmptyString(runId)
      || !isNonEmptyString(status)
      || !intentStatuses.has(status)
    ) {
      blockers.push({ path: item.path, reason: "创建意图结构、状态或所有者损坏" });
      continue;
    }
    if (intentById.has(intentId)) {
      blockers.push({ path: item.path, reason: `重复 intentId ${intentId}` });
      continue;
    }
    intentById.set(intentId, item);
    if (["creating", "creation_unknown"].includes(status)) {
      blockers.push({ path: item.path, reason: `创建意图状态为 ${status}` });
    }
  }

  for (const [runId, item] of runById) {
    for (const resourceId of item.record.resources as string[]) {
      if (!resourceById.has(resourceId)) {
        blockers.push({ path: item.path, reason: `运行 ${runId} 引用了不存在的资源 ${resourceId}` });
      }
    }
    for (const intentId of item.record.createIntents as string[]) {
      if (!intentById.has(intentId)) {
        blockers.push({ path: item.path, reason: `运行 ${runId} 引用了不存在的创建意图 ${intentId}` });
      }
    }
  }
  for (const [resourceId, item] of resourceById) {
    const runId = item.record.runId as string;
    const run = runById.get(runId);
    if (!run) {
      blockers.push({ path: item.path, reason: `资源 ${resourceId} 引用了不存在的运行 ${runId}` });
    } else if (!(run.record.resources as string[]).includes(resourceId)) {
      blockers.push({ path: item.path, reason: `资源 ${resourceId} 未被运行 ${runId} 反向登记` });
    }
    const createIntentId = item.record.createIntentId;
    if (isNonEmptyString(createIntentId) && !intentById.has(createIntentId)) {
      blockers.push({ path: item.path, reason: `资源 ${resourceId} 引用了不存在的创建意图 ${createIntentId}` });
    }
  }
  for (const [intentId, item] of intentById) {
    const runId = item.record.runId as string;
    const run = runById.get(runId);
    if (!run) {
      blockers.push({ path: item.path, reason: `创建意图 ${intentId} 引用了不存在的运行 ${runId}` });
    } else if (!(run.record.createIntents as string[]).includes(intentId)) {
      blockers.push({ path: item.path, reason: `创建意图 ${intentId} 未被运行 ${runId} 反向登记` });
    }
    if (
      item.record.status === "created"
      && ![...resourceById.values()].some((resource) => resource.record.createIntentId === intentId)
    ) {
      blockers.push({ path: item.path, reason: `已创建意图 ${intentId} 没有关联资源` });
    }
  }

  for (const item of summaries) {
    const { runId, resources: summaryResources, dataHygieneStatus } = item.record;
    const invalidSummary =
      !isNonEmptyString(runId)
      || !Array.isArray(summaryResources)
      || !isNonEmptyString(dataHygieneStatus)
      || !dataHygieneStatuses.has(dataHygieneStatus)
      || basename(item.path) !== `${runId}.json`
      || !runById.has(runId);
    if (invalidSummary) {
      blockers.push({ path: item.path, reason: "摘要结构、文件名或 run 引用损坏" });
      continue;
    }
    const danglingSummaryResource = summaryResources.find((value) =>
      !isRecord(value)
      || !isNonEmptyString(value.resourceId)
      || !resourceById.has(value.resourceId)
    );
    if (danglingSummaryResource) {
      blockers.push({ path: item.path, reason: "摘要包含损坏或悬空的资源引用" });
    }
    if (dataHygieneStatus === "cleanup_failed" || dataHygieneStatus === "manual_required") {
      blockers.push({ path: item.path, reason: `摘要数据卫生状态为 ${dataHygieneStatus}` });
    }
    if (
      dataHygieneStatus === "retained"
      && !summaryResources.some((value) =>
        isRecord(value)
        && isNonEmptyString(value.resourceId)
        && ["retained", "quarantined"].includes(
          String(resourceById.get(value.resourceId)?.record.state)
        )
      )
    ) {
      blockers.push({ path: item.path, reason: "retained 摘要没有关联已明确裁决的残留资源" });
    }
  }

  for (const item of formalRecords) {
    const { schemaVersion, authorizationDigest, testDataRunId, cases, resources: namedResources } = item.record;
    const caseRecords = isRecord(cases) ? Object.values(cases) : [];
    if (
      schemaVersion !== "formal-execution-record-v1"
      || !isNonEmptyString(authorizationDigest)
      || basename(item.path) !== `${authorizationDigest}.json`
      || !isNonEmptyString(testDataRunId)
      || !runById.has(testDataRunId)
      || !isRecord(cases)
      || !isRecord(namedResources)
    ) {
      blockers.push({ path: item.path, reason: "正式执行记录结构、文件名或 run 引用损坏" });
      continue;
    }
    const openCase = caseRecords.find((value) =>
      !isRecord(value)
      || value.status === "unknown"
      || (
        Array.isArray(value.attempts)
        && value.attempts.some((attempt) => isRecord(attempt) && !isNonEmptyString(attempt.endedAt))
      )
    );
    if (openCase) {
      blockers.push({ path: item.path, reason: "正式执行记录仍有未收口 case attempt" });
    }
  }

  return { blockers, explicitResiduals };
}

interface LedgerJsonRecord {
  path: string;
  record: Record<string, unknown>;
}

function readLedgerDirectory(
  root: string,
  name: string,
  blockers: LedgerIssue[]
): LedgerJsonRecord[] {
  const directory = resolve(root, name);
  if (!existsSync(directory)) return [];
  const records: LedgerJsonRecord[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      blockers.push({ path, reason: `${name} 中存在未知文件或目录` });
      continue;
    }
    const record = readLedgerRecord(path);
    if (!record) {
      blockers.push({ path, reason: `${name} JSON 损坏` });
      continue;
    }
    records.push({ path, record });
  }
  return records;
}

function readLedgerRecord(path: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasReviewableResidualDecision(
  resource: Record<string, unknown>,
  run: Record<string, unknown> | undefined,
  state: "retained" | "quarantined"
): boolean {
  const decision = resource.residualDecision;
  if (
    isRecord(decision)
    && decision.outcome === state
    && isNonEmptyString(decision.decisionId)
    && isNonEmptyString(decision.reason)
    && isNonEmptyString(decision.decidedAt)
    && Number.isFinite(Date.parse(decision.decidedAt))
  ) {
    return true;
  }

  if (state !== "retained") return false;
  const expiresAt = resource.expiresAt;
  return resource.dataWritePolicy === "tracked_residual"
    && isNonEmptyString(expiresAt)
    && Number.isFinite(Date.parse(expiresAt))
    && Date.parse(expiresAt) > Date.now()
    && run?.dataWritePolicy === "tracked_residual"
    && isNonEmptyString(run.authorizationDigest);
}

function removeEntries(entries: string[]) {
  for (const entry of entries) {
    rmSync(entry, { recursive: true, force: true });
  }
}

function movePath(source: string, destination: string) {
  mkdirSync(dirname(destination), { recursive: true });
  if (existsSync(destination)) {
    throw new Error(`Archive destination already exists: ${relative(projectRoot, destination)}`);
  }
  renameSync(source, destination);
}

function removeEmptyDirectories(directory: string) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) removeEmptyDirectories(resolve(directory, entry.name));
  }
  if (readdirSync(directory).length === 0) {
    rmSync(directory, { recursive: true, force: true });
  }
}
