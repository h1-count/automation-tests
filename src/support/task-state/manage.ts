import { TestTaskStateManager } from "./testTaskStateManager.js";
import {
  blockerResolutionOptions,
  executionOperationKinds,
  reviewRoles,
  type BlockerResolutionOption,
  type ExecutionOperationKind,
  type ReviewAgentSubmission,
  type ReviewBatchKind,
  type ReviewRole,
  type TaskItemStatus,
  type TaskOutputChange
} from "./types.js";
import { resolveRequiredReviewRoles } from "./reviewRoleResolver.js";
import { finalizeReviewTransaction } from "./reviewTransaction.js";
import { migrateActiveReviewPlanRecord } from "./reviewPlanRecord.js";

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function options(args: string[], name: string): string[] {
  return args.flatMap((value, index) => value === name && args[index + 1] ? [args[index + 1]] : []);
}

function required(args: string[], name: string): string {
  const value = option(args, name);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function parseStatus(value: string): TaskItemStatus {
  const statuses: TaskItemStatus[] = ["待开始", "进行中", "已完成", "等待确认", "阻塞", "跳过"];
  if (!statuses.includes(value as TaskItemStatus)) throw new Error(`Unsupported task status: ${value}`);
  return value as TaskItemStatus;
}

function parseOutputChange(value: string): TaskOutputChange {
  const changes: TaskOutputChange[] = ["新增", "更新", "引用"];
  if (!changes.includes(value as TaskOutputChange)) throw new Error(`Unsupported output change: ${value}`);
  return value as TaskOutputChange;
}

function parseBlockerResolution(value: string): BlockerResolutionOption {
  if (!blockerResolutionOptions.includes(value as BlockerResolutionOption)) throw new Error(`Unsupported blocker resolution: ${value}`);
  return value as BlockerResolutionOption;
}

function parseReviewKind(value: string): ReviewBatchKind {
  if (value !== "初审" && value !== "最终复审") throw new Error(`Unsupported review batch kind: ${value}`);
  return value;
}

function parseRole(value: string): ReviewRole {
  if (!reviewRoles.includes(value as ReviewRole)) throw new Error(`Unsupported reviewer role: ${value}`);
  return value as ReviewRole;
}

function parseRoles(value: string | undefined): ReviewRole[] | undefined {
  if (!value) return undefined;
  return value.split(",").map((role) => parseRole(role.trim()));
}

function parseReviewSubmission(value: string): ReviewAgentSubmission {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("--result 必须是有效 JSON。"); }
  if (!parsed || typeof parsed !== "object") throw new Error("--result 必须是 reviewer 结果对象。");
  const result = parsed as ReviewAgentSubmission;
  if (!['通过', '需演进', '阻塞'].includes(result.conclusion) || !Array.isArray(result.findings)) throw new Error("--result 缺少有效 conclusion 或 findings。");
  return result;
}

function parseExecutionOperation(value: string): ExecutionOperationKind {
  if (!executionOperationKinds.includes(value as ExecutionOperationKind)) {
    throw new Error(`Unsupported execution operation: ${value}`);
  }
  return value as ExecutionOperationKind;
}

