import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReviewAgentExecution, ReviewAgentSubmission, ReviewBatch, ReviewRole } from "./types.js";
import { atomicWriteText } from "../test-data/ledgerStore.js";

export const reviewRecordStart = (batchId: string) => `<!-- review-batch:${batchId}:start -->`;
export const reviewRecordEnd = (batchId: string) => `<!-- review-batch:${batchId}:end -->`;

type FormalRole = { conclusion: string; findingIds: string; disposition: string };

function rows(content: string): string[][] {
  return content
    .split("\n")
    .filter((line) => line.trim().startsWith("|") && !/^\|\s*-{3,}/.test(line.trim()))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
}

function between(content: string, start: string, end: string): string | undefined {
  const startAt = content.indexOf(start);
  if (startAt < 0) return undefined;
  const endAt = content.indexOf(end, startAt + start.length);
  return endAt < 0 ? undefined : content.slice(startAt + start.length, endAt);
}

function legacyBatch(content: string, batchId: string): { start: number; end: number; content: string } | undefined {
  const heading = `### 评审批次：${batchId}`;
  const start = content.indexOf(heading);
  if (start < 0) return undefined;
  const nextMatch = /\n#{2,3}\s+/.exec(content.slice(start + heading.length));
  const end = nextMatch ? start + heading.length + nextMatch.index : content.length;
  return { start, end, content: content.slice(start, end) };
}

function roleFacts(content: string): Map<string, FormalRole> {
  const result = new Map<string, FormalRole>();
  for (const cells of rows(content)) {
    if (cells.length >= 9 && cells[0] !== "角色" && cells[1] === "真实子智能体") {
      result.set(cells[0], { conclusion: cells[6] || "评审中", findingIds: cells[7] || "无", disposition: cells[8] || "等待 reviewer" });
    }
  }
  return result;
}

function metadata(content: string, field: string): string | undefined {
  return rows(content).find((cells) => cells.length === 2 && cells[0] === field)?.[1];
}

function details(content: string, heading: string, nextHeading: string): string | undefined {
  const start = content.indexOf(heading);
  if (start < 0) return undefined;
  const end = content.indexOf(nextHeading, start + heading.length);
  return content.slice(start, end < 0 ? undefined : end).trim();
}

function executionState(execution: ReviewAgentExecution | undefined): string {
  return execution?.status ?? "等待资源";
}

function reviewSectionRange(plan: string): { start: number; end: number } {
  const start = plan.indexOf("## 多角色评审记录");
  if (start < 0) throw new Error("plan.md 缺少 ## 多角色评审记录，无法写入正式评审批次。");
  const next = plan.indexOf("\n## ", start + "## 多角色评审记录".length);
  return { start, end: next < 0 ? plan.length : next };
}

