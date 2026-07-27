import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { TaskStateConflictError, TaskStateStore } from "./taskStateStore.js";
import { renderCompactStatusCard, renderTaskOutputCard } from "./render.js";
import { readReviewPlanEvidence } from "./reviewPlanEvidence.js";
import { reviewPlanRecordDigest, submitReviewPlanRecord, syncReviewPlanRecord } from "./reviewPlanRecord.js";
import { assertSafeOutputPath, inferPreviewKind } from "./taskOutput.js";
import { atomicWrite } from "../test-data/ledgerStore.js";
import {
  baseReviewRoles,
  maxAutomaticEvolutionRounds,
  maxConcurrentReviewers,
  reviewRoles,
  taskPhases,
  type ReviewAgentExecution,
  type ReviewAgentSubmission,
  type ReviewAgentExecutionStatus,
  type ReviewBatch,
  type ReviewRole,
  type InvalidateReviewBatchForEvolutionInput,
  type RecordTaskOutputsInput,
  type StartOrResumeInput,
  type StartReviewAgentInput,
  type StartReviewBatchInput,
  type StartReviewTransactionInput,
  type TaskBlocker,
  type TaskConfirmation,
  type TaskItemStatus,
  type TaskPlanItem,
  type ShortTransaction,
  type ShortTransactionAction,
  type CommitShortTransactionInput,
  type CreateExecutionAuthorizationInput,
  type ExecutionAuthorizationSnapshot,
  type ExecutionEnvelope,
  type BlockerResolutionOption,
  type TestTaskState,
  type UpdateTaskInput
} from "./types.js";

const shortTransactionLeaseMs = 180_000;
const sensitiveKey = /(password|passwd|token|secret|cookie|session|authorization|credential|api[_-]?key)/i;
const sensitiveValue = /(bearer\s+\S+|(?:password|passwd|token|secret|cookie|session|authorization|api[_-]?key)\s*[:=]\s*\S+)/i;

