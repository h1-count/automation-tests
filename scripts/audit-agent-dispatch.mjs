import path from "node:path";
import { fileURLToPath } from "node:url";
import { readRequestPlan, validateAgentWorkOrders, validateRequestPlan } from "./support/test-request-plan.mjs";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function auditAgentDispatch(plan) {
  const problems = [...new Set([...validateRequestPlan(plan), ...validateAgentWorkOrders(plan)])];
  return {
    valid: problems.length === 0,
    workOrderCount: Array.isArray(plan?.agentWorkOrders) ? plan.agentWorkOrders.length : 0,
    problems
  };
}

function required(name) {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (!value) throw new Error(`用法：node scripts/audit-agent-dispatch.mjs --plan <request-plan.json>`);
  return value;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const planPath = path.resolve(rootDirectory, required("--plan"));
  const result = auditAgentDispatch(await readRequestPlan(planPath));
  if (!result.valid) {
    process.stderr.write(`子智能体编排未通过：${result.problems.join("；")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}