function buildRecord(batch: ReviewBatch, executions: ReviewAgentExecution[], existing = ""): string {
  const facts = roleFacts(existing);
  const conclusion = metadata(existing, "综合结论") ?? "评审中";
  const convergence = metadata(existing, "收敛状态") ?? "等待 reviewer";
  const humanConfirmation = metadata(existing, "人工确认状态") ?? "未请求";
  const automaticEvolutionRound =
    metadata(existing, "自动演进轮次") ?? String(batch.automaticEvolutionRound);
  const findingSection = details(existing, "#### 发现项", "#### 沉淀判定")
    ?? "#### 发现项\n\n| 发现项编号 | 角色 | 证据 | 发现项分类 | 受影响 REQ/caseId | 严重度 | 处置方式 | 修订/裁决证据 | 关闭状态 |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |";
  const depositSection = details(existing, "#### 沉淀判定", "#### 中断恢复卡")
    ?? "#### 沉淀判定\n\n| 发现项编号 | 归属类型 | 目标位置 | 证据状态 | 处理结果 |\n| --- | --- | --- | --- | --- |\n| 无 | 无 | 无 | 无 | 无 |";
  const rowsText = batch.requiredRoles.map((role) => {
    const execution = [...executions].reverse().find((item) => item.role === role && item.status !== "已过期");
    const formal = facts.get(role) ?? { conclusion: "评审中", findingIds: "无", disposition: "等待 reviewer" };
    return `| ${role} | 真实子智能体 | ${execution?.agentTaskId ?? "—"} | fork_turns=none | ${execution?.inputPathSummary.join("；") ?? "等待资源"} | ${executionState(execution)} | ${formal.conclusion} | ${formal.findingIds} | ${formal.disposition} |`;
  }).join("\n");
  return `${reviewRecordStart(batch.id)}\n### 评审批次：${batch.id}\n\n| 字段 | 内容 |\n| --- | --- |\n| 批次类型 | ${batch.kind} |\n| 触发类型 | 自动评审 |\n| 输入基线版本 | ${executions.map((item) => item.inputPathSummary.join("；")).find(Boolean) ?? "待派发 reviewer"} |\n| 隔离规则 | fork_turns=none |\n| 自动演进轮次 | ${automaticEvolutionRound} |\n| 综合结论 | ${conclusion} |\n| 收敛状态 | ${convergence} |\n| 人工确认状态 | ${humanConfirmation} |\n\n#### reviewer 执行记录\n\n| 角色 | 执行方式 | Agent 任务标识 | 隔离方式 | 输入基线 | 执行状态 | 结论 | 发现项编号 | 处置状态 |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${rowsText}\n\n${findingSection}\n\n${depositSection}\n${reviewRecordEnd(batch.id)}`;
}

/** Keeps execution facts in the one formal plan block without copying reviewer reasoning to local state. */
export async function syncReviewPlanRecord(planPath: string | undefined, batch: ReviewBatch, executions: ReviewAgentExecution[]): Promise<{ digest: string; syncedAt: string } | undefined> {
  if (!planPath) return undefined;
  const path = resolve(planPath);
  let plan = readFileSync(path, "utf8");
  if (!plan.includes("## 多角色评审记录")) plan = `${plan.trimEnd()}\n\n## 多角色评审记录\n`;
  const start = reviewRecordStart(batch.id);
  const end = reviewRecordEnd(batch.id);
  const section = reviewSectionRange(plan);
  const existingStart = plan.indexOf(start);
  const existing = existingStart >= section.start && existingStart < section.end ? between(plan, start, end) : undefined;
  const legacy = existing === undefined ? legacyBatch(plan, batch.id) : undefined;
  const record = buildRecord(batch, executions, existing ?? legacy?.content ?? "");
  const next = existing !== undefined
    ? `${plan.slice(0, plan.indexOf(start))}${record}${plan.slice(plan.indexOf(end) + end.length)}`
    : legacy && legacy.start >= section.start
      ? `${plan.slice(0, legacy.start)}${record}${plan.slice(legacy.end)}`
      : legacy
        ? (() => {
            const withoutLegacy = `${plan.slice(0, legacy.start)}${plan.slice(legacy.end)}`;
            const range = reviewSectionRange(withoutLegacy);
            return `${withoutLegacy.slice(0, range.end).trimEnd()}\n\n${record}\n${withoutLegacy.slice(range.end)}`;
          })()
      : (() => {
          const range = reviewSectionRange(plan);
          return `${plan.slice(0, range.end).trimEnd()}\n\n${record}\n${plan.slice(range.end)}`;
        })();
  if (next !== plan) await atomicWriteText(path, next);
  const persisted = readFileSync(path, "utf8");
  const range = reviewSectionRange(persisted);
  const persistedSection = persisted.slice(range.start, range.end);
  if (persistedSection.split(reviewRecordStart(batch.id)).length - 1 !== 1 || !persistedSection.includes(reviewRecordEnd(batch.id))) {
    throw new Error(`plan.md 的 ${batch.id} canonical 正式评审批次未唯一落在 ## 多角色评审记录 内。`);
  }
  for (const execution of executions.filter((item) => item.status !== "已过期")) {
    if (!persistedSection.includes(`| ${execution.role} | 真实子智能体 | ${execution.agentTaskId} |`)) {
      throw new Error(`plan.md 的 ${batch.id}/${execution.role} reviewer 行与本机运行事实不一致。`);
    }
  }
  const recordStart = persisted.indexOf(reviewRecordStart(batch.id), range.start);
  const recordEnd = persisted.indexOf(reviewRecordEnd(batch.id), recordStart);
  const recordText = persisted.slice(recordStart, recordEnd + reviewRecordEnd(batch.id).length);
  return { digest: createHash("sha256").update(recordText, "utf8").digest("hex"), syncedAt: new Date().toISOString() };
}

