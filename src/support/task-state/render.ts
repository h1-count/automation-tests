import type { TaskBlocker, TaskConfirmation, TaskPlanItem, TestTaskState } from "./types.js";
import { assertSafeOutputPath, previewAction, previewKindLabel, toProjectFileLink } from "./taskOutput.js";

function clean(value: string | undefined): string {
  if (!value) return "无";
  return value.replace(/[\r\n|]+/g, " ").trim() || "无";
}

function actionFor(task: TaskPlanItem, blockers: TaskBlocker[], confirmations: TaskConfirmation[]): string {
  const blocker = blockers.find((item) => item.status === "未解除" && item.affectedTaskIds.includes(task.id));
  if (blocker) return `阻断：${clean(blocker.fact)}；解除：${clean(blocker.resolutionCondition)}`;
  const confirmation = confirmations.find((item) => item.status === "待确认" && item.affectedTaskIds.includes(task.id));
  if (confirmation) return `请确认：${clean(confirmation.question)}`;
  if (task.status === "已完成") return clean(task.evidence ?? task.detail ?? "已满足完成标志");
  if (task.status === "跳过") return clean(task.detail ?? "不适用");
  return clean(task.detail ?? task.entryCondition);
}

/** The default user-facing progress card. Detailed state stays local and can
 * be rendered separately for diagnostics. */
export function renderCompactStatusCard(state: TestTaskState): string {
  const completed = state.tasks.filter((task) => task.status === "已完成" || task.status === "跳过").length;
  const current = state.tasks.find((task) => task.status === "进行中")
    ?? state.tasks.find((task) => task.status === "等待确认" || task.status === "阻塞")
    ?? state.tasks.find((task) => task.status === "待开始");
  const rows = state.tasks.map((task) => `| ${task.phase} | ${clean(task.task)} | ${task.status} | ${actionFor(task, state.blockers, state.confirmations)} |`);
  const transaction = state.activeShortTransactionId
    ? state.shortTransactions.find((item) => item.id === state.activeShortTransactionId)
    : state.shortTransactions.find((item) => ["进行中", "阻塞", "等待确认", "待开始"].includes(item.status));
  return [
    "### 测试任务进度",
    "",
    `整体状态：${state.overallStatus}；进度：${completed}/${state.tasks.length} 个任务完成${current ? `；当前：${current.phase} / ${clean(current.task)}` : ""}。`,
    transaction ? `当前短事务：${transaction.id} / ${transaction.kind} / ${transaction.status}；动作：${clean(transaction.action)}。` : "当前短事务：无。",
    "",
    "| 阶段 | 任务 | 状态 | 当前结论 / 需要动作 |",
    "| --- | --- | --- | --- |",
    ...rows
  ].join("\n");
}

export function renderTaskOutputCard(state: TestTaskState, workspaceRoot: string): string {
  const safeLink = (path: string, label?: string): string | null => {
    try {
      const safePath = assertSafeOutputPath(path, workspaceRoot);
      return toProjectFileLink(safePath, workspaceRoot, label);
    } catch {
      return null;
    }
  };
  const plan = state.planPath ? safeLink(state.planPath, "当前测试计划") ?? "未登记当前测试计划" : "未登记当前测试计划";
  const outputs = state.currentOutputs.flatMap((output) => {
    const link = safeLink(output.path);
    return link ? [{ output, link }] : [];
  });
  const rows = [
    `| 当前计划 | 固定入口 | ${plan} | 打开预览 |`
  ];
  if (outputs.length === 0) {
    rows.push("| 本轮变更 | 无 | 本轮无持久化文件变更。 | 无 |");
  } else {
    rows.push(...outputs.map(({ output, link }) => `| ${output.change} | ${previewKindLabel(output.previewKind)} | ${link} | ${previewAction(output.previewKind)} |`));
  }
  return [
    "### 本轮产出",
    "",
    "| 类型 | 状态 | 产出 | 预览方式 |",
    "| --- | --- | --- | --- |",
    ...rows
  ].join("\n");
}
