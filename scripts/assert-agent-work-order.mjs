import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditAgentDispatch } from "./audit-agent-dispatch.mjs";
import { readRequestPlan, validateWorkOrderUse } from "./support/test-request-plan.mjs";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
function required(name) {
  const index = args.indexOf(name);
  const value = index === -1 ? undefined : args[index + 1];
  if (!value) throw new Error(`缺少 ${name}`);
  return value;
}

const planPath = path.resolve(rootDirectory, required("--plan"));
const packPath = required("--pack").replaceAll("\\", "/");
const workOrderId = required("--work-order");
const stage = required("--stage");
const plan = await readRequestPlan(planPath);
const problems = [...auditAgentDispatch(plan).problems, ...validateWorkOrderUse(plan, packPath, workOrderId, stage)];
if (problems.length > 0) throw new Error(`子智能体工作单未通过：${[...new Set(problems)].join("；")}`);
process.stdout.write(`${JSON.stringify({ valid: true, workOrderId, packPath, stage })}\n`);
