import { readFile, writeFile } from "node:fs/promises";
import type {
  CallbackResolution,
  DurableWorkflowManager
} from "../../../src/support/task-workflow/index.js";

const decisionTypeByActivity: Record<string, string> = {
  "plan-confirmation": "计划确认",
  "case-confirmation": "用例确认",
  "execution-authorization": "执行清单确认",
  "case-review-conflict-decision": "业务裁决"
};

export async function recordFormalDecision(
  manager: DurableWorkflowManager,
  activityId: string,
  subjectDigest: string,
  resolution: CallbackResolution
): Promise<void> {
  const plan = await buildFormalDecisionPlan(
    manager,
    activityId,
    subjectDigest,
    resolution
  );
  const activity = (await manager.gate()).activities[activityId];
  if (
    activity?.state === "WAITING_CALLBACK"
    && activity.callbackId
  ) {
    await manager.publishFormalDecisionPlan({
      activityId,
      callbackId: activity.callbackId,
      subjectDigest,
      resolution,
      planContent: plan,
      owner: "formal-decision-fixture"
    });
    return;
  }
  await writeFile(manager.planPath, plan, "utf8");
}

export async function buildFormalDecisionPlan(
  manager: DurableWorkflowManager,
  activityId: string,
  subjectDigest: string,
  resolution: CallbackResolution
): Promise<string> {
  const decisionType = decisionTypeByActivity[activityId];
  if (!decisionType) return readFile(manager.planPath, "utf8");
  const row = `| ${decisionType} | ${subjectDigest} | ${resolution} | test fixture | continue |`;
  let plan = await readFile(manager.planPath, "utf8");
  const heading = "## 正式用户决定";
  const start = plan.indexOf(heading);
  if (start < 0) {
    plan = `${plan.trimEnd()}\n\n${heading}\n\n`
      + "| 决定类型 | subjectDigest | 正式决定 | 决定内容与适用范围 | 后续处理 |\n"
      + "| --- | --- | --- | --- | --- |\n"
      + `${row}\n`;
  } else {
    const next = plan.indexOf("\n## ", start + heading.length);
    const insertion = next < 0 ? plan.length : next;
    plan = `${plan.slice(0, insertion).trimEnd()}\n${row}\n\n${plan.slice(insertion).trimStart()}`;
  }
  return plan;
}
