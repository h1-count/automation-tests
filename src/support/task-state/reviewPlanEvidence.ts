import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReviewAgentExecution } from "./types.js";
import { isCanonicalReviewRecord, reviewRecordEnd, reviewRecordStart } from "./reviewPlanRecord.js";

export interface ReviewPlanEvidence {
  reference: string;
  digest: string;
  overallConclusion: "可提交确认" | "需演进" | "阻塞";
}

export interface ReviewPlanEvidenceOptions {
  /** Collection verifies that a reviewer wrote its formal result. Closure is
   * only required at an evolution or finalization gate. */
  allowPendingFindings?: boolean;
}

function rows(content: string): string[][] {
  return content
    .split("\n")
    .filter((line) => line.trim().startsWith("|") && !/^\|\s*-{3,}/.test(line.trim()))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
}

function batchSection(plan: string, batchId: string): string {
  if (isCanonicalReviewRecord(plan, batchId)) {
    const start = plan.indexOf(reviewRecordStart(batchId));
    const end = plan.indexOf(reviewRecordEnd(batchId), start);
    if (end < 0) throw new Error(`plan.md 的 ${batchId} 正式评审批次边界不完整。`);
    return plan.slice(start, end + reviewRecordEnd(batchId).length);
  }
  const heading = `### 评审批次：${batchId}`;
  const start = plan.indexOf(heading);
  if (start < 0) throw new Error(`plan.md 缺少正式评审批次 ${batchId}。`);
  const end = plan.indexOf("\n### 评审批次：", start + heading.length);
  return plan.slice(start, end < 0 ? undefined : end);
}

function metadataValue(section: string, field: string): string | undefined {
  return rows(section).find((cells) => cells.length === 2 && cells[0] === field)?.[1];
}

/** Formal reviewer conclusions and findings are read only from plan.md. */
export function readReviewPlanEvidence(
  planPath: string | undefined,
  batchId: string,
  executions: ReviewAgentExecution[],
  options: ReviewPlanEvidenceOptions = {}
): ReviewPlanEvidence {
  if (!planPath) throw new Error("TASK-04 缺少 plan.md 路径，无法验证正式评审记录。");
  const resolvedPath = resolve(planPath);
  const section = batchSection(readFileSync(resolvedPath, "utf8"), batchId);
  const overallConclusion = metadataValue(section, "综合结论");
  if (!overallConclusion || !["评审中", "可提交确认", "需演进", "阻塞"].includes(overallConclusion)) {
    throw new Error(`plan.md 的 ${batchId} 缺少有效的综合结论。`);
  }
  const executionRows = rows(section).filter((cells) => cells.length >= 8 && cells[0] !== "角色" && cells[1] === "真实子智能体");
  for (const execution of executions) {
    const row = executionRows.find((cells) => cells[0] === execution.role);
    if (!row) throw new Error(`plan.md 的 ${batchId} 缺少 ${execution.role} 执行记录。`);
    if (row[2] !== execution.agentTaskId) throw new Error(`plan.md 的 ${batchId}/${execution.role} Agent 任务标识与本机运行记录不一致。`);
    if (row[5] !== "已完成") throw new Error(`plan.md 的 ${batchId}/${execution.role} 尚未标记为已完成。`);
    if (!["通过", "需演进", "阻塞", "评审中"].includes(row[6] ?? "")) throw new Error(`plan.md 的 ${batchId}/${execution.role} 缺少正式结论。`);
  }
  // A batch also contains the five-column “沉淀判定” table, whose first
  // column intentionally repeats MRR IDs. Only the nine-column findings table
  // carries a closure status and may participate in the TASK-04 gate.
  const findingRows = rows(section).filter((cells) => /^MRR-/.test(cells[0] ?? "") && cells.length === 9);
  const unresolved = findingRows.filter((cells) => !["已关闭", "不适用", "待用户裁决"].includes(cells.at(-1) ?? ""));
  if (!options.allowPendingFindings && unresolved.length > 0) {
    throw new Error(`plan.md 的 ${batchId} 仍有未收束发现项：${unresolved.map((cells) => cells[0]).join("、")}。`);
  }
  return {
    reference: `${resolvedPath}#${batchId}`,
    digest: createHash("sha256").update(section, "utf8").digest("hex"),
    overallConclusion: overallConclusion as ReviewPlanEvidence["overallConclusion"]
  };
}