function reviewInputDigest(workspaceRoot: string, paths: string[]): string {
  const digest = createHash("sha256");
  for (const path of [...paths].sort()) {
    const resolved = resolve(workspaceRoot, path);
    let content = "<missing>";
    try { content = readFileSync(resolved, "utf8"); } catch { /* external references may be unavailable locally */ }
    if (/plan\.md$/i.test(path)) content = content.replace(/## 多角色评审记录[\s\S]*$/m, "## 多角色评审记录\n");
    digest.update(`${path}\0${content}\0`, "utf8");
  }
  return digest.digest("hex");
}

const defaultTasks: Omit<TaskPlanItem, "updatedAt">[] = [
  { id: "TASK-01", phase: "计划", task: "资料读取、范围与环境预检", entryCondition: "用户提出测试需求", completionCriteria: "测试计划形成", status: "进行中" },
  { id: "TASK-02", phase: "计划确认", task: "确认范围、环境、推断与数据策略", entryCondition: "计划已生成", completionCriteria: "用户确认计划", status: "待开始", dependencies: ["TASK-01"] },
  { id: "TASK-03", phase: "用例", task: "生成全部用例包与追溯", entryCondition: "计划已确认", completionCriteria: "用例包和 REQ ↔ caseId 闭环", status: "待开始", dependencies: ["TASK-02"] },
  { id: "TASK-04", phase: "评审", task: "多角色评审、自动演进与复审", entryCondition: "用例草案完整", completionCriteria: "明确需求缺口关闭", status: "待开始", dependencies: ["TASK-03"] },
  { id: "TASK-05", phase: "用例确认", task: "确认用例集与剩余业务裁决", entryCondition: "评审完成", completionCriteria: "用户确认用例", status: "待开始", dependencies: ["TASK-04"] },
  { id: "TASK-06", phase: "工程设计", task: "仓库、Graphify、数据与脚本方案定位", entryCondition: "用例已确认", completionCriteria: "工程设计待审核", status: "待开始", dependencies: ["TASK-05"] },
  { id: "TASK-07", phase: "脚本与执行", task: "生成脚本、确认并执行", entryCondition: "设计和执行授权完成", completionCriteria: "报告与复盘完成", status: "待开始", dependencies: ["TASK-06"] }
];

const shortTransactionBlueprints: Array<Omit<ShortTransaction, "status" | "inputSnapshot" | "retryCount">> = [
  { id: "STX-01", kind: "资料筛选", taskId: "TASK-01", sequence: 1, preconditions: ["测试请求已创建"], action: "筛选已登记且与本请求相关的资料，记录选择依据。", expectedOutputs: ["plan.md"], verification: "核验 sources/manifest.yaml 与 plan.md 的资料追溯。", dependencies: [], maxRetries: 2 },
  { id: "STX-02", kind: "计划校验", taskId: "TASK-01", sequence: 2, preconditions: ["资料筛选已提交"], action: "校验测试计划范围、环境预检与未定义验收项。", expectedOutputs: ["plan.md"], verification: "运行 npm run check:environment -- --plan 并回填脱敏结果。", dependencies: ["STX-01"], maxRetries: 2 },
  { id: "STX-03", kind: "计划确认", taskId: "TASK-02", sequence: 3, preconditions: ["计划校验已提交"], action: "等待用户确认计划范围；确认后执行受控计划迁移。", expectedOutputs: ["plan.md"], verification: "核验 plan.md 的基本信息状态为已确认。", dependencies: ["STX-02"], maxRetries: 1, requiresConfirmation: true },
  { id: "STX-04", kind: "用例包生成", taskId: "TASK-03", sequence: 4, preconditions: ["计划已确认"], action: "生成一个完整用例包并登记 REQ → RULE → caseId。", expectedOutputs: ["testcases/"], verification: "校验用例包结构及可追溯字段。", dependencies: ["STX-03"], maxRetries: 2 },
  { id: "STX-05", kind: "关系同步", taskId: "TASK-03", sequence: 5, preconditions: ["用例包已生成"], action: "同步需求、规则与 caseId 关系。", expectedOutputs: ["plan.md"], verification: "核验所有已引用 REQ 均有 RULE 与 caseId 闭环。", dependencies: ["STX-04"], maxRetries: 2 },
  { id: "STX-06", kind: "静态检查", taskId: "TASK-03", sequence: 6, preconditions: ["关系已同步"], action: "运行规则设计预检、结构与追溯静态检查并修复普通遗漏。", expectedOutputs: ["plan.md"], verification: "运行 npm run check:rule-design -- <plan.md> 与 npm run check:architecture。", dependencies: ["STX-05"], maxRetries: 2 },
  { id: "STX-07", kind: "reviewer派发", taskId: "TASK-04", sequence: 7, preconditions: ["用例静态检查已通过"], action: "建立评审事务并派发一个隔离 reviewer。", expectedOutputs: ["plan.md"], verification: "核验真实 Agent 标识和 fork_turns=none 已登记。", dependencies: ["STX-06"], maxRetries: 2 },
  { id: "STX-08", kind: "reviewer收集", taskId: "TASK-04", sequence: 8, preconditions: ["reviewer 已派发"], action: "收集一个 reviewer 结果并同步正式评审记录。", expectedOutputs: ["plan.md"], verification: "核验 canonical REV 区块与本机运行事实一致。", dependencies: ["STX-07"], maxRetries: 2 },
  { id: "STX-09", kind: "自动演进", taskId: "TASK-04", sequence: 9, preconditions: ["评审发现已分类"], action: "自动修订资料已明确的用例缺口并登记修订证据。", expectedOutputs: ["testcases/", "plan.md"], verification: "核验修订证据和待处理自动演进项均已关闭。", dependencies: ["STX-08"], maxRetries: 3 },
  { id: "STX-10", kind: "最终复审", taskId: "TASK-04", sequence: 10, preconditions: ["自动演进已收敛"], action: "启动并提交最终复审事务。", expectedOutputs: ["plan.md"], verification: "核验最终复审、正式记录和 TASK-04 一致。", dependencies: ["STX-09"], maxRetries: 3 },
  { id: "STX-11", kind: "用例确认", taskId: "TASK-05", sequence: 11, preconditions: ["最终复审已收敛"], action: "等待用户确认用例集与剩余业务裁决。", expectedOutputs: ["plan.md"], verification: "核验用例集确认已登记。", dependencies: ["STX-10"], maxRetries: 1, requiresConfirmation: true },
  { id: "STX-12", kind: "工程设计", taskId: "TASK-06", sequence: 12, preconditions: ["用例集已确认"], action: "完成仓库、数据与脚本工程设计。", expectedOutputs: ["plan.md"], verification: "核验工程设计与已确认用例一致。", dependencies: ["STX-11"], maxRetries: 2 },
  { id: "STX-12A", kind: "工程设计", taskId: "TASK-06", sequence: 12.5, preconditions: ["工程设计已提交"], action: "自动校验工程设计、执行操作和数据预算映射。", expectedOutputs: ["plan.md"], verification: "核验全部确认用例均映射到脚本、执行操作和数据策略。", dependencies: ["STX-12"], maxRetries: 2 },
  { id: "STX-13", kind: "脚本评审", taskId: "TASK-07", sequence: 13, preconditions: ["工程设计已校验"], action: "生成并评审完整可执行脚本及安全边界。", expectedOutputs: ["tests/"], verification: "运行相关静态检查、零写入探索测试和脚本评审。", dependencies: ["STX-12A"], maxRetries: 2 },
  { id: "STX-14", kind: "执行授权", taskId: "TASK-07", sequence: 14, preconditions: ["完整脚本已评审"], action: "等待用户一次确认不可变执行清单。", expectedOutputs: ["plan.md"], verification: "核验计划、脚本摘要、caseId、操作、资源预算与数据策略已绑定。", dependencies: ["STX-13"], maxRetries: 1, requiresConfirmation: true },
  { id: "STX-15", kind: "执行", taskId: "TASK-07", sequence: 15, preconditions: ["执行授权已确认"], action: "在已授权的隔离环境执行测试。", expectedOutputs: ["artifacts/"], verification: "核验执行记录、脱敏产物与用例结果。", dependencies: ["STX-14"], maxRetries: 1 },
  { id: "STX-16", kind: "报告", taskId: "TASK-07", sequence: 16, preconditions: ["执行已完成"], action: "生成测试报告。", expectedOutputs: ["artifacts/"], verification: "核验报告引用的执行证据完整。", dependencies: ["STX-15"], maxRetries: 2 },
  { id: "STX-17", kind: "正式资产变更确认", taskId: "TASK-07", sequence: 17, preconditions: ["报告已完成"], action: "等待正式资产变更确认。", expectedOutputs: ["plan.md"], verification: "核验正式资产变更决定已登记。", dependencies: ["STX-16"], maxRetries: 1, requiresConfirmation: true }
];

function createShortTransactions(timestamp: string): ShortTransaction[] {
  return shortTransactionBlueprints.map((item) => ({ ...item, status: "待开始", inputSnapshot: `created:${timestamp}`, retryCount: 0, preconditions: [...item.preconditions], expectedOutputs: [...item.expectedOutputs], dependencies: [...item.dependencies] }));
}

function upgradeShortTransactionQueue(state: TestTaskState): void {
  const timestamp = now();
  const blueprintById = new Map(shortTransactionBlueprints.map((item) => [item.id, item]));
  for (const transaction of state.shortTransactions) {
    const blueprint = blueprintById.get(transaction.id);
    if (blueprint && transaction.kind !== blueprint.kind) {
      Object.assign(transaction, { ...blueprint, status: "待开始", inputSnapshot: `migrated-v8:${timestamp}`, retryCount: 0, preconditions: [...blueprint.preconditions], expectedOutputs: [...blueprint.expectedOutputs], dependencies: [...blueprint.dependencies], committedAt: undefined, outputRefs: undefined, verificationResult: undefined, confirmationId: undefined });
    } else if (blueprint) {
      Object.assign(transaction, {
        kind: blueprint.kind,
        taskId: blueprint.taskId,
        sequence: blueprint.sequence,
        preconditions: [...blueprint.preconditions],
        action: blueprint.action,
        expectedOutputs: [...blueprint.expectedOutputs],
        verification: blueprint.verification,
        dependencies: [...blueprint.dependencies],
        maxRetries: blueprint.maxRetries,
        requiresConfirmation: blueprint.requiresConfirmation
      });
    }
  }
  const known = new Set(state.shortTransactions.map((item) => item.id));
  for (const blueprint of shortTransactionBlueprints) {
    if (!known.has(blueprint.id)) {
      state.shortTransactions.push({ ...blueprint, status: "待开始", inputSnapshot: `migrated:${timestamp}`, retryCount: 0, preconditions: [...blueprint.preconditions], expectedOutputs: [...blueprint.expectedOutputs], dependencies: [...blueprint.dependencies] });
    }
  }
  for (const confirmation of state.confirmations.filter((item) => item.status === "待确认")) {
    const transactionId = confirmation.affectedTransactionIds?.[0];
    const transaction = transactionId ? state.shortTransactions.find((item) => item.id === transactionId) : undefined;
    if (!transaction || transaction.requiresConfirmation) continue;
    confirmation.status = "已失效";
    confirmation.decidedAt = timestamp;
    confirmation.decision = "v10 迁移：该自动短事务不再需要人工确认。";
    transaction.confirmationId = undefined;
    if (transaction.status === "等待确认") {
      const task = state.tasks.find((item) => item.id === transaction.taskId);
      transaction.status = task?.status === "已完成" ? "已完成" : "待开始";
      if (transaction.status === "已完成") {
        transaction.committedAt ??= timestamp;
        transaction.verificationResult ??= "已保留历史工程设计确认事实；v10 自动校验门禁接管后续变更。";
        transaction.outputRefs ??= state.planPath ? [state.planPath] : [];
      }
    }
  }
  state.shortTransactions.sort((left, right) => left.sequence - right.sequence);
}

export class TestTaskStateManager {
  readonly store: TaskStateStore;

  readonly workspaceRoot: string;

  constructor(requestId: string, root?: string, workspaceRoot = process.cwd()) {
    this.store = new TaskStateStore(requestId, root);
    this.workspaceRoot = workspaceRoot;
  }

  async startOrResume(input: StartOrResumeInput): Promise<TestTaskState> {
    this.assertSafe(input);
    if (input.requestId !== this.store.requestId) {
      throw new Error("The requested task state must use the manager's requestId.");
    }
    const prior = await this.store.read();
    if (prior) {
      await this.store.reconcileAuditLog(prior);
      if (prior.shortTransactions.length === 0) {
        prior.shortTransactions = createShortTransactions(now());
        prior.activeShortTransactionId = undefined;
        await this.record(prior, { at: now(), type: "resumed", summary: "已将历史任务状态升级为短事务队列；未验证阶段不会被自动视为已提交。" });
      } else {
        upgradeShortTransactionQueue(prior);
        await this.record(prior, { at: now(), type: "resumed", summary: "恢复本机测试任务状态。" });
      }
      return prior;
    }
    const timestamp = now();
    const tasks = (input.tasks ?? defaultTasks).map((task) => ({ ...task, dependencies: [...(task.dependencies ?? [])], affectedRefs: [...(task.affectedRefs ?? [])], updatedAt: timestamp }));
    validateTasks(tasks);
    const state: TestTaskState = {
      schemaVersion: "test-task-state-v10",
      revision: 0,
      requestId: input.requestId,
      planPath: input.planPath,
      createdAt: timestamp,
      updatedAt: timestamp,
      overallStatus: determineOverallStatus(tasks, [], []),
      tasks,
      blockers: [],
      confirmations: [],
      reviewBatches: [],
      reviewExecutions: [],
      reviewTransactions: [],
      shortTransactions: createShortTransactions(timestamp),
      wakeRequests: [],
      currentOutputs: [],
      recentEvents: []
    };
    await this.record(state, { at: timestamp, type: "initialized", summary: "已建立测试任务执行清单。" });
    return state;
  }

  async updateTask(taskId: string, input: UpdateTaskInput): Promise<TestTaskState> {
    this.assertSafe(input);
    const state = await this.requireState();
    const task = requireTask(state, taskId);
    if ((input.status === "进行中" || input.status === "已完成" || input.status === "等待确认") && !dependenciesCompleted(state, task)) {
      throw new Error(`Task ${taskId} cannot advance until its dependencies are completed or skipped.`);
    }
    if (input.status === "已完成" && !input.evidence && !task.evidence) {
      throw new Error(`Completed task ${taskId} requires an evidence or artifact reference.`);
    }
    if (taskId === "TASK-04" && input.status === "已完成" && !reviewTaskCanComplete(state)) {
      throw new Error("TASK-04 can only complete after the latest final re-review has all required real reviewer executions completed and no unresolved review blockers.");
    }
    if (input.status === "阻塞" && !state.blockers.some((blocker) => blocker.status === "未解除" && blocker.affectedTaskIds.includes(taskId))) {
      throw new Error(`Blocked task ${taskId} requires a registered blocker with a resolution condition.`);
    }
    task.status = input.status;
    task.detail = input.detail ?? task.detail;
    task.evidence = input.evidence ?? task.evidence;
    task.updatedAt = now();
    await this.record(state, { at: task.updatedAt, type: "task_updated", taskId, summary: `任务更新为${input.status}：${task.task}` });
    return state;
  }

  async recordTaskOutputs(input: RecordTaskOutputsInput): Promise<TestTaskState> {
    this.assertSafe(input);
    const state = await this.requireState();
    requireTask(state, input.taskId);
    const paths = input.paths ?? [];
    if (Boolean(input.noPersistentOutput) === (paths.length > 0)) {
      throw new Error("Record either one or more task outputs or explicitly mark the round as having no persistent output.");
    }
    const timestamp = now();
    state.currentOutputs = paths.map((path) => {
      const safePath = assertSafeOutputPath(path, this.workspaceRoot);
      return { taskId: input.taskId, path: safePath, change: input.change, previewKind: inferPreviewKind(safePath), updatedAt: timestamp };
    });
    const summary = paths.length === 0 ? "本轮无持久化文件变更。" : `已登记本轮 ${paths.length} 个可预览产出。`;
    await this.record(state, { at: timestamp, type: "outputs_recorded", taskId: input.taskId, summary }, false);
    return state;
  }

  /** Starts an auditable review batch. The caller chooses whether a change
   * impact role is applicable; the three basic roles are never optional. */
  async startReviewBatch(input: StartReviewBatchInput): Promise<TestTaskState> {
    void input;
    throw new Error("Use startReviewTransaction so the batch, dispatch intent, and TASK-04 state are persisted together.");
  }

  /** Starts the only supported review workflow entry. The transaction and its
   * batch are persisted together before any external reviewer is dispatched. */
  async startReviewTransaction(input: StartReviewTransactionInput): Promise<TestTaskState> {
    this.assertSafe(input);
    const state = await this.requireState();
    if (state.reviewTransactions.some((transaction) => transaction.id === input.transactionId)) return state;
    const activeTransaction = state.reviewTransactions.find((transaction) =>
      transaction.status !== "已提交" && state.reviewBatches.find((batch) => batch.id === transaction.batchId)?.status === "进行中"
    );
    if (activeTransaction) {
      throw new Error(`Active review transaction ${activeTransaction.id} must be resumed before starting a new batch.`);
    }
    const reviewTask = requireTask(state, "TASK-04");
    if (!dependenciesCompleted(state, reviewTask)) throw new Error("TASK-04 cannot start until testcase generation is completed or skipped.");
    if (!isPlanConfirmed(state.planPath)) throw new Error("进入用例评审前，plan.md 的 ## 基本信息/状态必须已受控确认为“已确认”。");
    if (state.reviewBatches.some((batch) => batch.id === input.batchId)) throw new Error(`Duplicate review batch ID: ${input.batchId}`);
    const requiredRoles = uniqueRoles(input.requiredRoles);
    assertRequiredReviewRoles(requiredRoles);
    let automaticEvolutionRound = 0;
    if (input.supersedesBatchId) {
      const superseded = state.reviewBatches.find((batch) => batch.id === input.supersedesBatchId);
      if (!superseded || superseded.status !== "失效") throw new Error("A superseded review batch must exist and be invalidated before final re-review starts.");
      if (input.kind !== "最终复审") throw new Error("An automatic evolution must start a final re-review batch.");
      automaticEvolutionRound = superseded.automaticEvolutionRound + 1;
      if (automaticEvolutionRound > maxAutomaticEvolutionRounds) throw new Error(`Automatic evolution has reached the ${maxAutomaticEvolutionRounds}-round limit.`);
    }
    const timestamp = now();
    state.reviewBatches.push({ id: input.batchId, kind: input.kind, requiredRoles, status: "进行中", createdAt: timestamp, automaticEvolutionRound, supersedesBatchId: input.supersedesBatchId });
    state.reviewTransactions.push({ id: input.transactionId, batchId: input.batchId, status: "待派发", requiredRoles, createdAt: timestamp, updatedAt: timestamp, recoveryAction: "派发并登记全部待启动 reviewer；未登记的角色不得视为已完成。" });
    this.ensureReviewerShortTransactions(state, input.batchId, requiredRoles, timestamp);
    this.completeInternalTransaction(state, "STX-07", `评审事务 ${input.transactionId} 已建立。`, timestamp);
    if (reviewTask.status !== "阻塞") {
      reviewTask.status = "进行中";
      reviewTask.detail = `评审事务 ${input.transactionId} 已准备，等待派发真实子智能体 reviewer。`;
      reviewTask.updatedAt = timestamp;
    }
    await this.record(state, { at: timestamp, type: "review_batch_started", taskId: "TASK-04", reviewBatchId: input.batchId, summary: `已准备评审事务：${input.transactionId}` });
    await this.syncFormalReviewRecord(state, state.reviewBatches.at(-1)!);
    return state;
  }

  /** Returns the one deterministic recovery action for an active review
   * transaction. It intentionally derives pending roles from durable runtime
   * facts instead of mirroring reviewer conclusions from plan.md. */
  private reviewShortTransactionAction(state: TestTaskState): ShortTransactionAction | null {
    const transaction = [...state.reviewTransactions].reverse().find((item) => {
      if (item.status === "已提交") return false;
      const batch = state.reviewBatches.find((candidate) => candidate.id === item.batchId);
      return batch?.status !== "失效" || item.status === "待恢复";
    });
    if (!transaction) return null;
    const batch = requireReviewBatch(state, transaction.batchId);
    const executions = state.reviewExecutions.filter((item) => item.batchId === transaction.batchId);
    const actionFor = (id: string, action: string, status: ShortTransaction["status"] = "待开始"): ShortTransactionAction => {
      const shortTransaction = requireShortTransaction(state, id);
      return {
        transactionId: shortTransaction.id,
        kind: shortTransaction.kind,
        status,
        action,
        verification: shortTransaction.verification
      };
    };
    for (const execution of executions.filter((item) => item.status === "已完成")) {
      try { readReviewPlanEvidence(state.planPath, batch.id, [execution], { allowPendingFindings: true }); }
      catch {
        return actionFor(
          `STX-REV-${batch.id}-${reviewerKey(execution.role)}-COLLECT`,
          `提交缺失 reviewer 正式结果：${execution.role}；执行 review-transaction-reconcile，禁止切换批次。`,
          "进行中"
        );
      }
    }
    const currentRecordDigest = reviewPlanRecordDigest(state.planPath, batch.id);
    if (!transaction.planRecordDigest || transaction.planRecordDigest !== currentRecordDigest) {
      const role = executions.find((item) => item.status === "已启动" || item.status === "已完成")?.role ?? transaction.requiredRoles[0]!;
      return actionFor(
        `STX-REV-${batch.id}-${reviewerKey(role)}-COLLECT`,
        `修复未同步正式记录：同步并校验评审事务 ${transaction.id} 的 canonical 批次。`,
        "进行中"
      );
    }
    if (transaction.status === "待恢复") {
      const role = executions.find((item) => item.status === "已启动" || item.status === "已完成")?.role ?? transaction.requiredRoles[0]!;
      return actionFor(
        `STX-REV-${batch.id}-${reviewerKey(role)}-COLLECT`,
        `修复未同步正式记录：${transaction.recoveryAction ?? `恢复评审事务 ${transaction.id}`}。`,
        "进行中"
      );
    }
    const failed = executions.find((item) => item.status === "失败" || item.status === "超时");
    if (failed) {
      return {
        ...actionFor(
          `STX-REV-${batch.id}-${reviewerKey(failed.role)}-COLLECT`,
          `处理阻塞：${failed.role} reviewer ${failed.status}，不得降级为主 Agent 自评。`,
          "阻塞"
        ),
        gate: "阻塞"
      };
    }
    const running = executions.filter((item) => item.status === "已启动").map((item) => item.role);
    const pending = transaction.requiredRoles.filter((role) => !executions.some((item) => item.role === role && item.status !== "已过期"));
    if (pending.length > 0 && running.length < maxConcurrentReviewers) {
      const role = pending[0]!;
      return actionFor(
        `STX-REV-${batch.id}-${reviewerKey(role)}-DISPATCH`,
        `派发未启动 reviewer：评审事务 ${transaction.id}/${role}。`
      );
    }
    if (running.length > 0) {
      const role = running[0]!;
      return actionFor(
        `STX-REV-${batch.id}-${reviewerKey(role)}-COLLECT`,
        `评审事务 ${transaction.id} 等待 reviewer 完成：${running.join("、")}。`,
        "进行中"
      );
    }
    if (batch.status === "失效") {
      return actionFor("STX-10", `发起最终复审：为已演进批次 ${batch.id} 创建下一轮最终复审事务。`);
    }
    const evidence = batchHasAllCompletedReviewers(state, batch)
      ? readReviewPlanEvidence(state.planPath, batch.id, executions)
      : undefined;
    if (evidence?.overallConclusion === "需演进") {
      return actionFor("STX-09", `自动演进：按 ${batch.id} 的已关闭发现项修订草案并登记 revisionDigest。`);
    }
    if (evidence?.overallConclusion === "阻塞") {
      return { ...actionFor("STX-10", `处理阻塞：${batch.id} 的正式评审结论为阻塞。`, "阻塞"), gate: "阻塞" };
    }
    if (evidence?.overallConclusion !== "可提交确认") {
      return actionFor("STX-08", `提交缺失 reviewer 正式结果：${batch.id} 尚未形成可提交确认结论；禁止最终提交。`, "进行中");
    }
    if (batch.kind !== "最终复审") {
      return actionFor("STX-10", `发起最终复审：初审 ${batch.id} 已收齐，创建最终复审事务。`);
    }
    return actionFor("STX-10", `最终提交：执行 review-transaction-finalize 提交 ${transaction.id}。`, "进行中");
  }

  async reviewResumeAction(): Promise<string | null> {
    return this.reviewShortTransactionAction(await this.requireState())?.action ?? null;
  }

  /** Returns the sole durable action for the whole lifecycle. Active reviewer
   * recovery retains priority because its formal record is an existing hard
   * gate; otherwise the first dependency-satisfied short transaction wins. */
  async resumeAction(): Promise<ShortTransactionAction | null> {
    const state = await this.requireState();
    const reviewAction = this.reviewShortTransactionAction(state);
    if (reviewAction) return reviewAction;
    return findNextShortTransactionAction(state);
  }

  async executionEnvelope(): Promise<ExecutionEnvelope> {
    const state = await this.requireState();
    const action = this.reviewShortTransactionAction(state) ?? await this.resumeAction();
    const task = action ? state.tasks.find((item) => item.id === state.shortTransactions.find((item) => item.id === action.transactionId)?.taskId) : undefined;
    const activeReviewerIds = state.reviewExecutions.filter((item) => item.status === "已启动").map((item) => item.id);
    const activeTransaction = action ? state.shortTransactions.find((item) => item.id === action.transactionId) : undefined;
    const leaseActive = Boolean(activeTransaction?.leaseExpiresAt && Date.parse(activeTransaction.leaseExpiresAt) > Date.now());
    const hasPendingConfirmation = action?.gate === "确认" || state.confirmations.some((item) => item.status === "待确认");
    const hasBlocker = action?.gate === "阻塞" || state.blockers.some((item) => item.status === "未解除");
    const hasCancelledBranch = state.shortTransactions.some((item) => item.status === "已取消");
    const completed = !action && state.shortTransactions.length > 0
      && state.shortTransactions.every((item) => ["已完成", "跳过", "已取消"].includes(item.status));
    let runState: ExecutionEnvelope["state"];
    let reason: ExecutionEnvelope["reply"]["reason"];
    let internalWait: ExecutionEnvelope["internalWait"];
    if (hasPendingConfirmation) {
      runState = "waiting_confirmation";
      reason = "confirmation";
    } else if (hasBlocker) {
      runState = "blocked";
      reason = "blocker";
    } else if (completed && hasCancelledBranch) {
      runState = "cancelled";
      reason = "cancelled";
    } else if (completed || (!action && state.overallStatus === "已完成")) {
      runState = "completed";
      reason = "completed";
    } else if (activeReviewerIds.length > 0 && action?.kind !== "reviewer派发") {
      runState = "internal_wait";
      reason = "internal_wait";
      internalWait = { kind: "reviewer", refs: activeReviewerIds, pollAfterSeconds: 60 };
    } else if (leaseActive) {
      runState = "internal_wait";
      reason = "internal_wait";
      internalWait = { kind: "capacity", refs: [activeTransaction!.id], pollAfterSeconds: 60 };
    } else {
      runState = "active";
      reason = "runnable";
    }
    const replyAllowed = ["waiting_confirmation", "blocked", "completed", "cancelled"].includes(runState);
    const hostStatus = state.hostContinuation?.status === "unavailable"
      ? "unbound"
      : state.hostContinuation?.status ?? "unbound";
    return {
      schemaVersion: "execution-envelope-v1",
      requestId: state.requestId,
      phase: task?.phase,
      state: runState,
      currentTransactionId: action?.transactionId,
      nextAction: action,
      internalWait,
      reply: { allowed: replyAllowed, reason },
      resumeAt: activeTransaction?.leaseExpiresAt,
      hostContinuation: {
        required: !replyAllowed,
        status: hostStatus,
        automationId: state.hostContinuation?.automationId
      }
    };
  }

  async bindHostContinuation(automationId: string, sessionId: string): Promise<TestTaskState> {
    assertSafeText(automationId);
    assertSafeText(sessionId);
    if (!automationId.trim() || !sessionId.trim()) throw new Error("Host continuation requires an automation id and Codex session id.");
    const state = await this.requireState();
    if (state.hostContinuation
      && state.hostContinuation.status !== "deleted"
      && state.hostContinuation?.status !== "unavailable"
      && (state.hostContinuation?.automationId !== automationId || state.hostContinuation?.sessionId !== sessionId)) {
      throw new Error(`Request ${state.requestId} already has a different active heartbeat binding.`);
    }
    state.hostContinuation = { kind: "thread-heartbeat", automationId, sessionId, status: "active", updatedAt: now() };
    const blocker = state.blockers.find((item) => item.id === "BLK-HOST-CONTINUATION" && item.status === "未解除");
    if (blocker) {
      blocker.status = "已解除";
      blocker.resolvedAt = state.hostContinuation.updatedAt;
      blocker.resolutionEvidence = `已绑定 heartbeat ${automationId}。`;
      for (const transactionId of blocker.affectedRefs ?? []) {
        const transaction = state.shortTransactions.find((item) => item.id === transactionId && item.blockerId === blocker.id);
        if (transaction) {
          transaction.status = "待开始";
          transaction.blockerId = undefined;
        }
      }
      for (const taskId of blocker.affectedTaskIds) {
        const task = state.tasks.find((item) => item.id === taskId);
        if (task?.status === "阻塞") {
          task.status = "待开始";
          task.detail = "宿主续跑能力已恢复。";
          task.updatedAt = state.hostContinuation.updatedAt;
        }
      }
    }
    await this.record(state, { at: state.hostContinuation.updatedAt, type: "task_updated", summary: "已绑定线程 heartbeat 续跑器。" });
    return state;
  }

  async updateHostContinuation(status: "active" | "paused" | "deleted"): Promise<TestTaskState> {
    const state = await this.requireState();
    if (!state.hostContinuation) throw new Error("No host continuation is bound.");
    state.hostContinuation.status = status;
    state.hostContinuation.updatedAt = now();
    await this.record(state, { at: state.hostContinuation.updatedAt, type: "task_updated", summary: `线程 heartbeat 已更新为 ${status}。` });
    return state;
  }

  async blockForUnavailableHost(sessionId: string, reason: string): Promise<TestTaskState> {
    assertSafeText(sessionId);
    assertSafeText(reason);
    const state = await this.requireState();
    const action = this.reviewShortTransactionAction(state) ?? findNextShortTransactionAction(state);
    if (!action || action.gate) throw new Error("Host capability can only block a runnable short transaction.");
    const transaction = requireShortTransaction(state, action.transactionId);
    const blockerId = "BLK-HOST-CONTINUATION";
    const timestamp = now();
    const existingBlocker = state.blockers.find((item) => item.id === blockerId);
    if (existingBlocker?.status === "未解除") return state;
    const blocker: TaskBlocker = {
      id: blockerId,
      category: "工具",
      fact: `Codex 宿主续跑能力不可用：${reason}`,
      affectedTaskIds: [transaction.taskId],
      affectedRefs: [transaction.id],
      resolutionCondition: "信任项目 Stop Hook 并成功创建当前任务 heartbeat，或由组织管理员开放该能力。",
      owner: "用户/Codex 宿主",
      status: "未解除",
      createdAt: timestamp
    };
    if (existingBlocker) Object.assign(existingBlocker, blocker, { resolvedAt: undefined, resolutionEvidence: undefined });
    else state.blockers.push(blocker);
    transaction.status = "阻塞";
    transaction.blockerId = blockerId;
    clearTransactionClaim(transaction);
    const task = requireTask(state, transaction.taskId);
    task.status = "阻塞";
    task.detail = "宿主不能保证非终态自动续跑。";
    task.updatedAt = timestamp;
    state.hostContinuation = { kind: "thread-heartbeat", sessionId, status: "unavailable", updatedAt: timestamp };
    await this.record(state, {
      at: timestamp,
      type: "transaction_blocked",
      taskId: transaction.taskId,
      blockerId,
      transactionId: transaction.id,
      summary: `宿主续跑能力阻塞：${transaction.id}`
    });
    return state;
  }

  /** Claims the sole next action atomically through the local state write. A
   * repeated wakeup returns the same active transaction instead of creating a
   * second execution. */
  async claimNextShortTransaction(owner = "legacy-cli"): Promise<ShortTransactionAction | null> {
    assertSafeText(owner);
    if (!owner.trim()) throw new Error("A short-transaction claim requires an owner.");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = await this.requireState();
      const action = this.reviewShortTransactionAction(state) ?? findNextShortTransactionAction(state);
      if (!action || action.gate) return action;
      const transaction = state.shortTransactions.find((item) => item.id === action.transactionId);
      if (!transaction) return null;
      const leaseExpired = !transaction.leaseExpiresAt || Date.parse(transaction.leaseExpiresAt) <= Date.now();
      if (transaction.status === "待开始" || (transaction.status === "进行中" && leaseExpired)) {
        transaction.status = "进行中";
        transaction.claimedAt = now();
        transaction.claimOwner = owner;
        transaction.claimToken = randomUUID();
        transaction.leaseExpiresAt = new Date(Date.now() + shortTransactionLeaseMs).toISOString();
        state.activeShortTransactionId = transaction.id;
        try {
          await this.record(state, { at: transaction.claimedAt, type: "transaction_claimed", taskId: transaction.taskId, transactionId: transaction.id, summary: `已领取短事务 ${transaction.id}：${transaction.kind}` });
        } catch (error) {
          if (error instanceof TaskStateConflictError) continue;
          throw error;
        }
      }
      if (transaction.claimOwner !== owner) {
        return {
          ...action,
          status: transaction.status,
          claimToken: undefined,
          claimOwner: transaction.claimOwner,
          leaseExpiresAt: transaction.leaseExpiresAt
        };
      }
      return {
        ...action,
        status: transaction.status,
        claimToken: transaction.claimToken,
        claimOwner: transaction.claimOwner,
        leaseExpiresAt: transaction.leaseExpiresAt
      };
    }
    throw new TaskStateConflictError("Short transaction claim conflicted repeatedly; retry the same action.");
  }

  async renewShortTransactionLease(transactionId: string, claimToken: string): Promise<TestTaskState> {
    assertSafeText(claimToken);
    const state = await this.requireState();
    const transaction = requireShortTransaction(state, transactionId);
    assertTransactionClaim(transaction, claimToken);
    transaction.leaseExpiresAt = new Date(Date.now() + shortTransactionLeaseMs).toISOString();
    await this.record(state, { at: now(), type: "transaction_claimed", taskId: transaction.taskId, transactionId, summary: `已续租短事务 ${transactionId}。` });
    return state;
  }

  async commitShortTransaction(transactionId: string, input: CommitShortTransactionInput): Promise<TestTaskState> {
    this.assertSafe(input);
    const state = await this.requireState();
    const transaction = requireShortTransaction(state, transactionId);
    assertTransactionClaim(transaction, input.claimToken);
    if (transaction.requiresConfirmation) throw new Error(`${transactionId} requires its controlled confirmation entry and cannot be committed directly.`);
    if (transaction.status !== "进行中") throw new Error(`${transactionId} must be claimed before it can be committed.`);
    const paths = input.outputPaths ?? [];
    if (Boolean(input.noPersistentOutput) === (paths.length > 0)) throw new Error("A short transaction must register output paths or explicitly declare no persistent output.");
    if (!input.verificationResult.trim()) throw new Error("A short transaction requires a non-empty verification result.");
    const timestamp = now();
    transaction.status = "已完成";
    transaction.committedAt = timestamp;
    transaction.inputSnapshot = input.inputSnapshot ?? transaction.inputSnapshot;
    transaction.outputRefs = paths.map((path) => assertSafeOutputPath(path, this.workspaceRoot));
    transaction.verificationResult = input.verificationResult;
    clearTransactionClaim(transaction);
    if (state.activeShortTransactionId === transaction.id) state.activeShortTransactionId = undefined;
    this.completeTaskWhenAllTransactionsCommitted(state, transaction.taskId, transaction.outputRefs[0] ?? input.verificationResult, timestamp);
    await this.record(state, { at: timestamp, type: "transaction_committed", taskId: transaction.taskId, summary: `短事务已提交：${transaction.id}；校验：${input.verificationResult}` });
    return state;
  }

  /** Replaces the generic testcase-generation placeholder with one durable
   * transaction per planned package before any package is claimed. */
  async registerCasePackageTransactions(paths: string[]): Promise<TestTaskState> {
    const state = await this.requireState();
    const placeholder = requireShortTransaction(state, "STX-04");
    if (placeholder.status !== "待开始") throw new Error("Case package transactions must be registered before testcase generation starts.");
    const safePaths = [...new Set(paths.map((path) => assertSafeOutputPath(path, this.workspaceRoot)))];
    if (safePaths.length === 0 || safePaths.some((path) => !/^testcases\/.+\/cases-[^/]+\.md$/.test(path))) throw new Error("Register one or more repository-relative testcase package paths.");
    const packageIds = safePaths.map((path, index) => `STX-04-P${String(index + 1).padStart(2, "0")}`);
    state.shortTransactions = state.shortTransactions.filter((item) => item.id !== placeholder.id);
    state.shortTransactions.push(...safePaths.map((path, index) => ({
      ...placeholder,
      id: packageIds[index]!,
      sequence: placeholder.sequence + (index / 100),
      action: `生成并校验用例包：${path}。`,
      expectedOutputs: [path],
      dependencies: [...placeholder.dependencies],
      inputSnapshot: `packages:${safePaths.join(",")}`
    })));
    const relation = requireShortTransaction(state, "STX-05");
    relation.dependencies = packageIds;
    await this.record(state, { at: now(), type: "task_updated", taskId: "TASK-03", summary: `已登记 ${packageIds.length} 个独立用例包短事务。` });
    return state;
  }

  async retryShortTransaction(transactionId: string, reason: string, claimToken?: string): Promise<TestTaskState> {
    assertSafeText(reason);
    const state = await this.requireState();
    const transaction = requireShortTransaction(state, transactionId);
    if (transaction.status === "进行中") assertTransactionClaim(transaction, claimToken);
    if (!["进行中", "阻塞"].includes(transaction.status)) throw new Error(`${transactionId} cannot be retried from its current status.`);
    transaction.retryCount += 1;
    if (transaction.retryCount > transaction.maxRetries) {
      const timestamp = now();
      const blockerId = `BLK-${transaction.id}`;
      if (!state.blockers.some((item) => item.id === blockerId)) {
        state.blockers.push({
          id: blockerId,
          category: "工具",
          fact: `超过最大重试次数：${reason}`,
          affectedTaskIds: [transaction.taskId],
          affectedRefs: [transaction.id],
          resolutionCondition: "选择重试、等待外部恢复、提供资料或裁决、跳过受影响范围或取消。",
          owner: "Agent",
          status: "未解除",
          createdAt: timestamp
        });
      }
      transaction.status = "阻塞";
      transaction.blockerId = blockerId;
      clearTransactionClaim(transaction);
      if (state.activeShortTransactionId === transaction.id) state.activeShortTransactionId = undefined;
      const task = requireTask(state, transaction.taskId);
      task.status = "阻塞";
      task.updatedAt = timestamp;
      await this.record(state, {
        at: timestamp,
        type: "transaction_blocked",
        taskId: transaction.taskId,
        blockerId,
        summary: `短事务超过重试上限并进入阻塞：${transaction.id}（${transaction.retryCount}/${transaction.maxRetries}）`
      });
      return state;
    }
    transaction.status = "待开始";
    clearTransactionClaim(transaction);
    transaction.blockerId = undefined;
    if (state.activeShortTransactionId === transaction.id) state.activeShortTransactionId = undefined;
    await this.record(state, { at: now(), type: "transaction_retried", taskId: transaction.taskId, summary: `短事务重试 ${transaction.id}（${transaction.retryCount}/${transaction.maxRetries}）：${reason}` });
    return state;
  }

  async blockShortTransaction(transactionId: string, fact: string, claimToken?: string): Promise<TestTaskState> {
    assertSafeText(fact);
    const state = await this.requireState();
    const transaction = requireShortTransaction(state, transactionId);
    if (transaction.status === "进行中") assertTransactionClaim(transaction, claimToken);
    resetRetryScopeForNewBlocker(transaction, fact);
    const blockerId = `BLK-${transaction.id}`;
    const timestamp = now();
    const existingBlocker = state.blockers.find((item) => item.id === blockerId);
    const nextBlocker = { id: blockerId, category: "工具" as const, fact, affectedTaskIds: [transaction.taskId], affectedRefs: [transaction.id], resolutionCondition: "选择重试、等待外部恢复、提供资料或裁决、跳过受影响范围或取消。", owner: "Agent", status: "未解除" as const, createdAt: timestamp };
    if (existingBlocker) Object.assign(existingBlocker, nextBlocker, { resolvedAt: undefined, resolutionEvidence: undefined });
    else state.blockers.push(nextBlocker);
    transaction.status = "阻塞";
    clearTransactionClaim(transaction);
    transaction.blockerId = blockerId;
    if (state.activeShortTransactionId === transaction.id) state.activeShortTransactionId = undefined;
    const task = requireTask(state, transaction.taskId);
    task.status = "阻塞";
    task.updatedAt = timestamp;
    await this.record(state, { at: task.updatedAt, type: "transaction_blocked", taskId: transaction.taskId, blockerId, summary: `短事务阻塞：${transaction.id}；${fact}` });
    return state;
  }

  /** Resolves only the blocked transaction. Downstream work remains pending
   * until this transaction is retried or deliberately skipped. */
  async resolveShortTransactionBlocker(transactionId: string, option: BlockerResolutionOption, evidence: string): Promise<TestTaskState> {
    assertSafeText(evidence);
    const state = await this.requireState();
    const transaction = requireShortTransaction(state, transactionId);
    if (transaction.status !== "阻塞" || !transaction.blockerId) throw new Error(`${transactionId} has no active short-transaction blocker.`);
    const blocker = state.blockers.find((item) => item.id === transaction.blockerId);
    if (!blocker) throw new Error(`${transactionId} references a missing blocker.`);
    if (option === "等待外部恢复") {
      blocker.resolutionEvidence = `等待外部恢复：${evidence}`;
      await this.record(state, { at: now(), type: "transaction_blocked", taskId: transaction.taskId, blockerId: blocker.id, summary: `短事务继续等待外部恢复：${transaction.id}` });
      return state;
    }
    blocker.status = "已解除";
    blocker.resolvedAt = now();
    blocker.resolutionEvidence = `${option}：${evidence}`;
    if (option === "重试") {
      resetRetryScopeForNewBlocker(transaction, blocker.fact);
      transaction.status = "待开始";
      transaction.retryCount += 1;
      if (transaction.retryCount > transaction.maxRetries) throw new Error(`${transactionId} has exceeded its retry limit and remains blocked.`);
    } else if (option === "跳过受影响范围") {
      transaction.status = "跳过";
      transaction.committedAt = now();
      transaction.verificationResult = `${option}：${evidence}`;
      this.completeTaskWhenAllTransactionsCommitted(state, transaction.taskId, transaction.verificationResult, transaction.committedAt);
    } else if (option === "取消") {
      transaction.status = "已取消";
      transaction.committedAt = now();
      transaction.verificationResult = `${option}：${evidence}`;
      cancelDependentTransactions(state, transaction.id, transaction.verificationResult, transaction.committedAt);
    } else {
      transaction.status = "待开始";
    }
    clearTransactionClaim(transaction);
    transaction.blockerId = undefined;
    const task = requireTask(state, transaction.taskId);
    if (task.status === "阻塞") {
      task.status = transaction.status === "跳过" || transaction.status === "已取消" ? "跳过" : "待开始";
      task.detail = `短事务阻塞已处理：${option}。`;
      task.updatedAt = now();
    }
    await this.record(state, { at: now(), type: "blocker_resolved", taskId: transaction.taskId, blockerId: blocker.id, summary: `短事务阻塞已处理：${transaction.id}/${option}` });
    return state;
  }

  /** Registers a reviewer only after the orchestrator has returned a real
   * child-agent task identifier. Execution mode and isolation are fixed. */
  async startReviewAgent(input: StartReviewAgentInput): Promise<TestTaskState> {
    this.assertSafe(input);
    const state = await this.requireState();
    const batch = requireReviewBatch(state, input.batchId);
    const transaction = requireActiveReviewTransaction(state, input.batchId);
    if (!input.agentTaskId.trim()) {
      await this.blockReviewTask(state, { id: input.executionId, batchId: input.batchId, role: input.role }, `缺少 ${input.role} reviewer 的 Agent 任务标识。`);
      await this.record(state, { at: now(), type: "reviewer_failed", taskId: "TASK-04", reviewBatchId: batch.id, reviewerExecutionId: input.executionId, summary: `真实子智能体 reviewer 未启动：${input.role}` });
      throw new Error("A real reviewer requires a non-empty agentTaskId and has blocked TASK-04.");
    }
    validateInputPathSummary(input.inputPathSummary);
    if (batch.status !== "进行中") throw new Error(`Review batch ${batch.id} is not active.`);
    if (!batch.requiredRoles.includes(input.role)) throw new Error(`Reviewer role ${input.role} is not required by batch ${batch.id}.`);
    if (state.reviewExecutions.some((execution) => execution.id === input.executionId)) throw new Error(`Duplicate reviewer execution ID: ${input.executionId}`);
    if (state.reviewExecutions.some((execution) => execution.batchId === input.batchId && execution.role === input.role && execution.status !== "已过期")) throw new Error(`Reviewer role ${input.role} is already registered for batch ${input.batchId}.`);
    if (state.reviewExecutions.some((execution) => execution.agentTaskId === input.agentTaskId)) throw new Error(`Agent task ${input.agentTaskId} is already registered.`);
    const execution: ReviewAgentExecution = {
      id: input.executionId,
      batchId: input.batchId,
      role: input.role,
      executionMode: "真实子智能体",
      agentTaskId: input.agentTaskId,
      isolationMode: "fork_turns=none",
      inputPathSummary: [...input.inputPathSummary],
      inputBaselineDigest: reviewInputDigest(this.workspaceRoot, input.inputPathSummary),
      status: "已启动",
      startedAt: now(),
    };
    state.reviewExecutions.push(execution);
    transaction.status = "评审中";
    transaction.updatedAt = execution.startedAt;
    await this.record(state, { at: now(), type: "reviewer_started", taskId: "TASK-04", reviewBatchId: batch.id, reviewerExecutionId: execution.id, summary: `真实子智能体 reviewer 已启动：${execution.role}` });
    this.completeInternalTransaction(state, `STX-REV-${batch.id}-${reviewerKey(execution.role)}-DISPATCH`, `真实 reviewer ${execution.role} 已登记。`, execution.startedAt);
    await this.syncFormalReviewRecord(state, batch);
    return state;
  }

  async completeReviewAgent(executionId: string): Promise<TestTaskState> {
    const state = await this.requireState();
    const execution = requireReviewExecution(state, executionId);
    const batch = requireReviewBatch(state, execution.batchId);
    if (batch.status !== "进行中" || execution.status !== "已启动") throw new Error(`Reviewer execution ${executionId} cannot be completed from its current state.`);
    if (!execution.agentTaskId.trim() || execution.executionMode !== "真实子智能体" || execution.isolationMode !== "fork_turns=none") {
      await this.blockReviewTask(state, execution, "reviewer execution evidence is incomplete");
      throw new Error("Reviewer execution lacks required real-agent evidence and has blocked TASK-04.");
    }
    execution.status = "已完成";
    execution.endedAt = now();
    await this.record(state, { at: execution.endedAt, type: "reviewer_completed", taskId: "TASK-04", reviewBatchId: batch.id, reviewerExecutionId: execution.id, summary: `真实子智能体 reviewer 已完成：${execution.role}` });
    this.completeInternalTransaction(state, `STX-REV-${batch.id}-${reviewerKey(execution.role)}-COLLECT`, `真实 reviewer ${execution.role} 已收集。`, execution.endedAt);
    if (batchHasAllCompletedReviewers(state, batch)) this.completeInternalTransaction(state, "STX-08", `批次 ${batch.id} 的 reviewer 已收集。`, execution.endedAt);
    await this.syncFormalReviewRecord(state, batch);
    return state;
  }

  /** Atomically persists the formal reviewer result before marking its runtime
   * envelope complete. This is the only supported collection boundary. */
  async submitReviewAgent(executionId: string, submission: ReviewAgentSubmission): Promise<TestTaskState> {
    this.assertSafe(submission);
    return this.store.withExclusive(async () => {
      const state = await this.store.read();
      if (!state) throw new Error("本机任务状态不存在。");
      const execution = requireReviewExecution(state, executionId);
      const batch = requireReviewBatch(state, execution.batchId);
      const journalPath = join(this.store.root, "transactions", `review-submit-${executionId}.json`);
      const writeSubmitJournal = async (status: "准备" | "正式记录已写入" | "已提交" | "待恢复", recoveryAction?: string) => {
        await atomicWrite(journalPath, {
          id: `review-submit-${executionId}`,
          executionId,
          batchId: batch.id,
          status,
          inputBaselineDigest: execution.inputBaselineDigest,
          updatedAt: now(),
          recoveryAction
        });
      };
      if (execution.status === "已完成") throw new Error(`Reviewer ${executionId} 已提交；重复提交不会覆盖正式记录。`);
      if (execution.status !== "已启动" || batch.status !== "进行中") throw new Error(`Reviewer ${executionId} 当前不可提交。`);
      const currentDigest = reviewInputDigest(this.workspaceRoot, execution.inputPathSummary);
      if (currentDigest !== execution.inputBaselineDigest) {
        const transaction = requireActiveReviewTransaction(state, batch.id);
        transaction.status = "待恢复";
        transaction.recoveryAction = `reviewer ${execution.role} 的输入基线已变化；重新派发该角色，不得回写旧结论。`;
        await this.record(state, { at: now(), type: "review_record_sync_failed", taskId: "TASK-04", reviewBatchId: batch.id, reviewerExecutionId: execution.id, summary: `reviewer 输入基线过期：${execution.role}` }, true, true);
        throw new Error(`Reviewer ${execution.role} 的输入基线已变化；结果已过期，必须重新派发。`);
      }
      const completed = { ...execution, status: "已完成" as const, endedAt: now() };
      await writeSubmitJournal("准备", "重新执行同一 review-agent-submit；不得手工标记 reviewer 完成。");
      try {
        await submitReviewPlanRecord({ planPath: state.planPath, batch, execution: completed, submission, allExecutions: state.reviewExecutions });
        await writeSubmitJournal("正式记录已写入", "校验 canonical 记录后提交同一本机 reviewer 状态。");
        // Validate the persisted canonical block before any local completion fact.
        readReviewPlanEvidence(
          state.planPath,
          batch.id,
          [...state.reviewExecutions.filter((item) => item.batchId === batch.id && item.status === "已完成"), completed],
          { allowPendingFindings: true }
        );
        execution.status = "已完成";
        execution.endedAt = completed.endedAt;
        const transaction = requireActiveReviewTransaction(state, batch.id);
        transaction.planRecordDigest = reviewPlanRecordDigest(state.planPath, batch.id);
        transaction.lastSyncedAt = completed.endedAt;
        transaction.updatedAt = completed.endedAt;
        this.completeInternalTransaction(state, `STX-REV-${batch.id}-${reviewerKey(execution.role)}-COLLECT`, `reviewer ${execution.role} 的正式结论已原子提交。`, completed.endedAt);
        if (batchHasAllCompletedReviewers(state, batch)) this.completeInternalTransaction(state, "STX-08", `批次 ${batch.id} 的 reviewer 已原子收集。`, completed.endedAt);
        await this.record(state, { at: completed.endedAt, type: "reviewer_completed", taskId: "TASK-04", reviewBatchId: batch.id, reviewerExecutionId: execution.id, summary: `真实子智能体 reviewer 已原子提交：${execution.role}` }, true, true);
        await writeSubmitJournal("已提交");
        return state;
      } catch (error) {
        await writeSubmitJournal("待恢复", "运行 review-transaction-reconcile，并重试同一 review-agent-submit。");
        throw error;
      }
    });
  }

  /** Read-only recovery diagnostics. It never invents missing reviewer content. */
  async reconcileReviewTransaction(batchId: string): Promise<string[]> {
    const state = await this.requireState();
    const batch = requireReviewBatch(state, batchId);
    const executions = state.reviewExecutions.filter((item) => item.batchId === batch.id);
    const issues: string[] = [];
    for (const execution of executions) {
      if (execution.status === "已完成") {
        try { readReviewPlanEvidence(state.planPath, batch.id, [execution], { allowPendingFindings: true }); }
        catch (error) { issues.push(`${execution.role}：${error instanceof Error ? error.message : String(error)}`); }
      }
      if (execution.status === "已启动" && reviewInputDigest(this.workspaceRoot, execution.inputPathSummary) !== execution.inputBaselineDigest) {
        issues.push(`${execution.role}：输入基线已变化，必须重新派发。`);
      }
    }
    return issues;
  }

  async expireReviewAgent(executionId: string): Promise<TestTaskState> {
    const state = await this.requireState();
    const execution = requireReviewExecution(state, executionId);
    if (execution.status !== "已启动") throw new Error(`Reviewer ${executionId} 不能从 ${execution.status} 标记为过期。`);
    if (reviewInputDigest(this.workspaceRoot, execution.inputPathSummary) === execution.inputBaselineDigest) throw new Error(`Reviewer ${executionId} 的输入基线未变化，不能标记为过期。`);
    execution.status = "已过期";
    execution.endedAt = now();
    await this.record(state, { at: execution.endedAt, type: "reviewer_failed", taskId: "TASK-04", reviewBatchId: execution.batchId, reviewerExecutionId: execution.id, summary: `reviewer 输入基线已过期：${execution.role}` });
    return state;
  }

  /** Any child-agent failure or timeout blocks confirmation. It cannot be
   * converted into a main-agent self-review. */
  async failReviewAgent(executionId: string, status: Extract<ReviewAgentExecutionStatus, "失败" | "超时">, reason: string): Promise<TestTaskState> {
    assertSafeText(reason);
    const state = await this.requireState();
    const execution = requireReviewExecution(state, executionId);
    const batch = requireReviewBatch(state, execution.batchId);
    if (execution.status !== "已启动") throw new Error(`Reviewer execution ${executionId} cannot fail from its current state.`);
    execution.status = status;
    execution.failureReason = reason;
    execution.endedAt = now();
    await this.blockReviewTask(state, execution, `${execution.role} reviewer ${status}：${reason}`);
    await this.record(state, { at: execution.endedAt, type: "reviewer_failed", taskId: "TASK-04", reviewBatchId: execution.batchId, reviewerExecutionId: execution.id, summary: `真实子智能体 reviewer ${status}：${execution.role}` });
    await this.syncFormalReviewRecord(state, batch);
    return state;
  }

  /** Invalidates only a fully reviewed batch after a real draft revision. */
  async invalidateReviewBatchForEvolution(input: InvalidateReviewBatchForEvolutionInput): Promise<TestTaskState> {
    const state = await this.requireState();
    const batch = requireReviewBatch(state, input.batchId);
    if (batch.status === "失效") throw new Error(`Review batch ${input.batchId} is already invalidated.`);
    if (!batchHasAllCompletedReviewers(state, batch)) throw new Error(`Review batch ${input.batchId} must have all real reviewers completed before automatic evolution.`);
    const revision = revisionEvidence(input.revisionPaths, this.workspaceRoot);
    const evidence = readReviewPlanEvidence(state.planPath, input.batchId, state.reviewExecutions.filter((execution) => execution.batchId === input.batchId && execution.status === "已完成"));
    if (evidence.overallConclusion !== "需演进") {
      throw new Error(`Review batch ${input.batchId} can be invalidated for automatic evolution only when plan.md concludes “需演进”.`);
    }
    batch.status = "失效";
    batch.invalidatedAt = now();
    batch.planEvidenceRef = evidence.reference;
    batch.planEvidenceDigest = evidence.digest;
    batch.revisionEvidenceRefs = revision.refs;
    batch.revisionEvidenceDigest = revision.digest;
    const transaction = requireActiveReviewTransaction(state, batch.id);
    transaction.revisionDigest = revision.digest;
    transaction.status = "已提交";
    transaction.committedAt = batch.invalidatedAt;
    transaction.updatedAt = batch.invalidatedAt;
    transaction.recoveryAction = undefined;
    this.completeInternalTransaction(state, "STX-09", `批次 ${batch.id} 已自动演进。`, batch.invalidatedAt);
    const prior = state.reviewBatches.at(-2);
    const reviewTask = requireTask(state, "TASK-04");
    const reachedLimit = batch.automaticEvolutionRound >= maxAutomaticEvolutionRounds;
    const noProgress = prior?.revisionEvidenceDigest === revision.digest;
    if (reachedLimit || noProgress) {
      this.applyConvergenceBlock(
        state,
        batch,
        reachedLimit
          ? `已完成 ${maxAutomaticEvolutionRounds} 轮自动演进，仍需要修订。`
          : "连续两轮没有新的草案修订证据。"
      );
    } else if (reviewTask.status !== "阻塞") {
      reviewTask.status = "进行中";
      reviewTask.detail = `草案已自动演进，第 ${batch.automaticEvolutionRound + 1} 轮最终复审必须完成全部适用 reviewer。`;
      reviewTask.updatedAt = now();
    }
    await this.record(state, {
      at: now(),
      type: reachedLimit || noProgress ? "review_convergence_blocked" : "review_batch_invalidated",
      taskId: "TASK-04",
      reviewBatchId: batch.id,
      summary: reachedLimit || noProgress ? "自动评审未收敛，TASK-04 已阻塞。" : `草案演进使评审批次失效：${batch.id}`
    });
    await this.syncFormalReviewRecord(state, batch);
    return state;
  }

  /** Completes only a final re-review and closes TASK-04 in the same atomic
   * local state update. Findings are closed in the plan; this records its
   * evidence reference without duplicating reviewer reasoning locally. */
  async completeReviewBatch(batchId: string): Promise<TestTaskState> {
    throw new Error("Use completeReviewTransaction so output registration and TASK-04 closure are committed together.");
  }

  /** The terminal transaction commit records outputs and closes TASK-04 in one
   * local-state write after plan.md has supplied the formal review evidence. */
  async completeReviewTransaction(batchId: string, outputPaths: string[]): Promise<TestTaskState> {
    const state = await this.requireState();
    const transaction = requireActiveReviewTransaction(state, batchId);
    if (outputPaths.length === 0) throw new Error("Review transaction completion requires revised output paths.");
    const timestamp = now();
    const outputs = outputPaths.map((path) => {
      const safePath = assertSafeOutputPath(path, this.workspaceRoot);
      return { taskId: "TASK-04" as const, path: safePath, change: "更新" as const, previewKind: inferPreviewKind(safePath), updatedAt: timestamp };
    });
    const batch = requireReviewBatch(state, batchId);
    if (batch.kind !== "最终复审") throw new Error("Only a final re-review batch may complete TASK-04.");
    if (batch.status !== "进行中") throw new Error(`Review batch ${batchId} is not active.`);
    if (!batchHasAllCompletedReviewers(state, batch)) throw new Error(`Review batch ${batchId} is missing a completed real reviewer execution.`);
    if (state.blockers.some((blocker) => blocker.status === "未解除" && blocker.affectedTaskIds.includes("TASK-04"))) {
      throw new Error("TASK-04 has unresolved reviewer blockers and cannot complete.");
    }
    const latest = latestReviewBatch(state);
    if (!latest || latest.id !== batch.id) throw new Error("Only the latest review batch may complete TASK-04.");
    const executions = state.reviewExecutions.filter((execution) => execution.batchId === batch.id);
    const evidence = readReviewPlanEvidence(state.planPath, batch.id, executions);
    if (evidence.overallConclusion !== "可提交确认") {
      throw new Error(`Review batch ${batch.id} has conclusion “${evidence.overallConclusion}” and cannot close TASK-04.`);
    }
    batch.status = "已完成";
    batch.completedAt = timestamp;
    batch.planEvidenceRef = evidence.reference;
    batch.planEvidenceDigest = evidence.digest;
    const reviewTask = requireTask(state, "TASK-04");
    reviewTask.status = "已完成";
    reviewTask.evidence = evidence.reference;
    reviewTask.detail = `最终复审 ${batch.id} 已完成，全部适用真实子智能体 reviewer 已收齐。`;
    reviewTask.updatedAt = batch.completedAt;
    transaction.status = "已提交";
    transaction.committedAt = timestamp;
    transaction.updatedAt = timestamp;
    transaction.inputDigest = evidence.digest;
    transaction.planRecordDigest = evidence.digest;
    transaction.recoveryAction = undefined;
    this.completeInternalTransaction(state, "STX-10", `最终复审 ${batch.id} 已提交。`, timestamp);
    state.currentOutputs = outputs;
    await this.record(state, { at: batch.completedAt, type: "review_batch_completed", taskId: "TASK-04", reviewBatchId: batch.id, summary: `评审事务已提交：${batch.id}` }, false);
    return state;
  }

  async markReviewTransactionRecovery(batchId: string, action: string): Promise<TestTaskState> {
    assertSafeText(action);
    const state = await this.requireState();
    const transaction = requireActiveReviewTransaction(state, batchId);
    transaction.status = "待恢复";
    transaction.recoveryAction = action;
    transaction.updatedAt = now();
    const task = requireTask(state, "TASK-04");
    task.status = "进行中";
    task.detail = `评审事务 ${transaction.id} 待恢复：${action}`;
    task.updatedAt = transaction.updatedAt;
    await this.record(state, { at: transaction.updatedAt, type: "reviewer_failed", taskId: "TASK-04", reviewBatchId: batchId, summary: `评审事务待恢复：${transaction.id}` });
    return state;
  }

  async syncReviewTransactionRecord(batchId: string): Promise<TestTaskState> {
    const state = await this.requireState();
    const batch = requireReviewBatch(state, batchId);
    await this.syncFormalReviewRecord(state, batch);
    return state;
  }

  /** Closes legacy review transactions whose batches were already invalidated
   * with complete formal and revision evidence. It never changes plan.md or
   * invents reviewer conclusions. */
  async reconcileSupersededReviewTransactions(): Promise<TestTaskState> {
    const state = await this.requireState();
    const candidates = state.reviewTransactions.filter((transaction) => {
      const batch = state.reviewBatches.find((item) => item.id === transaction.batchId);
      return transaction.status !== "已提交" && batch?.status === "失效";
    });
    if (candidates.length === 0) return state;

    for (const transaction of candidates) {
      const batch = requireReviewBatch(state, transaction.batchId);
      if (!batch.revisionEvidenceDigest || !batch.revisionEvidenceRefs?.length) {
        throw new Error(`Superseded review transaction ${transaction.id} is missing revision evidence and cannot be reconciled.`);
      }
      const executions = state.reviewExecutions.filter((execution) =>
        execution.batchId === batch.id && execution.status === "已完成"
      );
      if (!batchHasAllCompletedReviewers(state, batch)) {
        throw new Error(`Superseded review transaction ${transaction.id} is missing completed real reviewer executions.`);
      }
      readReviewPlanEvidence(state.planPath, batch.id, executions, { allowPendingFindings: true });
    }

    const timestamp = now();
    for (const transaction of candidates) {
      transaction.status = "已提交";
      transaction.committedAt = timestamp;
      transaction.updatedAt = timestamp;
      transaction.recoveryAction = undefined;
    }
    await this.record(state, {
      at: timestamp,
      type: "review_transaction_reconciled",
      taskId: "TASK-04",
      summary: `已关闭 ${candidates.length} 个具备完整证据的失效评审事务。`
    });
    return state;
  }

  async addBlocker(input: Omit<TaskBlocker, "createdAt" | "status">): Promise<TestTaskState> {
    this.assertSafe(input);
    if (!input.resolutionCondition.trim() || input.affectedTaskIds.length === 0) throw new Error("A blocker requires affected tasks and a concrete resolution condition.");
    const state = await this.requireState();
    if (state.blockers.some((blocker) => blocker.id === input.id)) throw new Error(`Duplicate blocker ID: ${input.id}`);
    input.affectedTaskIds.forEach((id) => requireTask(state, id));
    const blocker: TaskBlocker = { ...input, affectedTaskIds: [...input.affectedTaskIds], affectedRefs: [...(input.affectedRefs ?? [])], createdAt: now(), status: "未解除" };
    state.blockers.push(blocker);
    for (const taskId of blocker.affectedTaskIds) {
      const task = requireTask(state, taskId);
      if (task.status !== "已完成" && task.status !== "跳过") {
        task.status = "阻塞";
        task.updatedAt = now();
      }
    }
    await this.record(state, { at: now(), type: "blocker_added", blockerId: blocker.id, summary: `新增阻塞：${blocker.fact}` });
    return state;
  }

  async resolveBlocker(id: string, evidence: string): Promise<TestTaskState> {
    assertSafeText(evidence);
    const state = await this.requireState();
    const blocker = state.blockers.find((item) => item.id === id);
    if (!blocker) throw new Error(`Blocker ${id} does not exist.`);
    blocker.status = "已解除";
    blocker.resolvedAt = now();
    blocker.resolutionEvidence = evidence;
    for (const taskId of blocker.affectedTaskIds) {
      const task = requireTask(state, taskId);
      if (task.status === "阻塞" && !state.blockers.some((item) => item.status === "未解除" && item.affectedTaskIds.includes(taskId))) {
        task.status = "待开始";
        task.detail = "阻塞已解除，等待继续。";
        task.updatedAt = now();
      }
    }
    await this.record(state, { at: now(), type: "blocker_resolved", blockerId: id, summary: `阻塞已解除：${blocker.fact}` });
    return state;
  }

  async requestConfirmation(input: Omit<TaskConfirmation, "createdAt" | "status">): Promise<TestTaskState> {
    this.assertSafe(input);
    const state = await this.requireState();
    if (!input.question.trim() || input.affectedTaskIds.length === 0 || (input.affectedTransactionIds?.length ?? 0) !== 1) throw new Error("A confirmation requires a minimal question, affected tasks, and exactly one affected short transaction.");
    if (state.confirmations.some((item) => item.id === input.id)) throw new Error(`Duplicate confirmation ID: ${input.id}`);
    input.affectedTaskIds.forEach((id) => requireTask(state, id));
    const transaction = requireShortTransaction(state, input.affectedTransactionIds![0]!);
    if (!transaction.requiresConfirmation) throw new Error(`Short transaction ${transaction.id} is not a confirmation gate.`);
    const confirmation: TaskConfirmation = { ...input, affectedTaskIds: [...input.affectedTaskIds], affectedTransactionIds: [...input.affectedTransactionIds!], createdAt: now(), status: "待确认" };
    state.confirmations.push(confirmation);
    transaction.status = "等待确认";
    transaction.confirmationId = confirmation.id;
    for (const taskId of confirmation.affectedTaskIds) {
      const task = requireTask(state, taskId);
      if (task.status !== "已完成" && task.status !== "跳过") task.status = "等待确认";
    }
    await this.record(state, { at: now(), type: "confirmation_requested", confirmationId: confirmation.id, summary: `等待用户确认：${confirmation.question}` });
    return state;
  }

  async recordUserDecision(id: string, decision: string): Promise<TestTaskState> {
    assertSafeText(decision);
    const state = await this.requireState();
    const confirmation = state.confirmations.find((item) => item.id === id);
    if (!confirmation) throw new Error(`Confirmation ${id} does not exist.`);
    if (confirmation.status !== "待确认") throw new Error(`Confirmation ${id} is not pending.`);
    confirmation.status = "已确认";
    confirmation.decision = decision;
    confirmation.decidedAt = now();
    const transactionId = confirmation.affectedTransactionIds?.[0];
    if (!transactionId) throw new Error(`Confirmation ${id} is not bound to a short transaction.`);
    const transaction = requireShortTransaction(state, transactionId);
    if (transaction.status !== "等待确认" || transaction.confirmationId !== id) throw new Error(`Confirmation ${id} cannot advance ${transactionId} from its current state.`);
    transaction.status = "已完成";
    transaction.committedAt = confirmation.decidedAt;
    transaction.verificationResult = `用户确认：${decision}`;
    transaction.confirmationId = undefined;
    if (transactionId === "STX-14") {
      const snapshot = state.executionAuthorization;
      if (!snapshot || snapshot.confirmationId !== id || snapshot.status !== "pending") {
        throw new Error("STX-14 requires the current immutable execution authorization snapshot.");
      }
      snapshot.status = "confirmed";
      snapshot.confirmedAt = confirmation.decidedAt;
    }
    this.completeTaskWhenAllTransactionsCommitted(state, transaction.taskId, transaction.verificationResult, confirmation.decidedAt);
    for (const taskId of confirmation.affectedTaskIds) {
      const task = requireTask(state, taskId);
      if (task.status === "等待确认" && !state.confirmations.some((item) => item.status === "待确认" && item.affectedTaskIds.includes(taskId))) {
        task.status = "待开始";
        task.detail = "用户确认已记录，等待继续。";
        task.updatedAt = now();
      }
    }
    await this.record(state, { at: now(), type: "confirmation_recorded", confirmationId: id, transactionId, summary: "已记录用户确认并提交绑定短事务。" });
    return state;
  }

  async requestTransactionConfirmation(transactionId: string, question: string, safeDefault: string): Promise<TestTaskState> {
    if (transactionId === "STX-14") {
      throw new Error("STX-14 must use createExecutionAuthorization so the confirmation is bound to an immutable execution manifest.");
    }
    const state = await this.requireState();
    const transaction = requireShortTransaction(state, transactionId);
    if (!transaction.requiresConfirmation) throw new Error(`${transactionId} is not a confirmation gate.`);
    const existing = state.confirmations.find((item) => item.affectedTransactionIds?.includes(transactionId) && item.status === "待确认");
    if (existing) return state;
    const sequence = state.confirmations.filter((item) => item.affectedTransactionIds?.includes(transactionId)).length + 1;
    const id = sequence === 1 ? `CNF-${transactionId}` : `CNF-${transactionId}-${sequence}`;
    return this.requestConfirmation({ id, question, affectedTaskIds: [transaction.taskId], affectedTransactionIds: [transactionId], safeDefault, continueAction: transaction.action });
  }

  async createExecutionAuthorization(input: CreateExecutionAuthorizationInput): Promise<TestTaskState> {
    this.assertSafe(input);
    const state = await this.requireState();
    if (!state.planPath) throw new Error("Execution authorization requires the canonical plan.md path.");
    if (!input.environment.trim() || /^prod(?:uction)?$/i.test(input.environment)) {
      throw new Error("The consolidated execution authorization cannot target production.");
    }
    if (input.caseIds.length === 0 || input.scriptPaths.length === 0 || input.allowedOperations.length === 0) {
      throw new Error("Execution authorization requires caseIds, scripts, and at least one allowed operation.");
    }
    if (input.dataWritePolicy === "tracked_residual" && input.environment !== "test") {
      throw new Error("tracked_residual is allowed only in the test environment.");
    }
    if (input.dataWritePolicy === "no_write"
      && input.allowedOperations.some((operation) => ["send_test_otp", "upload_synthetic_file", "submit_registration", "create_test_resource", "retain_tracked_residual"].includes(operation))) {
      throw new Error("A no_write authorization cannot include business mutation operations.");
    }
    const transaction = requireShortTransaction(state, "STX-14");
    if (requireShortTransaction(state, "STX-13").status !== "已完成") {
      throw new Error("The complete script review must be committed before creating execution authorization.");
    }
    if (!["待开始", "等待确认"].includes(transaction.status)) {
      throw new Error(`STX-14 cannot create an authorization from ${transaction.status}.`);
    }
    const planPath = resolve(this.workspaceRoot, state.planPath);
    const planDigest = createHash("sha256").update(readFileSync(planPath)).digest("hex");
    const scriptDigests = [...new Set(input.scriptPaths)].sort().map((path) => {
      const safePath = assertSafeOutputPath(path, this.workspaceRoot);
      return { path: safePath, digest: createHash("sha256").update(readFileSync(resolve(this.workspaceRoot, safePath))).digest("hex") };
    });
    const resourceBudgets = [...input.resourceBudgets]
      .map((budget) => ({ resourceType: budget.resourceType.trim(), maxCreates: budget.maxCreates }))
      .sort((left, right) => left.resourceType.localeCompare(right.resourceType));
    if (resourceBudgets.some((budget) => !budget.resourceType || !Number.isInteger(budget.maxCreates) || budget.maxCreates < 0)) {
      throw new Error("Execution resource budgets require non-negative integer limits.");
    }
    const timestamp = now();
    const snapshotBase = {
      schemaVersion: "execution-authorization-v1" as const,
      requestId: state.requestId,
      environment: input.environment,
      planDigest,
      scriptDigests,
      caseIds: [...new Set(input.caseIds)].sort(),
      allowedOperations: [...new Set(input.allowedOperations)].sort(),
      resourceBudgets,
      dataWritePolicy: input.dataWritePolicy,
      residualTtlHours: input.residualTtlHours ?? 72,
      securityChallengePolicy: "test-channel-first-minimal-human" as const,
      artifactPolicy: "retain-with-sensitive-step-redaction" as const
    };
    const digest = createHash("sha256").update(JSON.stringify(snapshotBase)).digest("hex");
    const confirmationId = `CNF-STX-14-${digest.slice(0, 12)}`;
    const snapshot: ExecutionAuthorizationSnapshot = {
      ...snapshotBase,
      digest,
      status: "pending",
      createdAt: timestamp,
      confirmationId
    };
    const priorPending = state.confirmations.find((item) => item.affectedTransactionIds?.includes("STX-14") && item.status === "待确认");
    if (priorPending) {
      if (state.executionAuthorization?.digest === digest && priorPending.id === confirmationId) return state;
      throw new Error("STX-14 already has a different pending confirmation; reopen the execution scope before replacing it.");
    }
    state.executionAuthorization = snapshot;
    const confirmation: TaskConfirmation = {
      id: confirmationId,
      question: `确认执行清单 ${digest.slice(0, 12)}：${snapshot.caseIds.length} 个 caseId、${snapshot.allowedOperations.length} 类操作、${snapshot.resourceBudgets.reduce((sum, item) => sum + item.maxCreates, 0)} 个最大创建资源？`,
      affectedTaskIds: [transaction.taskId],
      affectedTransactionIds: [transaction.id],
      safeDefault: "不确认则不执行任何业务写入。",
      continueAction: "完整执行清单内操作，不再逐项确认；仅安全挑战或清单漂移暂停。",
      status: "待确认",
      createdAt: timestamp
    };
    state.confirmations.push(confirmation);
    transaction.status = "等待确认";
    transaction.confirmationId = confirmation.id;
    transaction.inputSnapshot = `execution:${digest}`;
    const task = requireTask(state, transaction.taskId);
    task.status = "等待确认";
    task.detail = `不可变执行清单待确认：${digest.slice(0, 12)}。`;
    task.updatedAt = timestamp;
    await this.record(state, {
      at: timestamp,
      type: "execution_authorization_created",
      taskId: transaction.taskId,
      confirmationId,
      transactionId: transaction.id,
      summary: `已创建不可变执行清单：${digest.slice(0, 12)}。`
    });
    return state;
  }

  async reopenExecutionScope(reason: string): Promise<TestTaskState> {
    assertSafeText(reason);
    if (!reason.trim()) throw new Error("Execution scope reopen requires a reason.");
    const state = await this.requireState();
    const authorizationTransaction = requireShortTransaction(state, "STX-14");
    const confirmation = state.confirmations.find((item) =>
      item.id === state.executionAuthorization?.confirmationId
    ) ?? state.confirmations.find((item) =>
      item.affectedTransactionIds?.includes(authorizationTransaction.id) && item.status !== "已失效"
    );
    const pendingAuthorization = authorizationTransaction.status === "等待确认" && confirmation?.status === "待确认";
    const confirmedDownstream = state.executionAuthorization?.status === "confirmed"
      && authorizationTransaction.status === "已完成"
      && state.shortTransactions.some((item) =>
        item.sequence >= 15 && item.sequence <= 17 && ["进行中", "阻塞", "已完成"].includes(item.status)
      );
    if (!confirmation || (!pendingAuthorization && !confirmedDownstream)) {
      throw new Error("Execution scope can be reopened only from pending authorization or its downstream execution/report branch.");
    }
    const timestamp = now();
    if (confirmation.status === "待确认") {
      confirmation.status = "已失效";
      confirmation.decidedAt = timestamp;
      confirmation.decision = `执行范围已重开：${reason}`;
    }
    if (state.executionAuthorization) {
      state.executionAuthorization.status = "superseded";
      state.executionAuthorization.supersededAt = timestamp;
    }
    const reopenedTransactions = state.shortTransactions.filter((item) => item.sequence >= 12 && item.sequence <= 17);
    for (const transaction of reopenedTransactions) {
      if (transaction.blockerId) {
        const blocker = state.blockers.find((item) => item.id === transaction.blockerId && item.status === "未解除");
        if (blocker) {
          blocker.status = "已解除";
          blocker.resolvedAt = timestamp;
          blocker.resolutionEvidence = `执行范围受控重开：${reason}`;
        }
      }
      transaction.status = "待开始";
      transaction.inputSnapshot = `execution-scope-reopen:${timestamp}`;
      transaction.retryCount = 0;
      transaction.retryBlockerFact = undefined;
      transaction.blockerId = undefined;
      transaction.confirmationId = undefined;
      transaction.committedAt = undefined;
      transaction.outputRefs = undefined;
      transaction.verificationResult = undefined;
      clearTransactionClaim(transaction);
    }
    state.activeShortTransactionId = undefined;
    for (const taskId of ["TASK-06", "TASK-07"]) {
      const task = requireTask(state, taskId);
      task.status = "待开始";
      task.detail = `执行范围已重开：${reason}`;
      task.evidence = undefined;
      task.updatedAt = timestamp;
    }
    if (state.hostContinuation?.status === "paused") {
      state.hostContinuation.status = "active";
      state.hostContinuation.updatedAt = timestamp;
    }
    await this.record(state, {
      at: timestamp,
      type: "execution_scope_reopened",
      taskId: "TASK-06",
      confirmationId: confirmation.id,
      transactionId: "STX-12",
      summary: `旧执行授权已失效且确认历史已保留；工程设计分支已受控重开：${reason}`
    });
    return state;
  }

  /** Controlled plan transition: the formal plan and TASK-02 are updated as
   * one recoverable operation before testcase review may start. */
  async confirmPlan(): Promise<TestTaskState> {
    const state = await this.requireState();
    if (!state.planPath) throw new Error("确认计划需要已登记的 plan.md 路径。");
    const path = resolve(state.planPath);
    const plan = readFileSync(path, "utf8");
    const basicStart = plan.indexOf("## 基本信息");
    const basicEnd = basicStart < 0 ? -1 : plan.indexOf("\n## ", basicStart + 1);
    if (basicStart < 0) throw new Error("plan.md 缺少 ## 基本信息，无法执行受控计划确认。");
    const basic = plan.slice(basicStart, basicEnd < 0 ? undefined : basicEnd);
    if (!/\|\s*状态\s*\|\s*(草案|待确认|已确认)\s*\|/.test(basic)) {
      throw new Error("计划状态必须为 草案、待确认 或 已确认，才能执行受控确认。");
    }
    const confirmed = basic.replace(/\|\s*状态\s*\|\s*(草案|待确认|已确认)\s*\|/, "| 状态 | 已确认 |");
    if (confirmed !== basic) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(path, `${plan.slice(0, basicStart)}${confirmed}${basicEnd < 0 ? "" : plan.slice(basicEnd)}`, "utf8");
    }
    const task = requireTask(state, "TASK-02");
    if (!dependenciesCompleted(state, task)) throw new Error("TASK-02 依赖的计划形成尚未完成。");
    const timestamp = now();
    task.status = "已完成";
    task.evidence = `${path}#基本信息/状态=已确认`;
    task.detail = "已通过受控迁移确认计划；用例评审入口将校验正式计划状态。";
    task.updatedAt = timestamp;
    const confirmationTransaction = state.shortTransactions.find((item) => item.kind === "计划确认");
    if (confirmationTransaction) {
      confirmationTransaction.status = "已完成";
      confirmationTransaction.committedAt = timestamp;
      confirmationTransaction.outputRefs = [state.planPath];
      confirmationTransaction.verificationResult = "plan.md 的基本信息状态已确认。";
      if (state.activeShortTransactionId === confirmationTransaction.id) state.activeShortTransactionId = undefined;
    }
    await this.record(state, { at: timestamp, type: "plan_confirmed", taskId: "TASK-02", summary: "计划状态已受控迁移为已确认。" });
    return state;
  }

  async read(): Promise<TestTaskState | null> { return this.store.read(); }
  async renderCompactStatusCard(): Promise<string> { return renderCompactStatusCard(await this.requireState()); }
  async renderTaskOutputCard(): Promise<string> { return renderTaskOutputCard(await this.requireState(), this.workspaceRoot); }

  private async requireState(): Promise<TestTaskState> {
    const state = await this.store.read();
    if (!state) throw new Error("Local task state does not exist; call startOrResume first.");
    upgradeShortTransactionQueue(state);
    return state;
  }

  private async record(
    state: TestTaskState,
    event: TestTaskState["recentEvents"][number],
    clearCurrentOutputs = true,
    lockHeld = false
  ): Promise<void> {
    if (clearCurrentOutputs) state.currentOutputs = [];
    event.id ??= randomUUID();
    const expectedRevision = state.revision;
    state.updatedAt = event.at;
    state.overallStatus = determineOverallStatus(state.tasks, state.blockers, state.confirmations);
    const wakeEvent = this.enqueueWakeIfRunnable(state, event.at);
    const appendedEvents = wakeEvent ? [event, wakeEvent] : [event];
    state.recentEvents = [...state.recentEvents.slice(-(20 - appendedEvents.length)), ...appendedEvents];
    await this.store.commitSnapshot(state, expectedRevision, appendedEvents, lockHeld);
  }

  private enqueueWakeIfRunnable(state: TestTaskState, timestamp: string): TestTaskState["recentEvents"][number] | null {
    const candidate = state.activeShortTransactionId
      ? state.shortTransactions.find((item) => item.id === state.activeShortTransactionId)
      : state.shortTransactions.filter((item) => item.status === "待开始" && !item.requiresConfirmation)
        .sort((left, right) => left.sequence - right.sequence)
        .find((item) => item.dependencies.every((id) => ["已完成", "跳过"].includes(state.shortTransactions.find((dependency) => dependency.id === id)?.status ?? "")));
    if (!candidate || candidate.status === "阻塞" || candidate.status === "等待确认") return null;
    const existing = state.wakeRequests.find((item) => item.transactionId === candidate.id && item.status !== "失败");
    if (existing) return null;
    const wake = { id: `WAKE-${randomUUID()}`, transactionId: candidate.id, reason: "短事务已可继续", status: "待派发" as const, createdAt: timestamp, updatedAt: timestamp };
    state.wakeRequests.push(wake);
    return { id: randomUUID(), at: timestamp, type: "wake_requested", transactionId: candidate.id, summary: `已创建待唤醒请求：${candidate.id}` };
  }

  async listWakeRequests(): Promise<TestTaskState["wakeRequests"]> { return (await this.requireState()).wakeRequests.filter((item) => item.status === "待派发"); }

  async dispatchWakeRequest(id: string): Promise<TestTaskState> {
    const state = await this.requireState();
    const wake = state.wakeRequests.find((item) => item.id === id);
    if (!wake || wake.status !== "待派发") throw new Error(`Wake request ${id} is not pending.`);
    wake.status = "已派发";
    wake.updatedAt = now();
    await this.record(state, { at: wake.updatedAt, type: "wake_dispatched", transactionId: wake.transactionId, summary: `待唤醒请求已派发：${wake.transactionId}` });
    return state;
  }

  async failWakeRequest(id: string, reason: string): Promise<TestTaskState> {
    assertSafeText(reason);
    const state = await this.requireState();
    const wake = state.wakeRequests.find((item) => item.id === id);
    if (!wake || wake.status !== "待派发") throw new Error(`Wake request ${id} is not pending.`);
    wake.status = "失败";
    wake.failureReason = reason;
    wake.updatedAt = now();
    await this.record(state, { at: wake.updatedAt, type: "wake_failed", transactionId: wake.transactionId, summary: `待唤醒请求失败：${wake.transactionId}` });
    return state;
  }

  private completeTaskWhenAllTransactionsCommitted(state: TestTaskState, taskId: string, evidence: string, timestamp: string): void {
    const taskTransactions = state.shortTransactions.filter((item) => item.taskId === taskId);
    if (taskTransactions.length === 0 || !taskTransactions.every((item) => item.status === "已完成" || item.status === "跳过")) return;
    const task = requireTask(state, taskId);
    task.status = "已完成";
    task.evidence = evidence;
    task.detail = "关联短事务均已提交并完成校验。";
    task.updatedAt = timestamp;
  }

  private ensureReviewerShortTransactions(state: TestTaskState, batchId: string, roles: ReviewRole[], timestamp: string): void {
    for (const role of roles) {
      const key = reviewerKey(role);
      const dispatchId = `STX-REV-${batchId}-${key}-DISPATCH`;
      const collectId = `STX-REV-${batchId}-${key}-COLLECT`;
      if (!state.shortTransactions.some((item) => item.id === dispatchId)) {
        state.shortTransactions.push({ id: dispatchId, kind: "reviewer派发", taskId: "TASK-04", sequence: 7.1, status: "待开始", inputSnapshot: `review:${batchId}`, preconditions: ["评审事务已建立"], action: `派发 reviewer：${role}。`, expectedOutputs: ["plan.md"], verification: "核验 Agent 标识与隔离方式。", dependencies: ["STX-07"], retryCount: 0, maxRetries: 2 });
      }
      if (!state.shortTransactions.some((item) => item.id === collectId)) {
        state.shortTransactions.push({ id: collectId, kind: "reviewer收集", taskId: "TASK-04", sequence: 8.1, status: "待开始", inputSnapshot: `review:${batchId}`, preconditions: ["reviewer 已启动"], action: `收集 reviewer：${role}。`, expectedOutputs: ["plan.md"], verification: "核验正式记录与运行事实一致。", dependencies: [dispatchId], retryCount: 0, maxRetries: 2 });
      }
    }
    state.shortTransactions.sort((left, right) => left.sequence - right.sequence);
    void timestamp;
  }

  private completeInternalTransaction(state: TestTaskState, id: string, verificationResult: string, timestamp: string): void {
    const transaction = state.shortTransactions.find((item) => item.id === id);
    if (!transaction || transaction.status === "已完成") return;
    transaction.status = "已完成";
    transaction.committedAt = timestamp;
    transaction.verificationResult = verificationResult;
    transaction.outputRefs = [state.planPath ?? "plan.md"];
    clearTransactionClaim(transaction);
    if (state.activeShortTransactionId === id) state.activeShortTransactionId = undefined;
  }

  private async syncFormalReviewRecord(state: TestTaskState, batch: ReviewBatch): Promise<void> {
    const transaction = state.reviewTransactions.find((item) => item.batchId === batch.id);
    try {
      const result = await syncReviewPlanRecord(state.planPath, batch, state.reviewExecutions.filter((item) => item.batchId === batch.id));
      if (!result || !transaction) return;
      transaction.planRecordDigest = result.digest;
      transaction.lastSyncedAt = result.syncedAt;
      transaction.updatedAt = result.syncedAt;
      if (batch.status === "已完成" && batchHasAllCompletedReviewers(state, batch)) {
        const evidence = readReviewPlanEvidence(
          state.planPath,
          batch.id,
          state.reviewExecutions.filter((execution) => execution.batchId === batch.id && execution.status === "已完成")
        );
        batch.planEvidenceRef = evidence.reference;
        batch.planEvidenceDigest = evidence.digest;
      }
      if (transaction.status === "待恢复") {
        transaction.status = batch.status === "失效" ? "已提交" : "评审中";
        if (batch.status === "失效") transaction.committedAt = result.syncedAt;
        transaction.recoveryAction = undefined;
      }
      await this.record(state, { at: result.syncedAt, type: "review_record_synced", taskId: "TASK-04", reviewBatchId: batch.id, summary: `正式评审批次已同步并校验：${batch.id}` });
    } catch (error) {
      if (transaction) {
        transaction.status = "待恢复";
        transaction.recoveryAction = "修复未同步正式记录后执行 review-transaction-sync；不得关闭 TASK-04。";
        transaction.updatedAt = now();
      }
      const task = requireTask(state, "TASK-04");
      task.status = "进行中";
      task.detail = "正式评审批次同步失败，等待唯一恢复动作。";
      task.updatedAt = now();
      await this.record(state, { at: task.updatedAt, type: "review_record_sync_failed", taskId: "TASK-04", reviewBatchId: batch.id, summary: `正式评审批次同步失败：${batch.id}` });
      throw error;
    }
  }

  private assertSafe(value: unknown): void { assertSafeValue(value); }

  private async blockReviewTask(state: TestTaskState, execution: Pick<ReviewAgentExecution, "id" | "batchId" | "role">, fact: string): Promise<void> {
    const blockerId = `BLK-REVIEW-${execution.id}`;
    if (!state.blockers.some((blocker) => blocker.id === blockerId)) {
      state.blockers.push({
        id: blockerId,
        category: "工具",
        fact,
        affectedTaskIds: ["TASK-04"],
        affectedRefs: [execution.batchId, execution.role],
        resolutionCondition: `重新以 fork_turns=none 启动并完成 ${execution.role} reviewer，记录有效 Agent 任务标识。`,
        owner: "Agent",
        status: "未解除",
        createdAt: now()
      });
    }
    const task = requireTask(state, "TASK-04");
    task.status = "阻塞";
    task.detail = `缺少 ${execution.role} reviewer；影响用例确认；解除条件：重新完成该 reviewer。`;
    task.updatedAt = now();
  }

  private applyConvergenceBlock(state: TestTaskState, batch: ReviewBatch, fact: string): void {
    const blockerId = `BLK-REVIEW-CONVERGENCE-${batch.id}`;
    if (!state.blockers.some((blocker) => blocker.id === blockerId)) {
      state.blockers.push({
        id: blockerId,
        category: "工具",
        fact: `自动评审未收敛：${fact}`,
        affectedTaskIds: ["TASK-04"],
        affectedRefs: [batch.id],
        resolutionCondition: "人工复核剩余阻断项后，补充资料、裁决范围或建立新的测试请求。",
        owner: "Agent",
        status: "未解除",
        createdAt: now()
      });
    }
    const task = requireTask(state, "TASK-04");
    task.status = "阻塞";
    task.detail = `自动评审未收敛；影响用例确认；解除条件：人工复核 ${batch.id} 的正式评审记录。`;
    task.updatedAt = now();
  }
}

