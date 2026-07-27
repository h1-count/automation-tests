/** Local-only task orchestration state. It is intentionally separate from
 * business requirements, test evidence, and runner data. */
export const taskPhases = [
  "计划",
  "计划确认",
  "用例",
  "评审",
  "用例确认",
  "工程设计",
  "脚本与执行"
] as const;

export type TestTaskPhase = (typeof taskPhases)[number];
export type TaskItemStatus = "待开始" | "进行中" | "已完成" | "等待确认" | "阻塞" | "跳过";
export type TaskOverallStatus = "进行中" | "等待确认" | "阻塞" | "已完成";
export const stageRunStates = [
  "active", "internal_wait", "waiting_confirmation", "blocked", "completed", "cancelled"
] as const;
export type StageRunState = (typeof stageRunStates)[number];
export type InternalWaitKind = "reviewer" | "capacity" | "tool" | "retry";
export type BlockerCategory = "资料" | "用户裁决" | "环境" | "数据" | "安全挑战" | "工具" | "代码";
/** Durable, small work units. They deliberately contain only safe summaries
 * and repository-relative artifact references; plan.md remains the source of
 * formal requirements and review conclusions. */
export const shortTransactionKinds = [
  "资料筛选", "计划校验", "计划确认", "用例包生成", "关系同步", "静态检查",
  "reviewer派发", "reviewer收集", "自动演进", "最终复审", "用例确认", "工程设计", "脚本评审", "执行授权", "执行", "报告", "正式资产变更确认"
] as const;
export type ShortTransactionKind = (typeof shortTransactionKinds)[number];
export type ShortTransactionStatus = "待开始" | "进行中" | "已完成" | "等待确认" | "阻塞" | "跳过" | "已取消";
export const blockerResolutionOptions = ["重试", "等待外部恢复", "提供资料或裁决", "跳过受影响范围", "取消"] as const;
export type BlockerResolutionOption = (typeof blockerResolutionOptions)[number];

export interface ShortTransaction {
  id: string;
  kind: ShortTransactionKind;
  taskId: string;
  sequence: number;
  status: ShortTransactionStatus;
  inputSnapshot: string;
  preconditions: string[];
  action: string;
  expectedOutputs: string[];
  verification: string;
  dependencies: string[];
  retryCount: number;
  maxRetries: number;
  retryBlockerFact?: string;
  requiresConfirmation?: boolean;
  confirmationId?: string;
  blockerId?: string;
  claimedAt?: string;
  claimToken?: string;
  claimOwner?: string;
  leaseExpiresAt?: string;
  committedAt?: string;
  outputRefs?: string[];
  verificationResult?: string;
}

export interface ShortTransactionAction {
  transactionId: string;
  kind: ShortTransactionKind;
  status: ShortTransactionStatus;
  action: string;
  verification: string;
  gate?: "确认" | "阻塞";
  claimToken?: string;
  claimOwner?: string;
  leaseExpiresAt?: string;
}

export interface ExecutionEnvelope {
  schemaVersion: "execution-envelope-v1";
  requestId: string;
  phase?: TestTaskPhase;
  state: StageRunState;
  currentTransactionId?: string;
  nextAction: ShortTransactionAction | null;
  internalWait?: {
    kind: InternalWaitKind;
    refs: string[];
    pollAfterSeconds: number;
  };
  reply: {
    allowed: boolean;
    reason: "confirmation" | "blocker" | "completed" | "cancelled" | "runnable" | "internal_wait";
  };
  resumeAt?: string;
  hostContinuation: {
    required: boolean;
    status: "unbound" | "active" | "paused" | "deleted";
    automationId?: string;
  };
}
export type TaskOutputChange = "新增" | "更新" | "引用";
export type TaskOutputPreviewKind = "markdown" | "image" | "video" | "html-report" | "trace" | "file";

/** A safe, repository-relative artifact that may be shown in the user-facing
 * output card. It never points at local state, credentials, or source inputs. */
export interface TaskOutputRef {
  taskId: string;
  path: string;
  change: TaskOutputChange;
  previewKind: TaskOutputPreviewKind;
  updatedAt: string;
}

/** These are the only reviewers that may satisfy the testcase review gate. */
export const baseReviewRoles = ["需求一致性评审", "测试设计评审", "追溯审计"] as const;
export const reviewRoles = [...baseReviewRoles, "交互与状态专项评审", "变更影响评审"] as const;
export type ReviewRole = (typeof reviewRoles)[number];
export type ReviewAgentExecutionStatus = "已启动" | "已完成" | "已过期" | "失败" | "超时";
export type ReviewBatchKind = "初审" | "最终复审";
export type ReviewBatchStatus = "进行中" | "已完成" | "失效";
export const maxAutomaticEvolutionRounds = 3;
export const maxConcurrentReviewers = 3;