function replaceRow(content: string, role: ReviewRole, replacement: string): string {
  const lines = content.split("\n");
  const index = lines.findIndex((line) => line.startsWith(`| ${role} | 真实子智能体 |`));
  if (index < 0) throw new Error(`plan.md 缺少 ${role} reviewer 执行记录。`);
  lines[index] = replacement;
  return lines.join("\n");
}

function cellsForLine(line: string): string[] | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || /^\|\s*-{3,}/.test(trimmed)) return undefined;
  return trimmed.split("|").slice(1, -1).map((cell) => cell.trim());
}

/** Removes the prior formal payload for one role before writing a retry. This
 * closes the write-before-runtime-commit recovery window without duplicating
 * canonical findings or knowledge decisions. */
function removeSubmittedPayload(content: string, role: ReviewRole): string {
  const previousIds = (roleFacts(content).get(role)?.findingIds ?? "无")
    .split("、")
    .map((id) => id.trim())
    .filter((id) => id && id !== "无");
  return content.split("\n").filter((line) => {
    const cells = cellsForLine(line);
    if (!cells) return true;
    if (cells.length === 9 && cells[1] === role) return false;
    return !(cells.length === 5 && previousIds.includes(cells[0] ?? ""));
  }).join("\n");
}

/** Writes formal reviewer conclusions and findings before runtime completion is
 * committed. Callers must validate the result before changing local state. */
export async function submitReviewPlanRecord(input: {
  planPath: string | undefined;
  batch: ReviewBatch;
  execution: ReviewAgentExecution;
  submission: ReviewAgentSubmission;
  allExecutions: ReviewAgentExecution[];
}): Promise<void> {
  if (!input.planPath) throw new Error("TASK-04 缺少 plan.md 路径，无法提交 reviewer 结果。");
  const path = resolve(input.planPath);
  const plan = readFileSync(path, "utf8");
  const start = plan.indexOf(reviewRecordStart(input.batch.id));
  const end = plan.indexOf(reviewRecordEnd(input.batch.id), start);
  if (start < 0 || end < 0) throw new Error(`plan.md 缺少 ${input.batch.id} canonical 正式评审批次。`);
  const before = plan.slice(0, start);
  let record = plan.slice(start, end + reviewRecordEnd(input.batch.id).length);
  record = removeSubmittedPayload(record, input.execution.role);
  const otherActive = input.batch.requiredRoles.filter((role) => role !== input.execution.role && !input.allExecutions.some((item) => item.role === role && item.status === "已完成"));
  const overall = input.submission.conclusion === "阻塞"
    ? "阻塞"
    : input.submission.conclusion === "需演进"
      ? "需演进"
      : otherActive.length === 0 ? "可提交确认" : "评审中";
  const convergence = overall === "可提交确认" ? "已收敛" : overall === "阻塞" ? "阻塞" : overall === "需演进" ? "继续自动演进" : "等待 reviewer";
  record = record.replace(/\| 综合结论 \| .*? \|/, `| 综合结论 | ${overall} |`)
    .replace(/\| 收敛状态 \| .*? \|/, `| 收敛状态 | ${convergence} |`);
  const findingIds = input.submission.findings.map((finding) => finding.id).join("、") || "无";
  const disposition = input.submission.findings.length === 0 ? "已关闭" : input.submission.findings.every((finding) => finding.status === "已关闭" || finding.status === "不适用") ? "已关闭" : input.submission.findings.some((finding) => finding.disposition === "自动演进") ? "自动演进" : "待处理";
  record = replaceRow(record, input.execution.role, `| ${input.execution.role} | 真实子智能体 | ${input.execution.agentTaskId} | fork_turns=none | ${input.execution.inputPathSummary.join("；")} | 已完成 | ${input.submission.conclusion} | ${findingIds} | ${disposition} |`);
  const findingRows = input.submission.findings.map((finding) => `| ${finding.id} | ${input.execution.role} | ${finding.evidence} | ${finding.category} | ${finding.affectedRefs} | ${finding.severity} | ${finding.disposition} | ${finding.resolutionEvidence} | ${finding.status} |`).join("\n");
  const decisionRows = input.submission.findings.map((finding) => `| ${finding.id} | ${finding.knowledgeDecision.ownership} | ${finding.knowledgeDecision.target} | ${finding.knowledgeDecision.evidenceStatus} | ${finding.knowledgeDecision.result} |`).join("\n");
  if (findingRows) record = record.replace("#### 沉淀判定", `${findingRows}\n\n#### 沉淀判定`);
  if (decisionRows) record = record.replace("| 无 | 无 | 无 | 无 | 无 |", decisionRows);
  await atomicWriteText(path, `${before}${record}${plan.slice(end + reviewRecordEnd(input.batch.id).length)}`);
}