function resetRetryScopeForNewBlocker(transaction: ShortTransaction, fact: string): void {
  if (transaction.retryBlockerFact === fact) return;
  transaction.retryBlockerFact = fact;
  transaction.retryCount = 0;
}

function now(): string { return new Date().toISOString(); }

function requireTask(state: TestTaskState, id: string): TaskPlanItem {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) throw new Error(`Task ${id} does not exist.`);
  return task;
}

function requireShortTransaction(state: TestTaskState, id: string): ShortTransaction {
  const transaction = state.shortTransactions.find((item) => item.id === id);
  if (!transaction) throw new Error(`Short transaction ${id} does not exist.`);
  return transaction;
}

function findNextShortTransactionAction(state: TestTaskState): ShortTransactionAction | null {
  const active = state.activeShortTransactionId
    ? state.shortTransactions.find((item) => item.id === state.activeShortTransactionId)
    : state.shortTransactions.find((item) => item.status === "进行中");
  const candidate = active ?? state.shortTransactions
    .filter((item) => item.status === "待开始" || item.status === "等待确认" || item.status === "阻塞")
    .sort((left, right) => left.sequence - right.sequence)
    .find((item) => item.dependencies.every((id) =>
      ["已完成", "跳过"].includes(state.shortTransactions.find((dependency) => dependency.id === id)?.status ?? "")
    ));
  if (!candidate) return null;
  if (candidate.status === "阻塞") {
    return {
      transactionId: candidate.id,
      kind: candidate.kind,
      status: candidate.status,
      action: `阻塞：${candidate.blockerId ?? "未登记阻塞编号"}`,
      verification: candidate.verification,
      gate: "阻塞"
    };
  }
  if (
    candidate.requiresConfirmation
    && candidate.status !== "已完成"
    && (candidate.id !== "STX-14" || candidate.status === "等待确认")
  ) {
    return {
      transactionId: candidate.id,
      kind: candidate.kind,
      status: "等待确认",
      action: candidate.action,
      verification: candidate.verification,
      gate: "确认"
    };
  }
  return {
    transactionId: candidate.id,
    kind: candidate.kind,
    status: candidate.status,
    action: candidate.action,
    verification: candidate.verification,
    claimToken: candidate.claimToken,
    claimOwner: candidate.claimOwner,
    leaseExpiresAt: candidate.leaseExpiresAt
  };
}

