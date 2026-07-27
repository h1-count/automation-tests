import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const dryRun = process.argv.slice(2).includes("--dry-run");
const unsupportedArgs = process.argv.slice(2).filter((argument) => argument !== "--dry-run");
const archiveStamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "").replace("T", "-");
const automationArchiveRoot = resolve(projectRoot, "archive/automation", `full-test-state-archived-${archiveStamp}`);

if (unsupportedArgs.length > 0) {
  throw new Error(`Unsupported arguments: ${unsupportedArgs.join(", ")}. Only --dry-run is supported.`);
}

const artifactFiles = collectFiles(resolve(projectRoot, "artifacts"), new Set(["README.md", ".gitkeep"]));
const legacyArtifactDirectories = ["allure-results"].map((directory) => resolve(projectRoot, directory)).filter(existsSync);
const legacyLocalTestDataDirectory = resolve(projectRoot, ".local/test-data");
const legacyLocalTestDataEntries = listEntries(legacyLocalTestDataDirectory);
const localTestLedgerRoot = resolve(projectRoot, ".local/test-ledger");
const localTaskStateRoot = resolve(projectRoot, ".local/test-task-state");
const managedLedgerResources = collectManagedLedgerResources(resolve(localTestLedgerRoot, "resources"));
const cleanedLedgerResources = managedLedgerResources.filter((resource) => resource.state === "cleaned");
const retainedLedgerResources = managedLedgerResources.filter((resource) => resource.state !== "cleaned");
const authEntries = listEntries(resolve(projectRoot, ".auth"));
const testcaseRequests = collectTestcaseRequests();
const testcaseArchiveDestinations = new Map(
  testcaseRequests.map((requestPath) => [
    requestPath,
    resolve(projectRoot, "testcases/archive", archiveTestcasePath(relative(resolve(projectRoot, "testcases"), requestPath)))
  ])
);
const linkedTaskStates = testcaseRequests.flatMap((requestPath) => {
  const requestRelativePath = relative(resolve(projectRoot, "testcases"), requestPath);
  const source = resolve(localTaskStateRoot, requestRelativePath);
  const destination = testcaseArchiveDestinations.get(requestPath);
  return existsSync(source) && destination
    ? [{ source, destination: resolve(destination, "task-state") }]
    : [];
});
const orphanTaskStateRoots = collectTaskStateRoots(localTaskStateRoot).filter((path) => !linkedTaskStates.some((state) => path === state.source));
const testScriptFiles = collectRequestTestFiles();
const retainedRemoteRecords = retainedLedgerResources.length;

printPlan("运行产物", artifactFiles.length, "清理");
printPlan("根目录遗留运行产物", legacyArtifactDirectories.length, "清理");
printPlan("旧本地测试数据证据", legacyLocalTestDataEntries.length, "归档");
printPlan("已清理本机台账资源", cleanedLedgerResources.length, "清理");
printPlan("保留云端测试数据台账", retainedLedgerResources.length, "归档");
printPlan("关联活跃请求的本机任务状态", linkedTaskStates.length, "归档");
printPlan("无关联本机任务状态", orphanTaskStateRoots.length, "归档");
printPlan("本地认证会话", authEntries.length, "清理");
printPlan("活跃测试请求", testcaseRequests.length, "归档");
printPlan("请求专属测试脚本", testScriptFiles.length, "归档");
console.log("保留共享基础能力：scripts/、src/actions/、src/clients/、src/fixtures/、src/support/、tests/support/ 及 tests/ 下划线开头的共享目录。");

if (retainedRemoteRecords > 0) {
  console.log(`注意：发现 ${retainedRemoteRecords} 条未处理本机台账资源；将归档台账，不会删除任何远端产品、设备或业务数据。`);
}

if (dryRun) {
  console.log("Dry run 完成：未移动或删除文件。保留 sources、test-assets、项目测试经验、用户偏好、.env、.local/repositories、全部共享基础能力及已有归档。");
  process.exit(0);
}

for (const path of artifactFiles) {
  rmSync(path, { force: true });
}
removeEntries(legacyArtifactDirectories);
archiveLegacyLocalTestData(legacyLocalTestDataEntries);
removeEntries(cleanedLedgerResources.map((resource) => resource.path));
if (existsSync(localTestLedgerRoot)) {
  if (retainedLedgerResources.length > 0) {
    movePath(localTestLedgerRoot, resolve(projectRoot, "testcases/archive", "unlinked-test-data", `full-test-state-archived-${archiveStamp}`, "test-ledger"));
  } else {
    removeEntries([localTestLedgerRoot]);
  }
}
removeEntries(authEntries);

for (const requestPath of testcaseRequests) {
  const destination = testcaseArchiveDestinations.get(requestPath);
  if (!destination) {
    throw new Error(`Missing archive destination for ${relative(projectRoot, requestPath)}.`);
  }
  movePath(requestPath, destination);
}
for (const taskState of linkedTaskStates) {
  movePath(taskState.source, taskState.destination);
}
removeEmptyDirectories(localTaskStateRoot);
if (existsSync(localTaskStateRoot) && listEntries(localTaskStateRoot).length > 0) {
  movePath(localTaskStateRoot, resolve(projectRoot, "testcases/archive", "unlinked-task-state", `full-test-state-archived-${archiveStamp}`, "test-task-state"));
}
moveFiles(testScriptFiles, resolve(projectRoot, "tests"), resolve(automationArchiveRoot, "tests"));

