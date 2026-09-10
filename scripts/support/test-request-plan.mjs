import fs from "node:fs/promises";
import path from "node:path";

export const requestPlanSchema = "test-request-plan";
export const maxDesignWorkers = 3;
export const agentWorkOrderStages = ["case_design", "page_exploration", "script_authoring", "failure_diagnosis"];
const workOrderArtifacts = ["runtime/design-card.md", "scope.json", "cases.md"];
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

function hasOnlyKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).every((key) => keys.includes(key))
    && keys.every((key) => Object.hasOwn(value, key));
}

/**
 * 只有多功能包请求才生成工作单。工作单完全由功能包、批次和已确认依赖派生，
 * 不接受页面、组件或源码文件作为拆分粒度。
 */
export function buildAgentWorkOrders(packPaths, designBatches, dependencies) {
  if (packPaths.length < 3) return [];
  const confirmed = dependencies.filter((dependency) => dependency.status === "confirmed");
  return designBatches.flatMap((batch, batchOffset) => batch.map((packPath, orderOffset) => ({
    workOrderId: `WO-B${batchOffset + 1}-${String(orderOffset + 1).padStart(2, "0")}`,
    packPath,
    batchId: batchOffset + 1,
    allowedStages: [...agentWorkOrderStages],
    allowedContext: {
      ownPackArtifacts: [...workOrderArtifacts],
      sourceScope: "pack_matched_only",
      projectExperience: true,
      upstreamDependencies: confirmed
        .filter((dependency) => dependency.to === packPath)
        .map(({ from, kind, evidence }) => ({ packPath: from, kind, evidence }))
    }
  })));
}

/** 严格校验工作单只能是请求计划的确定性派生结果。 */
export function validateAgentWorkOrders(plan) {
  const problems = [];
  const packs = Array.isArray(plan?.packs) ? plan.packs : [];
  const packPaths = packs.map((pack) => text(pack?.path)).filter(Boolean);
  const orders = plan?.agentWorkOrders;
  if (!Array.isArray(orders)) return ["agentWorkOrders 必须是数组"];
  if (packPaths.length < 3) {
    if (orders.length !== 0) problems.push("1–2 个功能包不得创建测试子智能体工作单");
    return problems;
  }
  const expected = buildAgentWorkOrders(packPaths, plan.designBatches ?? [], plan.dependencies ?? []);
  if (orders.length !== expected.length) {
    problems.push(`agentWorkOrders 数量必须等于功能包数：期望 ${expected.length}，实际 ${orders.length}`);
    return problems;
  }
  const seenOrders = new Set();
  const seenPacks = new Set();
  for (const order of orders) {
    if (!hasOnlyKeys(order, ["workOrderId", "packPath", "batchId", "allowedStages", "allowedContext"])) {
      problems.push("工作单只能包含 workOrderId、packPath、batchId、allowedStages、allowedContext；禁止组件、页面或源码拆分字段");
      continue;
    }
    if (!text(order.workOrderId) || seenOrders.has(order.workOrderId)) problems.push(`workOrderId 必须唯一：${text(order.workOrderId) || "(空)"}`);
    seenOrders.add(order.workOrderId);
    if (!packPaths.includes(text(order.packPath)) || seenPacks.has(order.packPath)) problems.push(`每个工作单必须唯一绑定本次功能包：${text(order.packPath) || "(空)"}`);
    seenPacks.add(order.packPath);
    if (!Array.isArray(order.allowedStages) || JSON.stringify(order.allowedStages) !== JSON.stringify(agentWorkOrderStages)) {
      problems.push(`工作单 ${text(order.workOrderId) || "(空)"} 的 allowedStages 必须为全测试流程标准阶段`);
    }
    const context = order.allowedContext;
    if (!hasOnlyKeys(context, ["ownPackArtifacts", "sourceScope", "projectExperience", "upstreamDependencies"])) {
      problems.push(`工作单 ${text(order.workOrderId) || "(空)"} 的 allowedContext 字段非法`);
    }
  }
  if (problems.length === 0 && JSON.stringify(orders) !== JSON.stringify(expected)) {
    problems.push("agentWorkOrders 必须与功能包、设计批次和已确认依赖的机器计算结果完全一致");
  }
  return problems;
}

/** 验证某阶段是否可使用指定功能包工作单。 */
export function validateWorkOrderUse(plan, packPath, workOrderId, stage) {
  const problems = validateAgentWorkOrders(plan);
  const paths = (plan?.packs ?? []).map((pack) => text(pack?.path)).filter(Boolean);
  if (paths.length < 3) {
    if (workOrderId) problems.push("1–2 个功能包请求不得传入工作单");
    return problems;
  }
  if (!workOrderId) return [...problems, "多功能包请求必须提供 --work-order"];
  const order = (plan.agentWorkOrders ?? []).find((item) => item.workOrderId === workOrderId);
  if (!order) return [...problems, `未找到工作单：${workOrderId}`];
  if (order.packPath !== packPath) problems.push(`工作单 ${workOrderId} 只能处理 ${order.packPath}`);
  if (!agentWorkOrderStages.includes(stage) || !order.allowedStages?.includes(stage)) problems.push(`工作单 ${workOrderId} 不允许阶段：${stage}`);
  return problems;
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
  problems.push(...validateAgentWorkOrders(plan));
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
    agentWorkOrders: buildAgentWorkOrders(paths, designBatches, dependencies),
    scriptBatches: executionOrder.map((pack) => [pack]),
    executionOrder
  };
}

export async function readRequestPlan(planPath) {
  return JSON.parse(await fs.readFile(planPath, "utf8"));
}

/** 从功能包向上查找包含该包的当前请求计划；同一路径有多个请求时拒绝猜测。 */
export async function findActiveRequestPlanForPack(rootDirectory, packDirectory) {
  const testpacksDirectory = path.join(rootDirectory, "testpacks");
  const packPath = relativePack(rootDirectory, packDirectory);
  let directory = path.resolve(packDirectory);
  while (directory.startsWith(testpacksDirectory)) {
    const currentRoot = path.join(directory, "artifacts", "current");
    let reportDirectories = [];
    try { reportDirectories = await fs.readdir(currentRoot, { withFileTypes: true }); } catch { /* 当前目录没有请求计划，继续向上查找 */ }
    const matches = [];
    for (const entry of reportDirectories) {
      if (!entry.isDirectory()) continue;
      const planPath = path.join(currentRoot, entry.name, "request-plan.json");
      try {
        const plan = await readRequestPlan(planPath);
        if ((plan.packs ?? []).some((pack) => pack.path === packPath)) matches.push({ planPath, plan });
      } catch { /* 此请求目录没有计划 */ }
    }
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new Error(`功能包 ${packPath} 命中多个当前请求计划；请显式传入对应工作单`);
    if (directory === testpacksDirectory) break;
    directory = path.dirname(directory);
  }
  return null;
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
