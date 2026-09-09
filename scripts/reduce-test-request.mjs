import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditPack } from "./audit-case-completeness.mjs";
import { readRequestPlan, validateRequestPlan, writeJsonAtomic } from "./support/test-request-plan.mjs";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const index = process.argv.indexOf("--plan");
if (index === -1 || !process.argv[index + 1]) throw new Error("用法：node scripts/reduce-test-request.mjs --plan <request-plan.json>");
const planPath = path.resolve(rootDirectory, process.argv[index + 1]);
const plan = await readRequestPlan(planPath);
const planProblems = validateRequestPlan(plan);
const packResults = await Promise.all(plan.packs.map(async (pack) => {
  const result = await auditPack(path.join(rootDirectory, "testpacks", pack.path));
  return { path: pack.path, caseCount: result.caseCount ?? 0, problems: result.problems, generatedData: pack.generatedData };
}));
const dependencyProblems = [];
for (const dependency of plan.dependencies.filter((item) => item.status === "confirmed")) {
  const producer = packResults.find((item) => item.path === dependency.from);
  const consumer = packResults.find((item) => item.path === dependency.to);
  if (!producer || !consumer) dependencyProblems.push(`依赖包不存在：${dependency.from} → ${dependency.to}`);
}
const summary = { schema: "test-request-design-summary", reportId: plan.reportId, generatedAt: new Date().toISOString(), planProblems, dependencyProblems, packs: packResults };
const outputDirectory = path.dirname(planPath);
await writeJsonAtomic(path.join(outputDirectory, "design-summary.json"), summary);
process.stdout.write(`${JSON.stringify({ summary: path.relative(rootDirectory, path.join(outputDirectory, "design-summary.json")), valid: planProblems.length === 0 && dependencyProblems.length === 0 && packResults.every((item) => item.problems.length === 0) })}\n`);
if (planProblems.length || dependencyProblems.length || packResults.some((item) => item.problems.length)) process.exitCode = 1;