/** Converts a live legacy batch to one canonical block. Historical completed batches are never touched. */
export async function migrateActiveReviewPlanRecord(planPath: string | undefined, batch: ReviewBatch, executions: ReviewAgentExecution[]): Promise<void> {
  if (!planPath) throw new Error("迁移评审批次需要 plan.md 路径。");
  const path = resolve(planPath);
  let plan = readFileSync(path, "utf8");
  if (!plan.includes("## 多角色评审记录")) plan = `${plan.trimEnd()}\n\n## 多角色评审记录\n`;
  if (plan.includes(reviewRecordStart(batch.id))) {
    await syncReviewPlanRecord(path, batch, executions);
    return;
  }
  const escaped = batch.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(`^#{2,3}[^\\n]*${escaped}[^\\n]*$`, "gm");
  const match = heading.exec(plan);
  const nextHeading = match ? /^#{2,3}\s/m.exec(plan.slice(match.index + match[0].length)) : undefined;
  const legacyEnd = match ? (nextHeading ? match.index + match[0].length + nextHeading.index! : plan.length) : undefined;
  const legacyContent = match && legacyEnd !== undefined ? plan.slice(match.index, legacyEnd) : "";
  const record = buildRecord(batch, executions, legacyContent);
  const withoutLegacy = match && legacyEnd !== undefined
    ? `${plan.slice(0, match.index)}${plan.slice(legacyEnd)}`.trimEnd()
    : plan.trimEnd();
  const range = reviewSectionRange(withoutLegacy);
  await atomicWriteText(path, `${withoutLegacy.slice(0, range.end).trimEnd()}\n\n${record}\n${withoutLegacy.slice(range.end)}`);
}

export function isCanonicalReviewRecord(plan: string, batchId: string): boolean {
  try {
    const range = reviewSectionRange(plan);
    const section = plan.slice(range.start, range.end);
    return section.includes(reviewRecordStart(batchId)) && section.includes(reviewRecordEnd(batchId));
  } catch {
    return false;
  }
}

/** Returns the digest only when the one canonical record is inside its formal section. */
export function reviewPlanRecordDigest(planPath: string | undefined, batchId: string): string | undefined {
  if (!planPath) return undefined;
  const plan = readFileSync(resolve(planPath), "utf8");
  const range = reviewSectionRange(plan);
  const start = plan.indexOf(reviewRecordStart(batchId), range.start);
  const end = start < 0 ? -1 : plan.indexOf(reviewRecordEnd(batchId), start);
  if (start < range.start || end < 0 || end > range.end) return undefined;
  return createHash("sha256").update(plan.slice(start, end + reviewRecordEnd(batchId).length), "utf8").digest("hex");
}