function assertTransactionClaim(transaction: ShortTransaction, claimToken?: string): void {
  if (!transaction.claimToken) throw new Error(`${transaction.id} has no active claim.`);
  if (claimToken === transaction.claimToken) return;
  if (!claimToken && transaction.claimOwner === "legacy-cli") return;
  throw new Error(`${transaction.id} requires the active claim token.`);
}

function clearTransactionClaim(transaction: ShortTransaction): void {
  transaction.claimToken = undefined;
  transaction.claimOwner = undefined;
  transaction.leaseExpiresAt = undefined;
}

function cancelDependentTransactions(state: TestTaskState, sourceId: string, evidence: string, timestamp: string): void {
  const cancelled = new Set([sourceId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const transaction of state.shortTransactions) {
      if (cancelled.has(transaction.id) || !transaction.dependencies.some((id) => cancelled.has(id))) continue;
      if (!["已完成", "跳过"].includes(transaction.status)) {
        transaction.status = "已取消";
        transaction.committedAt = timestamp;
        transaction.verificationResult = `上游取消：${evidence}`;
        clearTransactionClaim(transaction);
      }
      cancelled.add(transaction.id);
      changed = true;
    }
  }
}

function dependenciesCompleted(state: TestTaskState, task: TaskPlanItem): boolean {
  return (task.dependencies ?? []).every((id) => ["已完成", "跳过"].includes(requireTask(state, id).status));
}