export interface TaskPlanItem {
  id: string;
  phase: TestTaskPhase;
  task: string;
  entryCondition: string;
  completionCriteria: string;
  status: TaskItemStatus;
  detail?: string;
  dependencies?: string[];
  affectedRefs?: string[];
  evidence?: string;
  updatedAt: string;
}

export interface TaskBlocker {
  id: string;
  category: BlockerCategory;
  fact: string;
  affectedTaskIds: string[];
  affectedRefs?: string[];
  resolutionCondition: string;
  owner: "用户" | "环境" | "Agent" | "外部系统";
  status: "未解除" | "已解除";
  createdAt: string;
  resolvedAt?: string;
  resolutionEvidence?: string;
}

export interface TaskConfirmation {
  id: string;
  question: string;
  affectedTaskIds: string[];
  /** Confirmation may release only these durable transactions. */
  affectedTransactionIds?: string[];
  safeDefault: string;
  continueAction: string;
  status: "待确认" | "已确认" | "已失效";
  createdAt: string;
  decidedAt?: string;
  decision?: string;
}

export const executionOperationKinds = [
  "send_test_otp",
  "upload_synthetic_file",
  "accept_agreement",
  "submit_registration",
  "create_test_resource",
  "query_postcondition",
  "cleanup_test_resource",
  "retain_tracked_residual"
] as const;
export type ExecutionOperationKind = (typeof executionOperationKinds)[number];

export interface ExecutionAuthorizationSnapshot {
  schemaVersion: "execution-authorization-v1";
  requestId: string;
  environment: string;
  planDigest: string;
  scriptDigests: Array<{ path: string; digest: string }>;
  caseIds: string[];
  allowedOperations: ExecutionOperationKind[];
  resourceBudgets: Array<{ resourceType: string; maxCreates: number }>;
  dataWritePolicy: "no_write" | "managed_cleanup" | "tracked_residual";
  residualTtlHours: number;
  securityChallengePolicy: "test-channel-first-minimal-human";
  artifactPolicy: "retain-with-sensitive-step-redaction";
  digest: string;
  status: "pending" | "confirmed" | "superseded";
  createdAt: string;
  confirmedAt?: string;
  supersededAt?: string;
  confirmationId: string;
}

/** A local audit entry for a reviewer that was actually dispatched by the
 * orchestrator. It deliberately stores no reviewer prompt, reasoning, or
 * business data—only the safe execution envelope needed for gating. */
export interface ReviewAgentExecution {
  id: string;
  batchId: string;
  role: ReviewRole;
  executionMode: "真实子智能体";
  agentTaskId: string;
  isolationMode: "fork_turns=none";
  inputPathSummary: string[];
  /** Digest of the dispatched, reviewable inputs. It excludes the mutable
   * canonical review record so sibling reviewer submissions share a baseline. */
  inputBaselineDigest: string;
  status: ReviewAgentExecutionStatus;
  startedAt: string;
  endedAt?: string;
  failureReason?: string;
}

/** Ephemeral reviewer result supplied to the atomic submit command. Formal
 * reasoning is written only to plan.md and is never persisted in local state. */
export interface ReviewFindingSubmission {
  id: string;
  evidence: string;
  category: "需求覆盖缺口" | "资料明确的设计缺口" | "业务裁决/资料冲突" | "质量建议";
  affectedRefs: string;
  severity: string;
  disposition: "自动演进" | "用户裁决" | "风险登记";
  resolutionEvidence: string;
  status: "待处理" | "待用户裁决" | "已关闭" | "不适用";
  knowledgeDecision: {
    ownership: string;
    target: string;
    evidenceStatus: string;
    result: string;
  };
}

export interface ReviewAgentSubmission {
  conclusion: "通过" | "需演进" | "阻塞";
  findings: ReviewFindingSubmission[];
}

/** A review batch is invalidated whenever the author changes the draft in
 * response to findings. A new final re-review is then required. */
export interface ReviewBatch {
  id: string;
  kind: ReviewBatchKind;
  requiredRoles: ReviewRole[];
  status: ReviewBatchStatus;
  createdAt: string;
  /** Initial review is round 0. Each evidence-backed automatic evolution
   * creates one final re-review, up to maxAutomaticEvolutionRounds. */
  automaticEvolutionRound: number;
  completedAt?: string;
  supersedesBatchId?: string;
  invalidatedAt?: string;
  planEvidenceRef?: string;
  planEvidenceDigest?: string;
  /** Safe artifact locations and an opaque digest prove that the draft changed
   * without duplicating testcase content or reviewer reasoning locally. */
  revisionEvidenceRefs?: string[];
  revisionEvidenceDigest?: string;
}

