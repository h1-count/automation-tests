import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync
} from "node:fs";
import { relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const includeIncomplete = args.includes("--include-incomplete");
const pruneUnreferencedBlobs = args.includes("--prune-unreferenced-blobs");
const keepRequests = readOptionValues(args, "--keep");
const requestedRequests = readOptionValues(args, "--request");
const unsupported = args.filter((argument, index) =>
  argument !== "--dry-run"
  && argument !== "--include-incomplete"
  && argument !== "--prune-unreferenced-blobs"
  && argument !== "--keep"
  && args[index - 1] !== "--keep"
  && argument !== "--request"
  && args[index - 1] !== "--request"
);

if (unsupported.length > 0) {
  throw new Error(
    `Unsupported arguments: ${unsupported.join(", ")}. Use --dry-run, --request <type/project/request>, --keep <type/project/request>, --include-incomplete, and --prune-unreferenced-blobs.`
  );
}
if (includeIncomplete && keepRequests.size === 0 && requestedRequests.size === 0) {
  throw new Error("--include-incomplete requires at least one explicit --keep request.");
}

const runsRoot = resolve(projectRoot, ".local/test-runs");
const runtimeRoot = resolve(projectRoot, ".local/test-task-runtime");
const runRequests = collectRequestDirectories(runsRoot);
const runtimeRequests = collectRequestDirectories(runtimeRoot, true);
const requestIds = new Set([...runRequests.keys(), ...runtimeRequests.keys()]);
const selected: LocalRequest[] = [];
const retained: Array<{ requestId: string; reason: string }> = [];
const conflicts: string[] = [];
const obsoleteRuntimeEntries = includeIncomplete && requestedRequests.size === 0
  ? collectLegacyRuntimeEntries(runtimeRoot) : [];
const reviewInputBlobRoot = resolve(runtimeRoot, "review-input-blobs");

for (const requestId of requestedRequests) {
  if (!requestIds.has(requestId)) {
    throw new Error(`Requested local run does not exist: ${requestId}`);
  }
}

for (const requestId of [...requestIds].sort()) {
  if (requestedRequests.size > 0 && !requestedRequests.has(requestId)) continue;
  const runPath = runRequests.get(requestId);
  const runtimePath = runtimeRequests.get(requestId);
  if (keepRequests.has(requestId)) {
    retained.push({ requestId, reason: "explicitly kept" });
    continue;
  }
  const terminal = runPath ? isTerminalRun(runPath) : false;
  if (!terminal && !includeIncomplete) {
    retained.push({ requestId, reason: runPath ? "workflow is not terminal" : "runtime has no matching run archive" });
    continue;
  }
  const inFlight = runtimePath ? runtimeInFlightReason(runtimePath) : undefined;
  if (inFlight) {
    conflicts.push(`${requestId}: ${inFlight}`);
    continue;
  }
  selected.push({ requestId, runPath, runtimePath, terminal });
}

console.log(`${dryRun ? "将" : ""}清理本机运行档案：${selected.filter((item) => item.runPath).length} 项。`);
console.log(`${dryRun ? "将" : ""}清理可丢弃运行时目录：${selected.filter((item) => item.runtimePath).length} 项。`);
console.log(`${dryRun ? "将" : ""}清理废弃根级运行时残留：${obsoleteRuntimeEntries.length} 项。`);
if (pruneUnreferencedBlobs) {
  console.log(`${dryRun ? "将" : ""}清理无引用 reviewer 输入缓存：${existsSync(reviewInputBlobRoot) ? 1 : 0} 项。`);
}
for (const item of selected) {
  const parts = [item.runPath ? "run archive" : undefined, item.runtimePath ? "runtime" : undefined]
    .filter((part): part is string => Boolean(part));
  console.log(`- ${item.requestId}：${parts.join(" + ")} (${item.terminal ? "terminal" : "explicit incomplete cleanup"})`);
}
console.log(`保留请求：${retained.length} 项。`);
for (const item of retained) console.log(`- ${item.requestId}：${item.reason}`);
for (const entry of obsoleteRuntimeEntries) {
  console.log(`- ${relative(projectRoot, entry)}：obsolete runtime residue`);
}

if (conflicts.length > 0) {
  console.error(`本机运行档案清理已停止：${conflicts.join("；")}。`);
  console.error("存在有效租约或运行中的 reviewer 绑定；未删除任何文件。");
  process.exit(2);
}
if (pruneUnreferencedBlobs && retained.length > 0) {
  throw new Error("Cannot prune shared reviewer input blobs while any local run or runtime is retained.");
}
if (dryRun) {
  console.log(`Dry run 完成：未删除文件。${pruneUnreferencedBlobs ? "仅在本轮清理后不存在保留请求时清理共享 reviewer 输入缓存。" : "共享 review-input-blobs、来源、套件、台账和当前保留请求不在本命令范围内。"}`);
  process.exit(0);
}

for (const item of selected) {
  if (item.runPath) rmSync(item.runPath, { recursive: true, force: true });
  if (item.runtimePath) rmSync(item.runtimePath, { recursive: true, force: true });
}
for (const entry of obsoleteRuntimeEntries) rmSync(entry, { recursive: true, force: true });
const removedReviewInputBlobs = pruneUnreferencedBlobs && existsSync(reviewInputBlobRoot);
if (removedReviewInputBlobs) rmSync(reviewInputBlobRoot, { recursive: true, force: true });
removeEmptyDirectories(runsRoot);
removeEmptyDirectories(runtimeRoot);
console.log(
  `本机运行档案清理完成：删除 ${selected.length} 个请求的本机运行数据、${obsoleteRuntimeEntries.length} 项废弃根级残留和 ${removedReviewInputBlobs ? 1 : 0} 项无引用 reviewer 输入缓存。`
);

interface LocalRequest {
  requestId: string;
  runPath?: string;
  runtimePath?: string;
  terminal: boolean;
}

function readOptionValues(values: string[], option: string): Set<string> {
  const selected = new Set<string>();
  values.forEach((value, index) => {
    if (value !== option) return;
    const requestId = values[index + 1];
    if (!requestId || requestId.startsWith("--")) {
      throw new Error(`${option} requires a <type/project/request> value.`);
    }
    validateRequestId(requestId);
    selected.add(requestId);
  });
  return selected;
}

function collectRequestDirectories(root: string, requireRuntimeSnapshot = false): Map<string, string> {
  const requests = new Map<string, string>();
  if (!existsSync(root)) return requests;
  for (const type of readdirSync(root, { withFileTypes: true })) {
    if (!type.isDirectory() || type.isSymbolicLink()) continue;
    const typePath = resolve(root, type.name);
    for (const project of readdirSync(typePath, { withFileTypes: true })) {
      if (!project.isDirectory() || project.isSymbolicLink()) continue;
      const projectPath = resolve(typePath, project.name);
      for (const request of readdirSync(projectPath, { withFileTypes: true })) {
        if (!request.isDirectory() || request.isSymbolicLink()) continue;
        const requestId = `${type.name}/${project.name}/${request.name}`;
        validateRequestId(requestId);
        const requestPath = resolve(projectPath, request.name);
        if (requireRuntimeSnapshot && !existsSync(resolve(requestPath, "runtime.json"))) continue;
        requests.set(requestId, requestPath);
      }
    }
  }
  return requests;
}

function collectLegacyRuntimeEntries(root: string): string[] {
  if (!existsSync(root)) return [];
  const entries: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = resolve(root, entry.name);
    if (entry.name === "staging" && entry.isDirectory()) {
      entries.push(path);
    } else if (entry.isFile()) {
      entries.push(path);
    }
  }
  return entries.sort();
}