function validateTasks(tasks: TaskPlanItem[]): void {
  const seen = new Set<string>();
  for (const task of tasks) {
    if (!task.id || seen.has(task.id) || !taskPhases.includes(task.phase)) throw new Error("Task list has duplicate IDs or unsupported phases.");
    seen.add(task.id);
  }
  for (const task of tasks) (task.dependencies ?? []).forEach((id) => {
    if (!seen.has(id)) throw new Error(`Task ${task.id} references missing dependency ${id}.`);
  });
}

function determineOverallStatus(tasks: TaskPlanItem[], blockers: TaskBlocker[], confirmations: TaskConfirmation[]): TestTaskState["overallStatus"] {
  if (tasks.length > 0 && tasks.every((task) => task.status === "已完成" || task.status === "跳过")) return "已完成";
  if (tasks.every((task) => ["阻塞", "等待确认", "已完成", "跳过"].includes(task.status)) && blockers.some((item) => item.status === "未解除")) return "阻塞";
  if (confirmations.some((item) => item.status === "待确认")) return "等待确认";
  return "进行中";
}

function uniqueRoles(roles: ReviewRole[]): ReviewRole[] {
  for (const role of roles) {
    if (!reviewRoles.includes(role)) throw new Error(`Unsupported reviewer role: ${role}`);
  }
  return [...new Set(roles)];
}

