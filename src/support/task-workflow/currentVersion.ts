/**
 * 调试基线只允许一种可执行工作流定义。旧 request 不迁移也不回放：
 * Git 历史和 workflow-baseline.md 负责保留切换原因，而不是运行时兼容代码。
 */
export const CURRENT_WORKFLOW_VERSION = "v1" as const;

export function isCurrentWorkflowVersion(value: string): boolean {
  return value === CURRENT_WORKFLOW_VERSION;
}