console.log(`完整测试状态已重置：运行状态已清理；活跃测试资产已归档到 ${relative(projectRoot, automationArchiveRoot)} 和 testcases/archive。远端数据未删除。`);

function printPlan(label: string, count: number, action: "清理" | "归档") {
  console.log(`${dryRun ? "将" : ""}${action}${label}：${count} 项。`);
}

function listEntries(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory).map((entry) => resolve(directory, entry));
}

function collectFiles(directory: string, preservedNames: Set<string>): string[] {
  if (!existsSync(directory)) {
    return [];
  }
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".DS_Store" || preservedNames.has(entry.name)) {
      continue;
    }
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(path, preservedNames));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files.sort();
}

function collectRequestTestFiles(): string[] {
  const testsRoot = resolve(projectRoot, "tests");
  if (!existsSync(testsRoot)) {
    return [];
  }
  const files: string[] = [];
  for (const type of readdirSync(testsRoot, { withFileTypes: true })) {
    if (!type.isDirectory() || type.name.startsWith(".") || type.name.startsWith("_") || type.name === "support") {
      continue;
    }
    const typePath = resolve(testsRoot, type.name);
    for (const project of readdirSync(typePath, { withFileTypes: true })) {
      if (!project.isDirectory() || project.name.startsWith(".") || project.name.startsWith("_")) {
        continue;
      }
      const projectPath = resolve(typePath, project.name);
      for (const request of readdirSync(projectPath, { withFileTypes: true })) {
        if (request.isDirectory() && !request.name.startsWith(".") && !request.name.startsWith("_")) {
          files.push(...collectFiles(resolve(projectPath, request.name), new Set()));
        }
      }
    }
  }
  return files.sort();
}

function collectTestcaseRequests(): string[] {
  const root = resolve(projectRoot, "testcases");
  if (!existsSync(root)) {
    return [];
  }
  const requests: string[] = [];
  for (const type of readdirSync(root, { withFileTypes: true })) {
    if (!type.isDirectory() || type.name.startsWith(".") || type.name === "archive") {
      continue;
    }
    const typePath = resolve(root, type.name);
    for (const project of readdirSync(typePath, { withFileTypes: true })) {
      if (!project.isDirectory() || project.name.startsWith(".")) {
        continue;
      }
      const projectPath = resolve(typePath, project.name);
      for (const request of readdirSync(projectPath, { withFileTypes: true })) {
        if (request.isDirectory() && !request.name.startsWith(".")) {
          requests.push(resolve(projectPath, request.name));
        }
      }
    }
  }
  return requests.sort();
}

function archiveTestcasePath(requestRelativePath: string): string {
  const segments = requestRelativePath.split("/");
  const requestName = segments.pop();
  if (!requestName) {
    throw new Error(`Invalid testcase request path: ${requestRelativePath}`);
  }
  return [...segments, `${requestName}-archived-${archiveStamp}`].join("/");
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

function moveFiles(files: string[], sourceRoot: string, destinationRoot: string) {
  for (const source of files) {
    const destination = resolve(destinationRoot, relative(sourceRoot, source));
    movePath(source, destination);
  }
}

interface ManagedLedgerResource {
  path: string;
  state: string;
}

function collectManagedLedgerResources(directory: string): ManagedLedgerResource[] {
  return listEntries(directory).flatMap((entry) => {
    if (!entry.endsWith(".json")) {
      return [];
    }
    try {
      const record = JSON.parse(readFileSync(entry, "utf8")) as { state?: unknown; owner?: unknown };
      if (record.owner !== "local-automation-test" || typeof record.state !== "string") {
        return [];
      }
      return [{ path: entry, state: record.state }];
    } catch {
      // A malformed ledger is retained with the ledger root for manual review.
      return [{ path: entry, state: "manual_required" }];
    }
  });
}

function archiveLegacyLocalTestData(entries: string[]) {
  for (const entry of entries) {
    const destination = resolve(projectRoot, "testcases/archive", "legacy-local-test-data", `full-test-state-archived-${archiveStamp}`, basename(entry));
    movePath(entry, destination);
  }
}

function collectTaskStateRoots(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }
  const roots: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const path = resolve(directory, entry.name);
    if (existsSync(resolve(path, "state.json"))) {
      roots.push(path);
    } else {
      roots.push(...collectTaskStateRoots(path));
    }
  }
  return roots;
}

function removeEmptyDirectories(directory: string) {
  if (!existsSync(directory)) {
    return;
  }
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      removeEmptyDirectories(resolve(directory, entry.name));
    }
  }
  if (readdirSync(directory).length === 0) {
    rmSync(directory, { recursive: true, force: true });
  }
}
