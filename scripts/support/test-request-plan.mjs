import fs from "node:fs/promises";
import path from "node:path";

export const requestPlanSchema = "test-request-plan";
export const maxDesignWorkers = 3;
const dependencyStatuses = new Set(["confirmed", "pending_confirmation", "rejected"]);
const dependencyKinds = new Set(["runtime_data", "business_precondition"]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function relativePack(rootDirectory, packDirectory) {
  const relative = path.relative(path.join(rootDirectory, "testpacks"), packDirectory);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`功能包必须位于 testpacks/：${packDirectory}`);
  return relative.replaceAll(path.sep, "/");
}

export async function readPackMetadata(rootDirectory, packDirectory) {
  const resolved = path.resolve(packDirectory);
  const relativePath = relativePack(rootDirectory, resolved);
  for (const name of ["scope.json", "cases.md"]) {
    try { await fs.access(path.join(resolved, name)); } catch { throw new Error(`功能包缺少 ${name}：${relativePath}`); }
  }
  let generatedData = { available: false, recordCount: 0, kind: null };
  try {
    const data = JSON.parse(await fs.readFile(path.join(resolved, "runtime", "generated-data.json"), "utf8"));
    generatedData = { available: Array.isArray(data.records) && data.records.length > 0, recordCount: data.records?.length ?? 0, kind: text(data.kind) || null };
  } catch { /* 运行时台账可不存在 */ }
  return { path: relativePath, feature: path.basename(resolved), generatedData };
}

/** 从脚本中读取另一功能包 runtime/generated-data.json 的事实，生成待人工确认的候选数据依赖。 */
export async function inferRuntimeDataCandidates(rootDirectory, packs) {
  const selected = new Set(packs.map((pack) => pack.path));
  const candidates = [];
  for (const pack of packs) {
    const specPath = path.join(rootDirectory, "testpacks", pack.path, `${pack.feature}.spec.ts`);
    let source;
    try { source = await fs.readFile(specPath, "utf8"); } catch { continue; }
    const matcher = /join\([\s\S]*?["']\.\.["']\s*,\s*["']([^"']+)["']\s*,\s*["']runtime["']\s*,\s*["']generated-data\.json["']/gu;
    for (const match of source.matchAll(matcher)) {
      const producer = `${path.posix.dirname(pack.path)}/${match[1]}`;
      if (selected.has(producer) && producer !== pack.path) {
        candidates.push({ from: producer, to: pack.path, kind: "runtime_data", evidence: `脚本读取 ${producer}/runtime/generated-data.json`, status: "pending_confirmation" });
      }
    }
  }
  return [...new Map(candidates.map((item) => [dependencyKey(item), item])).values()];
}

function dependencyKey(dependency) {
  return `${dependency.from}\u0000${dependency.to}\u0000${dependency.kind}`;
}

export function buildBatches(packPaths, dependencies, parallel) {
  const confirmed = dependencies.filter((item) => item.status === "confirmed");
  const incoming = new Map(packPaths.map((pack) => [pack, new Set()]));
  const outgoing = new Map(packPaths.map((pack) => [pack, new Set()]));
  for (const dependency of confirmed) {
    incoming.get(dependency.to).add(dependency.from);
    outgoing.get(dependency.from).add(dependency.to);
  }
  const remaining = new Set(packPaths);
  const batches = [];
  const limit = parallel ? maxDesignWorkers : 1;
  while (remaining.size > 0) {
    const ready = packPaths.filter((pack) => remaining.has(pack) && incoming.get(pack).size === 0).slice(0, limit);
    if (ready.length === 0) throw new Error("请求计划存在循环依赖");
    batches.push(ready);
    for (const pack of ready) {
      remaining.delete(pack);
      for (const child of outgoing.get(pack)) incoming.get(child).delete(pack);
    }
  }
  return batches;
}

export function validateRequestPlan(plan) {
  const problems = [];
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return ["request-plan.json 必须是对象"];
  if (plan.schema !== requestPlanSchema) problems.push(`schema 必须为 ${requestPlanSchema}`);
  if (!text(plan.reportId)) problems.push("reportId 不能为空");
  const packs = Array.isArray(plan.packs) ? plan.packs : [];
  const paths = packs.map((pack) => text(pack?.path)).filter(Boolean);
  if (paths.length === 0) problems.push("至少需要一个功能包");
  if (new Set(paths).size !== paths.length) problems.push("功能包不可重复");
  const dependencies = Array.isArray(plan.dependencies) ? plan.dependencies : [];
  const seen = new Set();
  for (const item of dependencies) {
    const key = dependencyKey(item ?? {});
    if (!text(item?.from) || !text(item?.to) || !dependencyKinds.has(text(item?.kind))) problems.push("依赖必须包含 from、to 和合法 kind");
    if (!paths.includes(text(item?.from)) || !paths.includes(text(item?.to))) problems.push("依赖两端必须都属于本次请求功能包");
    if (text(item?.from) === text(item?.to)) problems.push("功能包不能依赖自身");
    if (!dependencyStatuses.has(text(item?.status))) problems.push("依赖 status 必须为 confirmed、pending_confirmation 或 rejected");
    if (text(item?.status) === "pending_confirmation") problems.push(`依赖待确认：${item.from} → ${item.to}`);
    if (text(item?.status) === "confirmed" && !text(item?.evidence)) problems.push(`已确认依赖必须提供依据：${item.from} → ${item.to}`);
    if (seen.has(key)) problems.push(`依赖重复：${item.from} → ${item.to}`);
    seen.add(key);
  }
  if (!problems.some((problem) => problem.includes("待确认"))) {
    try { buildBatches(paths, dependencies, paths.length >= 3); } catch (error) { problems.push(error.message); }
  }
  return problems;
}

export function buildRequestPlan({ reportId, packs, dependencies = [] }) {
  const paths = packs.map((pack) => pack.path);
  const parallel = paths.length >= 3;
  const confirmed = dependencies.filter((item) => item.status === "confirmed");
  const designBatches = buildBatches(paths, confirmed, parallel);
  const executionOrder = buildBatches(paths, confirmed, false).flat();
  return {
    schema: requestPlanSchema,
    reportId,
    createdAt: new Date().toISOString(),
    maxDesignWorkers,
    designMode: parallel ? "parallel" : "serial",
    packs,
    dependencies,
    designBatches,
    scriptBatches: executionOrder.map((pack) => [pack]),
    executionOrder
  };
}

export async function readRequestPlan(planPath) {
  return JSON.parse(await fs.readFile(planPath, "utf8"));
}

export async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, filePath);
}

export function planPackDirectories(rootDirectory, plan) {
  return plan.packs.map((pack) => path.join(rootDirectory, "testpacks", pack.path));
}

export async function hasGeneratedData(rootDirectory, relativePath) {
  const metadata = await readPackMetadata(rootDirectory, path.join(rootDirectory, "testpacks", relativePath));
  return metadata.generatedData.available;
}