/** Durable local envelope for an auditable review workflow. Formal reviewer
 * conclusions remain in plan.md; this only records the recovery-safe runtime
 * boundary and the hashes of files involved in a transaction. */
export interface ReviewTransaction {
  id: string;
  batchId: string;
  status: "待派发" | "评审中" | "待恢复" | "已提交";
  requiredRoles: ReviewRole[];
  createdAt: string;
  updatedAt: string;
  inputDigest?: string;
  revisionDigest?: string;
  planRecordDigest?: string;
  lastSyncedAt?: string;
  recoveryAction?: string;
  committedAt?: string;
}

export interface TaskStateEvent {
  id?: string;
  revision?: number;
  at: string;
  type: "initialized" | "resumed" | "task_updated" | "outputs_recorded" | "blocker_added" | "blocker_resolved" | "confirmation_requested" | "confirmation_recorded" | "confirmation_superseded" | "execution_authorization_created" | "execution_scope_reopened" | "review_batch_started" | "reviewer_started" | "reviewer_completed" | "reviewer_failed" | "review_batch_invalidated" | "review_transaction_reconciled" | "review_convergence_blocked" | "review_batch_completed" | "review_record_synced" | "review_record_sync_failed" | "plan_confirmed" | "transaction_claimed" | "transaction_committed" | "transaction_retried" | "transaction_blocked" | "wake_requested" | "wake_dispatched" | "wake_failed";
  summary: string;
  taskId?: string;
  blockerId?: string;
  confirmationId?: string;
  reviewBatchId?: string;
  reviewerExecutionId?: string;
  transactionId?: string;
}

export interface HostContinuationBinding {
  kind: "thread-heartbeat";
  automationId?: string;
  sessionId: string;
  status: "active" | "paused" | "deleted" | "unavailable";
  updatedAt: string;
}

export interface WakeRequest {
  id: string;
  transactionId: string;
  reason: string;
  status: "待派发" | "已派发" | "失败";
  createdAt: string;
  updatedAt: string;
  failureReason?: string;
}

export interface TestTaskState {
  schemaVersion: "test-task-state-v10";
  revision: number;
  requestId: string;
  planPath?: string;
  createdAt: string;
  updatedAt: string;
  overallStatus: TaskOverallStatus;
  tasks: TaskPlanItem[];
  blockers: TaskBlocker[];
  confirmations: TaskConfirmation[];
  executionAuthorization?: ExecutionAuthorizationSnapshot;
  reviewBatches: ReviewBatch[];
  reviewExecutions: ReviewAgentExecution[];
  reviewTransactions: ReviewTransaction[];
  shortTransactions: ShortTransaction[];
  activeShortTransactionId?: string;
  wakeRequests: WakeRequest[];
  hostContinuation?: HostContinuationBinding;
  /** Only the latest conversation round. Historical artifacts remain in their
   * formal plan, package, script, or report instead of being copied locally. */
  currentOutputs: TaskOutputRef[];
  recentEvents: TaskStateEvent[];
}

export interface StartOrResumeInput {
  requestId: string;
  planPath?: string;
  tasks?: Omit<TaskPlanItem, "updatedAt">[];
}

export interface UpdateTaskInput {
  status: TaskItemStatus;
  detail?: string;
  evidence?: string;
}

export interface RecordTaskOutputsInput {
  taskId: string;
  change: TaskOutputChange;
  paths?: string[];
  noPersistentOutput?: boolean;
}

export interface CommitShortTransactionInput {
  outputPaths?: string[];
  noPersistentOutput?: boolean;
  verificationResult: string;
  inputSnapshot?: string;
  claimToken?: string;
}

export interface StartReviewBatchInput {
  batchId: string;
  kind: ReviewBatchKind;
  requiredRoles?: ReviewRole[];
  supersedesBatchId?: string;
}

export interface StartReviewTransactionInput {
  transactionId: string;
  batchId: string;
  kind: ReviewBatchKind;
  requiredRoles: ReviewRole[];
  supersedesBatchId?: string;
}

export interface InvalidateReviewBatchForEvolutionInput {
  batchId: string;
  revisionPaths: string[];
}

export interface StartReviewAgentInput {
  executionId: string;
  batchId: string;
  role: ReviewRole;
  agentTaskId: string;
  inputPathSummary: string[];
}

export interface CreateExecutionAuthorizationInput {
  environment: string;
  caseIds: string[];
  scriptPaths: string[];
  allowedOperations: ExecutionOperationKind[];
  resourceBudgets: Array<{ resourceType: string; maxCreates: number }>;
  dataWritePolicy: ExecutionAuthorizationSnapshot["dataWritePolicy"];
  residualTtlHours?: number;
}
