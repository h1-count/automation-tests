import path from "node:path";
import { fileURLToPath } from "node:url";
import { requestArtifactDirectories } from "./support/request-report-location.mjs";
import { buildRequestPlan, inferRuntimeDataCandidates, readPackMetadata, readRequestPlan, validateRequestPlan, writeJsonAtomic } from "./support/test-request-plan.mjs";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const value = (name) => { const index = args.indexOf(name); return index === -1 ? undefined : args[index + 1]; };
const values = (name) => args.flatMap((entry, index) => entry === name && args[index + 1] ? [args[index + 1]] : []);
const reportId = value("--report-id");
if (!reportId) throw new Error("用法：node scripts/prepare-test-request.mjs --report-id <标识> --pack <功能包> [--pack <功能包> ...] [--candidate 上游:下游:类型:依据] [--confirm 上游:下游]");

function parseCandidate(raw) {
  const [from, to, kind, ...evidence] = raw.split(":");
  if (!from || !to || !kind || evidence.length === 0) throw new Error(`候选依赖格式错误：${raw}（应为 上游:下游:runtime_data|business_precondition:依据）`);
  return { from, to, kind, evidence: evidence.join(":"), status: "pending_confirmation" };
}
function parseConfirmation(raw) {
  const [from, to] = raw.split(":");
  if (!from || !to) throw new Error(`确认格式错误：${raw}（应为 上游:下游）`);
  return { from, to };
}

const requestedPacks = values("--pack");
if (requestedPacks.length === 0) throw new Error("每次创建或续接请求计划都必须至少传入一个 --pack");
const packDirectories = requestedPacks.map((entry) => path.resolve(rootDirectory, entry));
const packs = await Promise.all(packDirectories.map((directory) => readPackMetadata(rootDirectory, directory)));
const candidateInputs = values("--candidate").map(parseCandidate);
const confirmations = values("--confirm").map(parseConfirmation);
const inferredCandidates = await inferRuntimeDataCandidates(rootDirectory, packs);
const directories = requestArtifactDirectories(rootDirectory, packDirectories, reportId);
let existingPlan;
try { existingPlan = await readRequestPlan(directories.requestPlanPath); } catch { /* 当前请求首次创建 */ }
if (existingPlan?.reportId !== reportId) existingPlan = undefined;
const dependencies = [...(existingPlan?.dependencies ?? []), ...inferredCandidates, ...candidateInputs];
for (const confirmation of confirmations) {
  const target = dependencies.find((item) => item.from === confirmation.from && item.to === confirmation.to && item.status === "pending_confirmation");
  if (!target) throw new Error(`未找到待确认依赖：${confirmation.from} → ${confirmation.to}`);
  target.status = "confirmed";
}
const deduplicated = [...dependencies.reduce((items, item) => {
  const key = `${item.from}\u0000${item.to}\u0000${item.kind}`;
  const current = items.get(key);
  // 续接请求时，重新扫描出的 pending 候选不得降级此前已确认或已拒绝的结论。
  if (!current || (current.status === "pending_confirmation" && item.status !== "pending_confirmation")) items.set(key, item);
  return items;
}, new Map()).values()];
const plan = buildRequestPlan({ reportId, packs, dependencies: deduplicated });
const problems = validateRequestPlan(plan).filter((problem) => !problem.startsWith("依赖待确认："));
if (problems.length) throw new Error(`请求计划无效：${problems.join("；")}`);
const outputPath = directories.requestPlanPath;
await writeJsonAtomic(outputPath, plan);
process.stdout.write(`${JSON.stringify({ outputPath: path.relative(rootDirectory, outputPath), designMode: plan.designMode, designBatches: plan.designBatches, pendingConfirmation: plan.dependencies.filter((item) => item.status === "pending_confirmation").length }, null, 2)}\n`);
