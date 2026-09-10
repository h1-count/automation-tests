import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditAgentDispatch } from "./audit-agent-dispatch.mjs";
import { readRequestPlan, writeJsonAtomic } from "./support/test-request-plan.mjs";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const index = process.argv.indexOf("--plan");
if (index === -1 || !process.argv[index + 1]) throw new Error("用法：node scripts/prepare-agent-dispatch.mjs --plan <request-plan.json>");
const planPath = path.resolve(rootDirectory, process.argv[index + 1]);
const plan = await readRequestPlan(planPath);
const audit = auditAgentDispatch(plan);
if (!audit.valid) throw new Error(`子智能体编排未通过：${audit.problems.join("；")}`);

const dispatch = {
  schema: "test-agent-dispatch-v1",
  reportId: plan.reportId,
  generatedAt: new Date().toISOString(),
  designMode: plan.designMode,
  workOrders: plan.agentWorkOrders.map((workOrder) => ({
    ...workOrder,
    taskInstruction: `仅处理功能包 ${workOrder.packPath}。仅在允许上下文范围内工作；不得拆分为页面、组件或源码文件任务。`
  }))
};
const outputPath = path.join(path.dirname(planPath), "agent-dispatch.json");
await writeJsonAtomic(outputPath, dispatch);
process.stdout.write(`${JSON.stringify({ outputPath: path.relative(rootDirectory, outputPath), workOrderCount: dispatch.workOrders.length, workOrders: dispatch.workOrders }, null, 2)}\n`);