function isTerminalRun(requestPath: string): boolean {
  const historyPath = resolve(requestPath, "workflow-history.ndjson");
  if (!existsSync(historyPath)) return false;
  const lines = readFileSync(historyPath, "utf8").split("\n").filter((line) => line.trim());
  const lastLine = lines.at(-1);
  if (!lastLine) return false;
  try {
    const event = JSON.parse(lastLine) as { type?: unknown };
    return event.type === "WorkflowCompleted" || event.type === "WorkflowCancelled";
  } catch {
    return false;
  }
}

function runtimeInFlightReason(requestPath: string): string | undefined {
  const runtimePath = resolve(requestPath, "runtime.json");
  if (!existsSync(runtimePath)) return undefined;
  let runtime: Record<string, unknown>;
  try {
    runtime = JSON.parse(readFileSync(runtimePath, "utf8")) as Record<string, unknown>;
  } catch {
    return "runtime.json cannot be parsed";
  }
  const now = Date.now();
  const leases = asRecords(runtime.leases);
  if (Object.values(leases).some((lease) =>
    typeof lease.releasedAt !== "string"
    && (typeof lease.expiresAt !== "string" || Date.parse(lease.expiresAt) > now)
  )) {
    return "an Activity lease is still valid";
  }
  const reviewers = asRecords(runtime.reviewerBindings);
  if (Object.keys(reviewers).length > 0) {
    return "a reviewer binding is still running";
  }
  return undefined;
}

function asRecords(value: unknown): Record<string, Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, item]) =>
    Boolean(item) && typeof item === "object" && !Array.isArray(item)
  )) as Record<string, Record<string, unknown>>;
}

function validateRequestId(requestId: string): void {
  if (!/^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/u.test(requestId)) {
    throw new Error(`Invalid request id: ${requestId}`);
  }
}

function removeEmptyDirectories(directory: string): void {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) removeEmptyDirectories(path);
  }
  if (readdirSync(directory).length === 0 && relative(projectRoot, directory).startsWith(".local/")) {
    rmSync(directory, { recursive: true, force: true });
  }
}