function reviewerKey(role: ReviewRole): string {
  return ({ "需求一致性评审": "requirements", "测试设计评审": "design", "追溯审计": "trace", "交互与状态专项评审": "interaction", "变更影响评审": "impact" } as const)[role];
}

function assertRequiredReviewRoles(roles: ReviewRole[]): void {
  const missing = baseReviewRoles.filter((role) => !roles.includes(role));
  if (missing.length > 0) throw new Error(`Review batch is missing required roles: ${missing.join("、")}`);
}

function requireReviewBatch(state: TestTaskState, batchId: string): ReviewBatch {
  const batch = state.reviewBatches.find((item) => item.id === batchId);
  if (!batch) throw new Error(`Review batch ${batchId} does not exist.`);
  return batch;
}

function requireActiveReviewTransaction(state: TestTaskState, batchId: string) {
  const transaction = state.reviewTransactions.find((item) => item.batchId === batchId);
  if (!transaction) throw new Error(`Review batch ${batchId} has no durable review transaction.`);
  if (transaction.status === "已提交") throw new Error(`Review transaction ${transaction.id} is already committed.`);
  return transaction;
}

function requireReviewExecution(state: TestTaskState, executionId: string): ReviewAgentExecution {
  const execution = state.reviewExecutions.find((item) => item.id === executionId);
  if (!execution) throw new Error(`Reviewer execution ${executionId} does not exist.`);
  return execution;
}