function parseResourceBudget(value: string): { resourceType: string; maxCreates: number } {
  const [resourceType, rawMax, ...rest] = value.split(":");
  const maxCreates = Number(rawMax);
  if (!resourceType?.trim() || rest.length > 0 || !Number.isInteger(maxCreates) || maxCreates < 0) {
    throw new Error(`Invalid --resource-budget "${value}"; expected <resourceType>:<non-negative integer>.`);
  }
  return { resourceType: resourceType.trim(), maxCreates };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const requestId = required(args, "--request");
  const manager = new TestTaskStateManager(requestId);

  if (command === "init") {
    const state = await manager.startOrResume({ requestId, planPath: option(args, "--plan") });
    process.stdout.write(`已初始化任务状态：${state.requestId}\n`);
    return;
  }
  if (command === "resume") {
    const action = await manager.resumeAction();
    process.stdout.write(action ? `短事务 ${action.transactionId}（${action.kind}）：${action.action}${action.gate ? ` [${action.gate}门禁]` : ""}\n校验：${action.verification}\n` : "本测试请求没有待执行短事务。\n");
    return;
  }
  if (command === "transaction-claim") {
    const action = await manager.claimNextShortTransaction(option(args, "--owner") ?? "manual-cli");
    process.stdout.write(action ? `${JSON.stringify(action)}\n` : "没有可领取的短事务。\n");
    return;
  }
  if (command === "transaction-renew") {
    await manager.renewShortTransactionLease(required(args, "--transaction"), required(args, "--claim"));
    process.stdout.write("短事务租期已续期。\n");
    return;
  }
  if (command === "transaction-commit") {
    const state = await manager.commitShortTransaction(required(args, "--transaction"), {
      outputPaths: options(args, "--file"),
      noPersistentOutput: args.includes("--none"),
      verificationResult: required(args, "--verified"),
      inputSnapshot: option(args, "--input"),
      claimToken: option(args, "--claim")
    });
    process.stdout.write(`短事务已提交：${required(args, "--transaction")}；整体状态：${state.overallStatus}\n`);
    return;
  }
  if (command === "transaction-retry") {
    await manager.retryShortTransaction(required(args, "--transaction"), required(args, "--reason"), option(args, "--claim"));
    process.stdout.write("短事务已回到待领取状态。\n");
    return;
  }
  if (command === "transaction-block") {
    await manager.blockShortTransaction(required(args, "--transaction"), required(args, "--reason"), option(args, "--claim"));
    process.stdout.write("短事务已阻塞；可选解除方式：重试、等待外部恢复、提供资料或裁决、跳过受影响范围、取消。\n");
    return;
  }
  if (command === "transaction-resolve") {
    await manager.resolveShortTransactionBlocker(required(args, "--transaction"), parseBlockerResolution(required(args, "--option")), required(args, "--evidence"));
    process.stdout.write("短事务阻塞处理已提交；恢复入口将只返回该事务或其下游的唯一动作。\n");
    return;
  }
  if (command === "transaction-register-packages") {
    await manager.registerCasePackageTransactions(options(args, "--file"));
    process.stdout.write("已按实际用例包登记独立短事务。\n");
    return;
  }
  if (command === "transaction-confirm-request") {
    await manager.requestTransactionConfirmation(required(args, "--transaction"), required(args, "--question"), required(args, "--safe-default"));
    process.stdout.write("已创建绑定短事务的确认门禁。\n");
    return;
  }
  if (command === "transaction-confirm") {
    await manager.recordUserDecision(required(args, "--confirmation"), required(args, "--decision"));
    process.stdout.write("用户决定已提交；仅绑定短事务及其下游可继续。\n");
    return;
  }
  if (command === "execution-authorization-request") {
    const policy = required(args, "--policy");
    if (policy !== "no_write" && policy !== "managed_cleanup" && policy !== "tracked_residual") {
      throw new Error(`Unsupported data write policy: ${policy}`);
    }
    const ttlHours = Number(option(args, "--ttl-hours") ?? "72");
    if (!Number.isInteger(ttlHours) || ttlHours <= 0) throw new Error("--ttl-hours must be a positive integer.");
    const state = await manager.createExecutionAuthorization({
      environment: required(args, "--environment"),
      caseIds: options(args, "--case"),
      scriptPaths: options(args, "--script"),
      allowedOperations: options(args, "--operation").map(parseExecutionOperation),
      resourceBudgets: options(args, "--resource-budget").map(parseResourceBudget),
      dataWritePolicy: policy,
      residualTtlHours: ttlHours
    });
    process.stdout.write(`不可变执行清单已创建：${state.executionAuthorization?.digest.slice(0, 12)}；等待一次确认。\n`);
    return;
  }
  if (command === "execution-scope-reopen") {
    await manager.reopenExecutionScope(required(args, "--reason"));
    process.stdout.write("旧执行授权已失效；已保留确认历史、需求、用例、评审和旧阻塞解除记录，并从工程设计恢复唯一下一动作。\n");
    return;
  }
  if (command === "wake-list") {
    const requests = await manager.listWakeRequests();
    process.stdout.write(`${JSON.stringify(requests)}\n`);
    return;
  }
  if (command === "wake-dispatch") {
    await manager.dispatchWakeRequest(required(args, "--wake"));
    process.stdout.write("待唤醒请求已标记为已派发。\n");
    return;
  }
  if (command === "wake-fail") {
    await manager.failWakeRequest(required(args, "--wake"), required(args, "--reason"));
    process.stdout.write("待唤醒请求已记录失败；可由宿主稍后重新恢复。\n");
    return;
  }
  if (command === "host-bind") {
    await manager.bindHostContinuation(required(args, "--automation"), required(args, "--session"));
    process.stdout.write("线程 heartbeat 已绑定。\n");
    return;
  }
  if (command === "host-block") {
    await manager.blockForUnavailableHost(required(args, "--session"), required(args, "--reason"));
    process.stdout.write("宿主续跑能力不可用；当前唯一事务已进入明确阻塞。\n");
    return;
  }
  if (command === "host-update") {
    const status = required(args, "--status");
    if (status !== "active" && status !== "paused" && status !== "deleted") throw new Error(`Unsupported host status: ${status}`);
    await manager.updateHostContinuation(status);
    process.stdout.write(`线程 heartbeat 已更新为 ${status}。\n`);
    return;
  }
  if (command === "update") {
    const taskId = required(args, "--task");
    const status = parseStatus(required(args, "--status"));
    const state = await manager.updateTask(taskId, {
      status,
      detail: option(args, "--detail"),
      evidence: option(args, "--evidence")
    });
    process.stdout.write(`已更新 ${taskId}：${state.tasks.find((task) => task.id === taskId)?.status}\n`);
    return;
  }
  if (command === "plan-confirm") {
    await manager.confirmPlan();
    process.stdout.write("计划已受控确认；正式状态与 TASK-02 已同步。\n");
    return;
  }
  if (command === "output") {
    const state = await manager.recordTaskOutputs({
      taskId: required(args, "--task"),
      change: parseOutputChange(required(args, "--change")),
      paths: options(args, "--file"),
      noPersistentOutput: args.includes("--none")
    });
    process.stdout.write(`已登记本轮产出：${state.currentOutputs.length === 0 ? "无持久化文件变更" : `${state.currentOutputs.length} 个文件`}\n`);
    return;
  }
  if (command === "review-transaction-start") {
    const state = await manager.read();
    if (!state?.planPath) throw new Error("review-transaction-start requires the request to have a plan.md path.");
    const requiredRoles = resolveRequiredReviewRoles(state.planPath);
    await manager.startReviewTransaction({
      transactionId: required(args, "--transaction"),
      batchId: required(args, "--batch"),
      kind: parseReviewKind(required(args, "--kind")),
      requiredRoles,
      supersedesBatchId: option(args, "--supersedes")
    });
    process.stdout.write(`已准备评审事务：${required(args, "--transaction")}；适用角色：${requiredRoles.join("、")}\n`);
    return;
  }
  if (command === "review-transaction-sync") {
    const state = await manager.read();
    const batchId = required(args, "--batch");
    const batch = state?.reviewBatches.find((item) => item.id === batchId);
    if (!state || !batch) throw new Error(`不存在可同步的评审批次：${batchId}`);
    await manager.syncReviewTransactionRecord(batchId);
    process.stdout.write(`已同步正式评审批次：${batchId}\n`);
    return;
  }
  if (command === "review-transaction-migrate") {
    const state = await manager.read();
    const batchId = required(args, "--batch");
    const batch = state?.reviewBatches.find((item) => item.id === batchId);
    if (!state || !batch || batch.status !== "进行中") throw new Error(`只能迁移活跃评审批次：${batchId}`);
    await migrateActiveReviewPlanRecord(state.planPath, batch, state.reviewExecutions.filter((item) => item.batchId === batchId));
    process.stdout.write(`已迁移活跃正式评审批次：${batchId}\n`);
    return;
  }
  if (command === "review-agent-start") {
    const state = await manager.startReviewAgent({
      executionId: required(args, "--execution"),
      batchId: required(args, "--batch"),
      role: parseRole(required(args, "--role")),
      agentTaskId: required(args, "--agent-task"),
      inputPathSummary: required(args, "--inputs").split(",").map((path) => path.trim()).filter(Boolean)
    });
    process.stdout.write(`已登记真实 reviewer：${state.reviewExecutions.at(-1)?.role}\n`);
    return;
  }
  if (command === "review-agent-submit") {
    await manager.submitReviewAgent(required(args, "--execution"), parseReviewSubmission(required(args, "--result")));
    process.stdout.write("reviewer 结果、正式记录和本机完成状态已原子提交。\n");
    return;
  }
  if (command === "review-agent-expire") {
    await manager.expireReviewAgent(required(args, "--execution"));
    process.stdout.write("reviewer 已标记为输入基线过期；可重新派发同一角色。\n");
    return;
  }
  if (command === "review-transaction-reconcile") {
    const issues = await manager.reconcileReviewTransaction(required(args, "--batch"));
    process.stdout.write(issues.length === 0 ? "评审运行事实与正式记录一致。\n" : `${issues.join("\n")}\n`);
    return;
  }
  if (command === "review-transaction-reconcile-superseded") {
    const before = await manager.read();
    const pending = before?.reviewTransactions.filter((transaction) =>
      transaction.status !== "已提交"
      && before.reviewBatches.some((batch) => batch.id === transaction.batchId && batch.status === "失效")
    ).length ?? 0;
    await manager.reconcileSupersededReviewTransactions();
    process.stdout.write(pending === 0 ? "没有待关闭的失效评审事务。\n" : `已受控关闭 ${pending} 个失效评审事务。\n`);
    return;
  }
  if (command === "review-agent-fail") {
    const status = required(args, "--status");
    if (status !== "失败" && status !== "超时") throw new Error(`Unsupported reviewer failure status: ${status}`);
    await manager.failReviewAgent(required(args, "--execution"), status, required(args, "--reason"));
    process.stdout.write("reviewer 已标记为阻塞。\n");
    return;
  }
  if (command === "review-transaction-evolve") {
    const state = await manager.invalidateReviewBatchForEvolution({
      batchId: required(args, "--batch"),
      revisionPaths: options(args, "--file")
    });
    const reviewTask = state.tasks.find((task) => task.id === "TASK-04");
    process.stdout.write(reviewTask?.status === "阻塞" ? "自动评审未收敛，TASK-04 已阻塞。\n" : "已记录草案修订证据；必须发起下一轮最终复审。\n");
    return;
  }
  if (command === "review-transaction-finalize") {
    const batchId = required(args, "--batch");
    const revisionPaths = options(args, "--file");
    if (revisionPaths.length === 0) throw new Error("review-transaction-finalize requires one or more revised --file paths.");
    await finalizeReviewTransaction(manager, batchId, revisionPaths);
    process.stdout.write("评审事务已提交：内容、RULE → caseId、正式记录、产出和 TASK-04 已同步。\n");
    return;
  }
  if (command === "review-transaction-recover") {
    await manager.markReviewTransactionRecovery(required(args, "--batch"), required(args, "--action"));
    process.stdout.write("评审事务已标记为待恢复；TASK-04 保持进行中。\n");
    return;
  }
  throw new Error("Usage: manage.ts <init|resume|transaction-claim|transaction-renew|transaction-commit|transaction-retry|transaction-block|transaction-resolve|transaction-register-packages|transaction-confirm-request|transaction-confirm|execution-authorization-request|execution-scope-reopen|wake-list|wake-dispatch|wake-fail|host-bind|host-block|host-update|update|plan-confirm|output|review-transaction-start|review-transaction-sync|review-transaction-migrate|review-agent-start|review-agent-submit|review-agent-expire|review-agent-fail|review-transaction-reconcile|review-transaction-reconcile-superseded|review-transaction-evolve|review-transaction-finalize|review-transaction-recover> --request <type/project/request> ...; reviewer 收集必须使用 review-agent-submit。");
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