function batchHasAllCompletedReviewers(state: TestTaskState, batch: ReviewBatch): boolean {
  return batch.requiredRoles.every((role) => {
    const execution = state.reviewExecutions.find((item) => item.batchId === batch.id && item.role === role);
    return execution?.status === "已完成"
      && execution.executionMode === "真实子智能体"
      && execution.isolationMode === "fork_turns=none"
      && Boolean(execution.agentTaskId.trim());
  });
}

function latestReviewBatch(state: TestTaskState): ReviewBatch | undefined {
  return state.reviewBatches.at(-1);
}

function revisionEvidence(paths: string[], workspaceRoot: string): { refs: string[]; digest: string } {
  if (paths.length === 0) throw new Error("Automatic evolution requires one or more revised draft files.");
  const refs = [...new Set(paths.map((path) => assertSafeOutputPath(path, workspaceRoot)))].sort();
  const hash = createHash("sha256");
  for (const path of refs) {
    hash.update(path, "utf8");
    hash.update(readFileSync(resolve(workspaceRoot, path)));
  }
  return { refs, digest: hash.digest("hex") };
}

function reviewTaskCanComplete(state: TestTaskState): boolean {
  const batch = latestReviewBatch(state);
  return Boolean(batch
    && batch.kind === "最终复审"
    && batch.status === "已完成"
    && batchHasAllCompletedReviewers(state, batch)
    && !state.blockers.some((blocker) => blocker.status === "未解除" && blocker.affectedTaskIds.includes("TASK-04")));
}

function isPlanConfirmed(planPath: string | undefined): boolean {
  if (!planPath) return false;
  const plan = readFileSync(resolve(planPath), "utf8");
  const start = plan.indexOf("## 基本信息");
  const end = start < 0 ? -1 : plan.indexOf("\n## ", start + 1);
  return start >= 0 && /\|\s*状态\s*\|\s*已确认\s*\|/.test(plan.slice(start, end < 0 ? undefined : end));
}

function validateInputPathSummary(paths: string[]): void {
  if (paths.length === 0) throw new Error("A reviewer execution requires a minimal input path summary.");
  for (const path of paths) {
    assertSafeText(path);
    if (!path.trim() || path.startsWith("/") || path.split("/").includes("..") || /(^|\/)\.(?:env|auth|local)(?:\/|$)/i.test(path)) {
      throw new Error("Reviewer input paths must be safe, relative project paths and cannot include local credentials or state.");
    }
  }
}

export function assertSafeText(value: string): void {
  if (sensitiveValue.test(value)) throw new Error("Local task state must not contain credentials or sensitive values.");
}

function assertSafeValue(value: unknown, key = ""): void {
  if (key !== "claimToken" && sensitiveKey.test(key)) throw new Error(`Local task state must not contain sensitive field ${key}.`);
  if (typeof value === "string") return assertSafeText(value);
  if (Array.isArray(value)) return value.forEach((item) => assertSafeValue(item));
  if (value && typeof value === "object") Object.entries(value).forEach(([name, item]) => assertSafeValue(item, name));
}
