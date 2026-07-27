import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { TestTaskStateManager } from "../../../src/support/task-state/testTaskStateManager.js";
import { migrateActiveReviewPlanRecord, submitReviewPlanRecord } from "../../../src/support/task-state/reviewPlanRecord.js";

const baseRoles = ["需求一致性评审", "测试设计评审", "追溯审计"] as const;
type TestReviewRole = typeof baseRoles[number] | "交互与状态专项评审" | "变更影响评审";

async function createHarness() {
  const root = await mkdtemp(resolve(tmpdir(), "task-state-"));
  const requestId = "web/open-platform/account-access";
  const planPath = resolve(root, "plan.md");
  await writeFile(planPath, "# 测试计划\n\n## 基本信息\n\n| 字段 | 内容 |\n| --- | --- |\n| 状态 | 已确认 |\n\n## 多角色评审记录\n\n<!-- multi-role-review-v1 -->\n", "utf8");
  return { root, requestId, planPath, manager: new TestTaskStateManager(requestId, resolve(root, "state"), root) };
}

async function reachReviewStage(manager: TestTaskStateManager, requestId: string, planPath: string) {
  await manager.startOrResume({ requestId, planPath });
  await manager.updateTask("TASK-01", { status: "已完成", evidence: planPath });
  await manager.updateTask("TASK-02", { status: "已完成", evidence: `${planPath}#计划确认` });
  await manager.updateTask("TASK-03", { status: "已完成", evidence: "cases-login.md" });
}

function roleKey(role: TestReviewRole) {
  return ({ "需求一致性评审": "requirements", "测试设计评审": "design", "追溯审计": "trace", "交互与状态专项评审": "interaction", "变更影响评审": "impact" } as const)[role];
}

async function startReview(manager: TestTaskStateManager, batchId: string, kind: "初审" | "最终复审", roles: readonly TestReviewRole[] = baseRoles, supersedesBatchId?: string) {
  return manager.startReviewTransaction({ transactionId: `TX-${batchId}`, batchId, kind, requiredRoles: [...roles], supersedesBatchId });
}

async function completeReviewers(manager: TestTaskStateManager, batchId: string, roles: readonly TestReviewRole[]) {
  for (const role of roles) {
    const key = roleKey(role);
    await manager.startReviewAgent({ executionId: `${batchId}-${key}`, batchId, role, agentTaskId: `agent-${batchId}-${key}`, inputPathSummary: ["plan.md", "cases-login.md"] });
    await manager.completeReviewAgent(`${batchId}-${key}`);
  }
}

async function writeFormalBatch(planPath: string, batchId: string, roles: readonly TestReviewRole[], options: { status?: string; agentTaskId?: string; findingStatus?: string; conclusion?: "可提交确认" | "需演进" | "阻塞"; round?: number } = {}) {
  const executionRows = roles.map((role) => `| ${role} | 真实子智能体 | ${options.agentTaskId ?? `agent-${batchId}-${roleKey(role)}`} | fork_turns=none | plan.md | ${options.status ?? "已完成"} | 通过 | 无 |`).join("\n");
  const findings = `| MRR-REQ-001 | 需求一致性评审 | PRD 1.1 | 需求覆盖缺口 | REQ-AUTH-001 | 中 | 自动演进 | 已修订 | ${options.findingStatus ?? "已关闭"} |`;
  await writeFile(planPath, `# 测试计划\n\n### 评审批次：${batchId}\n\n| 字段 | 内容 |\n| --- | --- |\n| 自动演进轮次 | ${options.round ?? 0} |\n| 综合结论 | ${options.conclusion ?? "可提交确认"} |\n\n#### reviewer 执行记录\n\n| 角色 | 执行方式 | Agent 任务标识 | 隔离方式 | 输入基线 | 执行状态 | 结论 | 发现项编号 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n${executionRows}\n\n| 发现项编号 | 角色 | 证据 | 发现项分类 | 受影响 REQ/caseId | 严重度 | 处置方式 | 修订/裁决证据 | 关闭状态 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n${findings}\n`, "utf8");
  const formal = await readFile(planPath, "utf8");
  await writeFile(planPath, `# 测试计划\n\n## 基本信息\n\n| 字段 | 内容 |\n| --- | --- |\n| 状态 | 已确认 |\n\n## 多角色评审记录\n\n${formal.replace(/^# 测试计划\n\n/, "")}`, "utf8");
}

test("creates local runtime state without reviewer conclusions or findings", async (context) => {
  const { root, requestId, planPath, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await reachReviewStage(manager, requestId, planPath);
  await startReview(manager, "REV-001", "最终复审");
  await completeReviewers(manager, "REV-001", baseRoles);
  const saved = await readFile(manager.store.statePath, "utf8");
  assert.equal(JSON.parse(saved).schemaVersion, "test-task-state-v10");
  assert.doesNotMatch(saved, /findingIds|conclusion/);
});

test("controlled plan confirmation immediately persists the formal status and TASK-02", async (context) => {
  const { root, requestId, planPath, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(planPath, "# 测试计划\n\n## 基本信息\n\n| 字段 | 内容 |\n| --- | --- |\n| 状态 | 草案 |\n\n## 多角色评审记录\n", "utf8");
  await manager.startOrResume({ requestId, planPath });
  await manager.updateTask("TASK-01", { status: "已完成", evidence: planPath });
  await manager.confirmPlan();
  assert.match(await readFile(planPath, "utf8"), /\| 状态 \| 已确认 \|/);
  assert.equal((await manager.read())?.tasks.find((task) => task.id === "TASK-02")?.status, "已完成");
});

test("review transaction maintains one canonical formal block while reviewer runtime facts change", async (context) => {
  const { root, requestId, planPath, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await reachReviewStage(manager, requestId, planPath);
  await startReview(manager, "REV-CANONICAL", "初审");
  assert.match(await readFile(planPath, "utf8"), /<!-- review-batch:REV-CANONICAL:start -->[\s\S]*评审中/);
  await manager.startReviewAgent({ executionId: "REV-CANONICAL-requirements", batchId: "REV-CANONICAL", role: "需求一致性评审", agentTaskId: "agent-canonical-requirements", inputPathSummary: ["plan.md"] });
  await manager.completeReviewAgent("REV-CANONICAL-requirements");
  const plan = await readFile(planPath, "utf8");
  assert.equal((plan.match(/review-batch:REV-CANONICAL:start/g) ?? []).length, 1);
  assert.match(plan, /agent-canonical-requirements[\s\S]*已完成/);
});

test("runtime fact sync preserves formal review round and human confirmation metadata", async (context) => {
  const { root, requestId, planPath, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await reachReviewStage(manager, requestId, planPath);
  await startReview(manager, "REV-PRESERVE-METADATA", "最终复审");
  const formal = (await readFile(planPath, "utf8"))
    .replace("| 自动演进轮次 | 0 |", "| 自动演进轮次 | 2 |")
    .replace("| 人工确认状态 | 未请求 |", "| 人工确认状态 | 待用户确认 |");
  await writeFile(planPath, formal, "utf8");

  await manager.startReviewAgent({
    executionId: "REV-PRESERVE-METADATA-requirements",
    batchId: "REV-PRESERVE-METADATA",
    role: "需求一致性评审",
    agentTaskId: "agent-preserve-metadata",
    inputPathSummary: ["plan.md"]
  });

  const synced = await readFile(planPath, "utf8");
  assert.match(synced, /\| 自动演进轮次 \| 2 \|/);
  assert.match(synced, /\| 人工确认状态 \| 待用户确认 \|/);
  assert.match(synced, /\| --- \| --- \| --- \| --- \| --- \| --- \| --- \| --- \| --- \|/);
});

test("atomic reviewer submission writes the formal result before completing local runtime state", async (context) => {
  const { root, requestId, planPath, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await reachReviewStage(manager, requestId, planPath);
  await startReview(manager, "REV-SUBMIT", "初审");
  await manager.startReviewAgent({ executionId: "REV-SUBMIT-requirements", batchId: "REV-SUBMIT", role: "需求一致性评审", agentTaskId: "agent-submit-requirements", inputPathSummary: ["plan.md"] });
  await manager.submitReviewAgent("REV-SUBMIT-requirements", { conclusion: "通过", findings: [] });
  const state = await manager.read();
  assert.equal(state?.reviewExecutions[0]?.status, "已完成");
  const plan = await readFile(planPath, "utf8");
  assert.match(plan, /agent-submit-requirements[\s\S]*\| 已完成 \| 通过 \| 无 \| 已关闭 \|/);
  assert.match(plan, /\| 综合结论 \| 评审中 \|/);
});

test("atomic reviewer submission accepts pending findings and leaves their closure to evolution", async (context) => {
  const { root, requestId, planPath, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await reachReviewStage(manager, requestId, planPath);
  await startReview(manager, "REV-SUBMIT-PENDING", "初审");
  await manager.startReviewAgent({ executionId: "REV-SUBMIT-PENDING-requirements", batchId: "REV-SUBMIT-PENDING", role: "需求一致性评审", agentTaskId: "agent-submit-pending", inputPathSummary: ["plan.md"] });
  await manager.submitReviewAgent("REV-SUBMIT-PENDING-requirements", {
    conclusion: "需演进",
    findings: [{
      id: "MRR-PENDING-001",
      evidence: "资料已明确且需要自动演进。",
      category: "资料明确的设计缺口",
      affectedRefs: ["REQ-001", "RULE-001", "CASE-001"],
      severity: "中",
      disposition: "自动演进",
      resolutionEvidence: "演进后回填正式记录。",
      status: "待处理",
      knowledgeDecision: { ownership: "需求事实", target: "REQ-001", evidenceStatus: "资料已确认", result: "已回链，不沉淀为项目经验" }
    }]
  });
  assert.equal((await manager.read())?.reviewExecutions[0]?.status, "已完成");
  assert.match(await readFile(planPath, "utf8"), /MRR-PENDING-001[\s\S]*待处理/);
});

test("replaying a formal reviewer write replaces its payload instead of duplicating findings", async (context) => {
  const { root, requestId, planPath, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await reachReviewStage(manager, requestId, planPath);
  await startReview(manager, "REV-REPLAY", "初审");
  await manager.startReviewAgent({ executionId: "REV-REPLAY-requirements", batchId: "REV-REPLAY", role: "需求一致性评审", agentTaskId: "agent-replay", inputPathSummary: ["plan.md"] });
  const state = await manager.read();
  const batch = state!.reviewBatches.find((item) => item.id === "REV-REPLAY")!;
  const execution = { ...state!.reviewExecutions[0]!, status: "已完成" as const };
  const submission = {
    conclusion: "需演进" as const,
    findings: [{
      id: "MRR-REPLAY-001",
      evidence: "可恢复写入测试。",
      category: "资料明确的设计缺口" as const,
      affectedRefs: "REQ-001",
      severity: "中",
      disposition: "自动演进" as const,
      resolutionEvidence: "自动修订。",
      status: "待处理" as const,
      knowledgeDecision: { ownership: "需求事实", target: "REQ-001", evidenceStatus: "资料已确认", result: "已回链，不沉淀为项目经验" }
    }]
  };
  await submitReviewPlanRecord({ planPath, batch, execution, submission, allExecutions: state!.reviewExecutions });
  await submitReviewPlanRecord({ planPath, batch, execution, submission, allExecutions: state!.reviewExecutions });
  assert.equal(((await readFile(planPath, "utf8")).match(/MRR-REPLAY-001/g) ?? []).length, 2);
});

test("baseline drift rejects reviewer submission without completing it and reconcile reports recovery", async (context) => {
  const { root, requestId, planPath, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await reachReviewStage(manager, requestId, planPath);
  await startReview(manager, "REV-DRIFT", "初审");
  await manager.startReviewAgent({ executionId: "REV-DRIFT-requirements", batchId: "REV-DRIFT", role: "需求一致性评审", agentTaskId: "agent-drift-requirements", inputPathSummary: ["plan.md"] });
  await writeFile(planPath, (await readFile(planPath, "utf8")).replace("| 状态 | 已确认 |", "| 状态 | 已变更 |"), "utf8");
  await assert.rejects(() => manager.submitReviewAgent("REV-DRIFT-requirements", { conclusion: "通过", findings: [] }), /输入基线已变化/);
  assert.equal((await manager.read())?.reviewExecutions[0]?.status, "已启动");
  assert.match((await manager.reconcileReviewTransaction("REV-DRIFT")).join("\n"), /输入基线已变化/);
});

test("active legacy review batch migrates to one canonical block without copying conclusions to local state", async (context) => {
  const { root, requestId, planPath, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await reachReviewStage(manager, requestId, planPath);
  await startReview(manager, "REV-MIGRATE", "初审");
  const state = await manager.read();
  const batch = state!.reviewBatches[0]!;
  await writeFile(planPath, "# 测试计划\n\n## 最终复审批次：REV-MIGRATE\n\n旧记录\n", "utf8");
  await migrateActiveReviewPlanRecord(planPath, batch, []);
  const plan = await readFile(planPath, "utf8");
  assert.equal((plan.match(/review-batch:REV-MIGRATE:start/g) ?? []).length, 1);
  assert.doesNotMatch(plan, /最终复审批次/);
});

test("TASK-04 closes only when plan.md matches completed reviewer runtime facts", async (context) => {
  const { root, requestId, planPath, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await reachReviewStage(manager, requestId, planPath);
  await startReview(manager, "REV-001", "最终复审");
  await completeReviewers(manager, "REV-001", baseRoles);
  await assert.rejects(() => manager.completeReviewTransaction("REV-001", ["plan.md"]), /评审中/);
  await writeFormalBatch(planPath, "REV-001", baseRoles);
  const state = await manager.completeReviewTransaction("REV-001", ["plan.md"]);
  assert.equal(state.tasks.find((task) => task.id === "TASK-04")?.status, "已完成");
  assert.match(state.reviewBatches[0]?.planEvidenceRef ?? "", /plan\.md#REV-001/);
  assert.match(state.reviewBatches[0]?.planEvidenceDigest ?? "", /^[a-f0-9]{64}$/);
  assert.equal(state.currentOutputs[0]?.path, "plan.md");
  assert.equal(state.reviewTransactions[0]?.status, "已提交");
});

test("standalone review lifecycle commands cannot bypass a durable transaction", async (context) => {
  const { root, requestId, planPath, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await reachReviewStage(manager, requestId, planPath);
  await assert.rejects(() => manager.startReviewBatch({ batchId: "REV-BYPASS", kind: "初审" }), /startReviewTransaction/);
  await assert.rejects(() => manager.completeReviewBatch("REV-BYPASS"), /completeReviewTransaction/);
});

test("resume action returns one durable reviewer dispatch at a time", async (context) => {
  const { root, requestId, planPath, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await reachReviewStage(manager, requestId, planPath);
  await startReview(manager, "REV-RESUME", "初审", [...baseRoles, "交互与状态专项评审"]);
  assert.match(await manager.reviewResumeAction() ?? "", /派发未启动 reviewer：.*需求一致性评审/);
  await manager.startReviewAgent({ executionId: "REV-RESUME-requirements", batchId: "REV-RESUME", role: "需求一致性评审", agentTaskId: "agent-resume-requirements", inputPathSummary: ["plan.md"] });
  assert.match(await manager.reviewResumeAction() ?? "", /派发未启动 reviewer：.*测试设计评审/);
  await manager.startReviewAgent({ executionId: "REV-RESUME-design", batchId: "REV-RESUME", role: "测试设计评审", agentTaskId: "agent-resume-design", inputPathSummary: ["plan.md"] });
  await manager.startReviewAgent({ executionId: "REV-RESUME-trace", batchId: "REV-RESUME", role: "追溯审计", agentTaskId: "agent-resume-trace", inputPathSummary: ["plan.md"] });
  assert.match(await manager.reviewResumeAction() ?? "", /等待 reviewer 完成：需求一致性评审、测试设计评审、追溯审计/);
  await assert.rejects(() => startReview(manager, "REV-OTHER", "初审"), /Active review transaction/);
});

test("a reviewer return frees capacity and dispatches the next waiting role", async (context) => {
  const { root, requestId, planPath, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await reachReviewStage(manager, requestId, planPath);
  await startReview(manager, "REV-CAPACITY", "初审", [...baseRoles, "交互与状态专项评审"]);
  for (const [role, key] of [["需求一致性评审", "requirements"], ["测试设计评审", "design"], ["追溯审计", "trace"]] as const) {
    await manager.startReviewAgent({ executionId: `REV-CAPACITY-${key}`, batchId: "REV-CAPACITY", role, agentTaskId: `agent-capacity-${key}`, inputPathSummary: ["plan.md"] });
  }
  assert.equal((await manager.executionEnvelope()).state, "internal_wait");
  await manager.submitReviewAgent("REV-CAPACITY-requirements", { conclusion: "通过", findings: [] });
  assert.match(await manager.reviewResumeAction() ?? "", /派发未启动 reviewer：.*交互与状态专项评审/);
  assert.equal((await manager.executionEnvelope()).state, "active");
});

test("a real reviewer failure becomes a terminal-reply blocker", async (context) => {
  const { root, requestId, planPath, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await reachReviewStage(manager, requestId, planPath);
  await startReview(manager, "REV-FAIL", "初审");
  await manager.startReviewAgent({ executionId: "REV-FAIL-requirements", batchId: "REV-FAIL", role: "需求一致性评审", agentTaskId: "agent-fail", inputPathSummary: ["plan.md"] });
  await manager.failReviewAgent("REV-FAIL-requirements", "失败", "reviewer process exited");
  const envelope = await manager.executionEnvelope();
  assert.equal(envelope.state, "blocked");
  assert.equal(envelope.reply.allowed, true);
});

test("a reviewer transaction remains recoverable instead of closing TASK-04 after a failed commit", async (context) => {
  const { root, requestId, planPath, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await reachReviewStage(manager, requestId, planPath);
  await startReview(manager, "REV-RECOVER", "最终复审");
  await manager.markReviewTransactionRecovery("REV-RECOVER", "formal record is incomplete");
  const state = await manager.read();
  assert.equal(state?.tasks.find((task) => task.id === "TASK-04")?.status, "进行中");
  assert.equal(state?.reviewTransactions[0]?.status, "待恢复");
  assert.match(state?.reviewTransactions[0]?.recoveryAction ?? "", /formal record/);
});

test("interaction and state reviewer is a first-class required role", async (context) => {
  const { root, requestId, planPath, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  const roles = [...baseRoles, "交互与状态专项评审"] as const;
  await reachReviewStage(manager, requestId, planPath);
  await startReview(manager, "REV-UX", "最终复审", roles);
  await completeReviewers(manager, "REV-UX", baseRoles);
  await writeFormalBatch(planPath, "REV-UX", roles);
  await assert.rejects(() => manager.completeReviewTransaction("REV-UX", ["plan.md"]), /missing a completed real reviewer/);
  await completeReviewers(manager, "REV-UX", ["交互与状态专项评审"]);
  assert.equal((await manager.completeReviewTransaction("REV-UX", ["plan.md"])).tasks.find((task) => task.id === "TASK-04")?.status, "已完成");
});

test("formal execution mismatch or unclosed findings blocks completion", async (context) => {
  const { root, requestId, planPath, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await reachReviewStage(manager, requestId, planPath);
  await startReview(manager, "REV-BLOCK", "最终复审");
  await completeReviewers(manager, "REV-BLOCK", baseRoles);
  await writeFormalBatch(planPath, "REV-BLOCK", baseRoles, { agentTaskId: "agent-other" });
  await assert.rejects(() => manager.completeReviewTransaction("REV-BLOCK", ["plan.md"]), /任务标识/);
  await writeFormalBatch(planPath, "REV-BLOCK", baseRoles, { findingStatus: "待处理" });
  await assert.rejects(() => manager.completeReviewTransaction("REV-BLOCK", ["plan.md"]), /未收束发现项/);
});

test("a final review with a 需演进 conclusion cannot close TASK-04", async (context) => {
  const { root, requestId, planPath, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await reachReviewStage(manager, requestId, planPath);
  await startReview(manager, "REV-EVOLVE", "最终复审");
  await completeReviewers(manager, "REV-EVOLVE", baseRoles);
  await writeFormalBatch(planPath, "REV-EVOLVE", baseRoles, { conclusion: "需演进" });
  await assert.rejects(() => manager.completeReviewTransaction("REV-EVOLVE", ["plan.md"]), /cannot close TASK-04/);
});

test("high-risk batch requires the change-impact reviewer in runtime and formal record", async (context) => {
  const { root, requestId, planPath, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  const roles = [...baseRoles, "变更影响评审"] as const;
  await reachReviewStage(manager, requestId, planPath);
  await startReview(manager, "REV-HIGH", "最终复审", roles);
  await completeReviewers(manager, "REV-HIGH", baseRoles);
  await writeFormalBatch(planPath, "REV-HIGH", roles);
  await assert.rejects(() => manager.completeReviewTransaction("REV-HIGH", ["plan.md"]), /missing a completed real reviewer/);
  await completeReviewers(manager, "REV-HIGH", ["变更影响评审"]);
  assert.equal((await manager.completeReviewTransaction("REV-HIGH", ["plan.md"])).tasks.find((task) => task.id === "TASK-04")?.status, "已完成");
});

test("evidence-backed evolution starts the next final review without a user confirmation", async (context) => {
  const { root, requestId, planPath, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(resolve(root, "cases-login.md"), "# 已修订草案\n", "utf8");
  await reachReviewStage(manager, requestId, planPath);
  await startReview(manager, "REV-OLD", "初审");
  await completeReviewers(manager, "REV-OLD", baseRoles);
  await writeFormalBatch(planPath, "REV-OLD", baseRoles, { conclusion: "需演进" });
  const invalidated = await manager.invalidateReviewBatchForEvolution({ batchId: "REV-OLD", revisionPaths: ["cases-login.md"] });
  assert.equal(invalidated.reviewBatches[0]?.status, "失效");
  assert.equal(invalidated.reviewTransactions[0]?.status, "已提交");
  assert.match(invalidated.reviewBatches[0]?.planEvidenceDigest ?? "", /^[a-f0-9]{64}$/);
  assert.match(invalidated.reviewBatches[0]?.revisionEvidenceDigest ?? "", /^[a-f0-9]{64}$/);
  const next = await startReview(manager, "REV-001", "最终复审", baseRoles, "REV-OLD");
  assert.equal(next.reviewBatches.at(-1)?.automaticEvolutionRound, 1);
  assert.equal(next.confirmations.length, 0);
  const stateText = await readFile(manager.store.statePath, "utf8");
  assert.doesNotMatch(stateText, /已修订|findingIds|conclusion/);
});

test("legacy superseded review transactions reconcile once and cannot become the next action", async (context) => {
  const { root, requestId, planPath, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(resolve(root, "cases-login.md"), "# 已修订草案\n", "utf8");
  await reachReviewStage(manager, requestId, planPath);
  await startReview(manager, "REV-OLD", "初审");
  await completeReviewers(manager, "REV-OLD", baseRoles);
  await writeFormalBatch(planPath, "REV-OLD", baseRoles, { conclusion: "需演进" });
  await manager.invalidateReviewBatchForEvolution({ batchId: "REV-OLD", revisionPaths: ["cases-login.md"] });

  const stored = JSON.parse(await readFile(manager.store.statePath, "utf8"));
  stored.reviewTransactions[0].status = "评审中";
  delete stored.reviewTransactions[0].committedAt;
  await writeFile(manager.store.statePath, JSON.stringify(stored), "utf8");

  const reconciled = await manager.reconcileSupersededReviewTransactions();
  assert.equal(reconciled.reviewTransactions[0]?.status, "已提交");
  assert.ok(reconciled.reviewTransactions[0]?.committedAt);
  assert.notEqual((await manager.resumeAction())?.transactionId, `STX-REV-REV-OLD-requirements-COLLECT`);
  assert.equal((await manager.reconcileSupersededReviewTransactions()).revision, reconciled.revision);
});

test("three automatic evolution rounds and two unchanged revisions block TASK-04", async (context) => {
  const { root, requestId, planPath, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  const revisionPath = resolve(root, "cases-login.md");
  await writeFile(revisionPath, "# revision 0\n", "utf8");
  await reachReviewStage(manager, requestId, planPath);
  await startReview(manager, "REV-0", "初审");
  await completeReviewers(manager, "REV-0", baseRoles);
  await writeFormalBatch(planPath, "REV-0", baseRoles, { conclusion: "需演进", round: 0 });
  await manager.invalidateReviewBatchForEvolution({ batchId: "REV-0", revisionPaths: ["cases-login.md"] });
  for (const round of [1, 2]) {
    await writeFile(revisionPath, `# revision ${round}\n`, "utf8");
    const batchId = `REV-${round}`;
    await startReview(manager, batchId, "最终复审", baseRoles, `REV-${round - 1}`);
    await completeReviewers(manager, batchId, baseRoles);
    await writeFormalBatch(planPath, batchId, baseRoles, { conclusion: "需演进", round });
    const state = await manager.invalidateReviewBatchForEvolution({ batchId, revisionPaths: ["cases-login.md"] });
    assert.equal(state.tasks.find((task) => task.id === "TASK-04")?.status, "进行中");
  }
  await writeFile(revisionPath, "# revision 3\n", "utf8");
  await startReview(manager, "REV-3", "最终复审", baseRoles, "REV-2");
  await completeReviewers(manager, "REV-3", baseRoles);
  await writeFormalBatch(planPath, "REV-3", baseRoles, { conclusion: "需演进", round: 3 });
  const blocked = await manager.invalidateReviewBatchForEvolution({ batchId: "REV-3", revisionPaths: ["cases-login.md"] });
  assert.equal(blocked.tasks.find((task) => task.id === "TASK-04")?.status, "阻塞");

  const { root: unchangedRoot, requestId: unchangedRequestId, planPath: unchangedPlanPath, manager: unchangedManager } = await createHarness();
  context.after(() => rm(unchangedRoot, { recursive: true, force: true }));
  await writeFile(resolve(unchangedRoot, "cases-login.md"), "# unchanged\n", "utf8");
  await reachReviewStage(unchangedManager, unchangedRequestId, unchangedPlanPath);
  await startReview(unchangedManager, "REV-A", "初审");
  await completeReviewers(unchangedManager, "REV-A", baseRoles);
  await writeFormalBatch(unchangedPlanPath, "REV-A", baseRoles, { conclusion: "需演进" });
  await unchangedManager.invalidateReviewBatchForEvolution({ batchId: "REV-A", revisionPaths: ["cases-login.md"] });
  await startReview(unchangedManager, "REV-B", "最终复审", baseRoles, "REV-A");
  await completeReviewers(unchangedManager, "REV-B", baseRoles);
  await writeFormalBatch(unchangedPlanPath, "REV-B", baseRoles, { conclusion: "需演进", round: 1 });
  const unchanged = await unchangedManager.invalidateReviewBatchForEvolution({ batchId: "REV-B", revisionPaths: ["cases-login.md"] });
  assert.equal(unchanged.tasks.find((task) => task.id === "TASK-04")?.status, "阻塞");
});

test("v2 through v4 states safely upgrade while discarding mirrored reviewer fields", async (context) => {
  const { root, requestId, planPath, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await manager.startOrResume({ requestId, planPath });
  const stored = JSON.parse(await readFile(manager.store.statePath, "utf8"));
  stored.schemaVersion = "test-task-state-v4";
  stored.reviewExecutions = [{ id: "old", batchId: "REV-OLD", role: "需求一致性评审", conclusion: "通过", findingIds: ["MRR-001"] }];
  await writeFile(manager.store.statePath, JSON.stringify(stored), "utf8");
  const resumed = new TestTaskStateManager(requestId, resolve(root, "state"), root);
  const state = await resumed.startOrResume({ requestId, planPath });
  assert.equal(state.schemaVersion, "test-task-state-v10");
  assert.deepEqual(state.currentOutputs, []);
  assert.equal("conclusion" in (state.reviewExecutions[0] ?? {}), false);
  assert.equal("findingIds" in (state.reviewExecutions[0] ?? {}), false);
});

test("records multiple safe outputs and renders an output card with preview actions", async (context) => {
  const { root, requestId, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(resolve(root, "outputs", "traces"), { recursive: true });
  await Promise.all([
    writeFile(resolve(root, "outputs", "cases-login.md"), "# 用例包\n", "utf8"),
    writeFile(resolve(root, "outputs", "screen.png"), "image", "utf8"),
    writeFile(resolve(root, "outputs", "run.mp4"), "video", "utf8"),
    writeFile(resolve(root, "outputs", "report.html"), "<html></html>", "utf8"),
    writeFile(resolve(root, "outputs", "traces", "trace.zip"), "trace", "utf8")
  ]);
  await manager.startOrResume({ requestId, planPath: "plan.md" });
  const state = await manager.recordTaskOutputs({
    taskId: "TASK-01",
    change: "更新",
    paths: ["outputs/cases-login.md", "outputs/screen.png", "outputs/run.mp4", "outputs/report.html", "outputs/traces/trace.zip"]
  });
  assert.deepEqual(state.currentOutputs.map((output) => output.previewKind), ["markdown", "image", "video", "html-report", "trace"]);
  const card = await manager.renderTaskOutputCard();
  assert.match(card, /### 本轮产出/);
  assert.match(card, /当前测试计划/);
  assert.match(card, /打开预览/);
  assert.match(card, /直接预览/);
  assert.match(card, /打开报告/);
  assert.match(card, /用 Playwright 打开/);
  assert.match(card, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("renders the plan entry and an explicit empty message when no file changed", async (context) => {
  const { root, requestId, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await manager.startOrResume({ requestId, planPath: "plan.md" });
  await manager.recordTaskOutputs({ taskId: "TASK-01", change: "引用", noPersistentOutput: true });
  const card = await manager.renderTaskOutputCard();
  assert.match(card, /当前测试计划/);
  assert.match(card, /本轮无持久化文件变更/);
});

test("rejects output paths outside the project or inside sensitive and non-output directories", async (context) => {
  const { root, requestId, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(resolve(root, ".local"), { recursive: true });
  await mkdir(resolve(root, "sources"), { recursive: true });
  await Promise.all([
    writeFile(resolve(root, ".env"), "SECRET=value", "utf8"),
    writeFile(resolve(root, ".local", "state.md"), "local", "utf8"),
    writeFile(resolve(root, "sources", "input.md"), "input", "utf8")
  ]);
  await manager.startOrResume({ requestId, planPath: "plan.md" });
  for (const path of [".env", ".local/state.md", "sources/input.md", "../outside.md"]) {
    await assert.rejects(() => manager.recordTaskOutputs({ taskId: "TASK-01", change: "新增", paths: [path] }), /Task output paths|repository-relative/);
  }
});

test("short transactions expose one idempotent next action and require a committed verification", async (context) => {
  const { root, requestId, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await manager.startOrResume({ requestId, planPath: "plan.md" });
  const first = await manager.claimNextShortTransaction();
  const repeated = await manager.claimNextShortTransaction();
  assert.equal(first?.transactionId, "STX-01");
  assert.equal(repeated?.transactionId, "STX-01");
  await assert.rejects(() => manager.commitShortTransaction("STX-01", { noPersistentOutput: true, verificationResult: "" }), /verification/);
  await manager.commitShortTransaction("STX-01", { outputPaths: ["plan.md"], verificationResult: "资料选择已追溯。" });
  assert.equal((await manager.resumeAction())?.transactionId, "STX-02");
});

test("plan confirmation is the only completion path for its confirmation transaction", async (context) => {
  const { root, requestId, planPath, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(planPath, "# 测试计划\n\n## 基本信息\n\n| 字段 | 内容 |\n| --- | --- |\n| 状态 | 草案 |\n", "utf8");
  await manager.startOrResume({ requestId, planPath });
  for (const id of ["STX-01", "STX-02"]) {
    await manager.claimNextShortTransaction();
    await manager.commitShortTransaction(id, { outputPaths: ["plan.md"], verificationResult: `${id} 校验通过。` });
  }
  const gate = await manager.resumeAction();
  assert.equal(gate?.transactionId, "STX-03");
  assert.equal(gate?.gate, "确认");
  assert.equal((await manager.executionEnvelope()).state, "waiting_confirmation");
  await manager.confirmPlan();
  assert.equal((await manager.read())?.shortTransactions.find((item) => item.id === "STX-03")?.status, "已完成");
});

test("short transaction retries are bounded and overflow becomes a formal blocker", async (context) => {
  const { root, requestId, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await manager.startOrResume({ requestId, planPath: "plan.md" });
  await manager.claimNextShortTransaction();
  await manager.retryShortTransaction("STX-01", "瞬时工具错误");
  await manager.claimNextShortTransaction();
  await manager.retryShortTransaction("STX-01", "再次失败");
  await manager.claimNextShortTransaction();
  await manager.retryShortTransaction("STX-01", "达到上限");
  const state = await manager.read();
  assert.equal(state?.shortTransactions.find((item) => item.id === "STX-01")?.status, "阻塞");
  assert.match((await manager.resumeAction())?.action ?? "", /阻塞/);
});

test("resolving a short-transaction blocker reopens only that transaction", async (context) => {
  const { root, requestId, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await manager.startOrResume({ requestId, planPath: "plan.md" });
  await manager.claimNextShortTransaction();
  await manager.blockShortTransaction("STX-01", "等待隔离环境恢复");
  await manager.resolveShortTransactionBlocker("STX-01", "提供资料或裁决", "已提供非生产环境说明");
  assert.equal((await manager.resumeAction())?.transactionId, "STX-01");
  assert.equal((await manager.read())?.shortTransactions.find((item) => item.id === "STX-02")?.status, "待开始");
});

test("a new blocker fact receives its own bounded retry budget", async (context) => {
  const { root, requestId, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await manager.startOrResume({ requestId, planPath: "plan.md" });
  const firstClaim = await manager.claimNextShortTransaction("runner-a");
  await manager.blockShortTransaction("STX-01", "测试环境入口超时", firstClaim?.claimToken);
  await manager.resolveShortTransactionBlocker("STX-01", "重试", "入口恢复后重试");
  assert.equal((await manager.read())?.shortTransactions.find((item) => item.id === "STX-01")?.retryCount, 1);

  const secondClaim = await manager.claimNextShortTransaction("runner-a");
  await manager.blockShortTransaction("STX-01", "测试环境证书错误", secondClaim?.claimToken);
  await manager.resolveShortTransactionBlocker("STX-01", "重试", "证书恢复后重试");
  const transaction = (await manager.read())?.shortTransactions.find((item) => item.id === "STX-01");
  assert.equal(transaction?.status, "待开始");
  assert.equal(transaction?.retryCount, 1);
});

test("case package registration fans out generation and makes relation sync depend on every package", async (context) => {
  const { root, requestId, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(resolve(root, "testcases", "web", "cases"), { recursive: true });
  await Promise.all([
    writeFile(resolve(root, "testcases", "web", "cases", "cases-a.md"), "# A\n", "utf8"),
    writeFile(resolve(root, "testcases", "web", "cases", "cases-b.md"), "# B\n", "utf8")
  ]);
  await manager.startOrResume({ requestId, planPath: "plan.md" });
  await manager.registerCasePackageTransactions(["testcases/web/cases/cases-a.md", "testcases/web/cases/cases-b.md"]);
  const state = await manager.read();
  assert.equal(state?.shortTransactions.some((item) => item.id === "STX-04"), false);
  assert.deepEqual(state?.shortTransactions.find((item) => item.id === "STX-05")?.dependencies, ["STX-04-P01", "STX-04-P02"]);
});

test("a confirmation completes only its bound transaction and releases engineering after testcase confirmation", async (context) => {
  const { root, requestId, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await manager.startOrResume({ requestId, planPath: "plan.md" });
  const state = (await manager.read())!;
  for (const transaction of state.shortTransactions.filter((item) => item.sequence < 11)) {
    transaction.status = "已完成";
    transaction.committedAt = new Date().toISOString();
    transaction.verificationResult = "测试前置已提交。";
  }
  await manager.store.write(state);
  await manager.requestTransactionConfirmation("STX-11", "确认用例集？", "保持不进入工程设计");
  await manager.recordUserDecision("CNF-STX-11", "确认用例集");
  assert.equal((await manager.read())?.shortTransactions.find((item) => item.id === "STX-11")?.status, "已完成");
  assert.equal((await manager.resumeAction())?.transactionId, "STX-12");
});

test("engineering design validation is automatic and script review becomes runnable without another user confirmation", async (context) => {
  const { root, requestId, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await manager.startOrResume({ requestId, planPath: "plan.md" });
  const state = (await manager.read())!;
  for (const transaction of state.shortTransactions.filter((item) => item.sequence <= 12)) {
    transaction.status = "已完成";
    transaction.committedAt = new Date().toISOString();
    transaction.verificationResult = "测试前置已提交。";
  }
  await manager.store.write(state);
  const action = await manager.resumeAction();
  assert.equal(action?.transactionId, "STX-12A");
  assert.equal(action?.gate, undefined);
  const claimed = await manager.claimNextShortTransaction("engineering-validator");
  await manager.commitShortTransaction("STX-12A", {
    noPersistentOutput: true,
    verificationResult: "工程设计与执行操作和数据预算映射完整。",
    claimToken: claimed?.claimToken
  });
  assert.equal((await manager.resumeAction())?.transactionId, "STX-13");
});

test("one immutable execution manifest confirms every listed normal operation", async (context) => {
  const { root, requestId, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(resolve(root, "tests", "web"), { recursive: true });
  await writeFile(resolve(root, "tests", "web", "registration.formal.spec.ts"), "export {};\n", "utf8");
  await manager.startOrResume({ requestId, planPath: "plan.md" });
  const state = (await manager.read())!;
  for (const transaction of state.shortTransactions.filter((item) => item.sequence < 14)) {
    transaction.status = "已完成";
    transaction.committedAt = new Date().toISOString();
    transaction.verificationResult = "测试前置已提交。";
  }
  await manager.store.write(state);
  const pending = await manager.createExecutionAuthorization({
    environment: "test",
    caseIds: ["OPEN-REG-001", "OPEN-REG-002"],
    scriptPaths: ["tests/web/registration.formal.spec.ts"],
    allowedOperations: [
      "send_test_otp",
      "upload_synthetic_file",
      "accept_agreement",
      "submit_registration",
      "create_test_resource",
      "retain_tracked_residual"
    ],
    resourceBudgets: [{ resourceType: "tenant", maxCreates: 2 }],
    dataWritePolicy: "tracked_residual",
    residualTtlHours: 72
  });
  const snapshot = pending.executionAuthorization!;
  assert.match(snapshot.digest, /^[a-f0-9]{64}$/);
  assert.equal((await manager.executionEnvelope()).state, "waiting_confirmation");
  await manager.recordUserDecision(snapshot.confirmationId, "确认完整执行清单");
  const confirmed = await manager.read();
  assert.equal(confirmed?.executionAuthorization?.status, "confirmed");
  assert.equal(confirmed?.shortTransactions.find((item) => item.id === "STX-14")?.status, "已完成");
  assert.equal((await manager.resumeAction())?.transactionId, "STX-15");
});

test("execution scope reopen supersedes the old confirmation and preserves completed testcase review", async (context) => {
  const { root, requestId, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await manager.startOrResume({ requestId, planPath: "plan.md" });
  const state = (await manager.read())!;
  for (const transaction of state.shortTransactions.filter((item) => item.sequence < 14)) {
    transaction.status = "已完成";
    transaction.committedAt = new Date().toISOString();
    transaction.verificationResult = "测试前置已提交。";
  }
  state.shortTransactions.find((item) => item.id === "STX-14")!.status = "等待确认";
  state.shortTransactions.find((item) => item.id === "STX-14")!.confirmationId = "CNF-STX-14-legacy";
  state.confirmations.push({
    id: "CNF-STX-14-legacy",
    question: "确认旧无写入执行？",
    affectedTaskIds: ["TASK-07"],
    affectedTransactionIds: ["STX-14"],
    safeDefault: "不执行",
    continueAction: "执行旧脚本",
    status: "待确认",
    createdAt: new Date().toISOString()
  });
  await manager.store.write(state);
  const reopened = await manager.reopenExecutionScope("改为完整注册执行");
  assert.equal(reopened.confirmations.at(-1)?.status, "已失效");
  assert.equal(reopened.shortTransactions.find((item) => item.id === "STX-11")?.status, "已完成");
  assert.equal(reopened.shortTransactions.find((item) => item.id === "STX-12")?.status, "待开始");
  assert.equal(reopened.shortTransactions.find((item) => item.id === "STX-12A")?.requiresConfirmation, undefined);
  assert.equal((await manager.resumeAction())?.transactionId, "STX-12");
});

test("execution scope reopen from blocked execution preserves confirmed history and resolves the old blocker", async (context) => {
  const { root, requestId, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(resolve(root, "tests", "web"), { recursive: true });
  await writeFile(resolve(root, "tests", "web", "registration.formal.spec.ts"), "export {};\n", "utf8");
  await manager.startOrResume({ requestId, planPath: "plan.md" });
  const state = (await manager.read())!;
  for (const transaction of state.shortTransactions.filter((item) => item.sequence < 14)) {
    transaction.status = "已完成";
    transaction.committedAt = new Date().toISOString();
    transaction.verificationResult = "测试前置已提交。";
  }
  await manager.store.write(state);
  const pending = await manager.createExecutionAuthorization({
    environment: "test",
    caseIds: ["OPEN-REG-001"],
    scriptPaths: ["tests/web/registration.formal.spec.ts"],
    allowedOperations: ["query_postcondition"],
    resourceBudgets: [{ resourceType: "tenant", maxCreates: 1 }],
    dataWritePolicy: "tracked_residual",
    residualTtlHours: 72
  });
  const confirmationId = pending.executionAuthorization!.confirmationId;
  await manager.recordUserDecision(confirmationId, "确认完整执行清单");
  const claimed = await manager.claimNextShortTransaction("formal-runner");
  assert.equal(claimed?.transactionId, "STX-15");
  await manager.blockShortTransaction("STX-15", "专用测试能力不可用", claimed?.claimToken);

  const reopened = await manager.reopenExecutionScope("正式用例改为原子执行");
  assert.equal(reopened.confirmations.find((item) => item.id === confirmationId)?.status, "已确认");
  assert.equal(reopened.executionAuthorization?.status, "superseded");
  assert.equal(reopened.blockers.find((item) => item.id === "BLK-STX-15")?.status, "已解除");
  assert.equal(reopened.shortTransactions.find((item) => item.id === "STX-12")?.status, "待开始");
  assert.equal((await manager.resumeAction())?.transactionId, "STX-12");
});

test("state commits create a deduplicated pending wake contract", async (context) => {
  const { root, requestId, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await manager.startOrResume({ requestId, planPath: "plan.md" });
  const wakes = await manager.listWakeRequests();
  assert.equal(wakes.length, 1);
  assert.equal(wakes[0]?.transactionId, "STX-01");
  await manager.dispatchWakeRequest(wakes[0]!.id);
  assert.equal((await manager.listWakeRequests()).length, 0);
});

test("execution envelope denies final replies for runnable work and exposes host binding", async (context) => {
  const { root, requestId, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await manager.startOrResume({ requestId, planPath: "plan.md" });
  assert.deepEqual((await manager.executionEnvelope()).reply, { allowed: false, reason: "runnable" });
  await manager.bindHostContinuation("automation-test", "session-test");
  const envelope = await manager.executionEnvelope();
  assert.equal(envelope.hostContinuation.status, "active");
  assert.equal(envelope.hostContinuation.automationId, "automation-test");
  await assert.rejects(
    () => manager.bindHostContinuation("automation-other", "session-test"),
    /different active heartbeat/
  );
});

test("unavailable host capability blocks the unique transaction and binding a heartbeat recovers it", async (context) => {
  const { root, requestId, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await manager.startOrResume({ requestId, planPath: "plan.md" });
  await manager.blockForUnavailableHost("session-test", "project hook is not trusted");
  const blocked = await manager.executionEnvelope();
  assert.equal(blocked.state, "blocked");
  assert.equal(blocked.reply.allowed, true);
  assert.equal((await manager.read())?.shortTransactions.find((item) => item.id === "STX-01")?.status, "阻塞");
  await manager.bindHostContinuation("automation-test", "session-test");
  const recovered = await manager.executionEnvelope();
  assert.equal(recovered.state, "active");
  assert.equal(recovered.hostContinuation.status, "active");
  assert.equal((await manager.read())?.shortTransactions.find((item) => item.id === "STX-01")?.status, "待开始");
});

test("execution envelope treats active leases as internal wait and formal blockers as user-visible", async (context) => {
  const { root, requestId, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await manager.startOrResume({ requestId, planPath: "plan.md" });
  const claim = await manager.claimNextShortTransaction("runner-a");
  const waiting = await manager.executionEnvelope();
  assert.equal(waiting.state, "internal_wait");
  assert.equal(waiting.reply.allowed, false);
  assert.deepEqual(waiting.internalWait?.refs, ["STX-01"]);
  await manager.blockShortTransaction("STX-01", "隔离环境不可用", claim?.claimToken);
  const blocked = await manager.executionEnvelope();
  assert.equal(blocked.state, "blocked");
  assert.equal(blocked.reply.allowed, true);
});

test("execution envelope allows a final reply only after every branch is terminal", async (context) => {
  const { root, requestId, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await manager.startOrResume({ requestId, planPath: "plan.md" });
  const state = (await manager.read())!;
  for (const transaction of state.shortTransactions) transaction.status = "已完成";
  for (const task of state.tasks) task.status = "已完成";
  state.overallStatus = "已完成";
  await manager.store.write(state);
  const envelope = await manager.executionEnvelope();
  assert.equal(envelope.state, "completed");
  assert.equal(envelope.reply.allowed, true);
});

test("claims use an owner lease and reject a different owner until expiry", async (context) => {
  const { root, requestId, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await manager.startOrResume({ requestId, planPath: "plan.md" });
  const first = await manager.claimNextShortTransaction("runner-a");
  const competing = await manager.claimNextShortTransaction("runner-b");
  assert.ok(first?.claimToken);
  assert.equal(competing?.claimToken, undefined);
  assert.equal(competing?.claimOwner, "runner-a");
  await assert.rejects(
    () => manager.commitShortTransaction("STX-01", { outputPaths: ["plan.md"], verificationResult: "ok", claimToken: "wrong" }),
    /claim token/
  );
  const state = (await manager.read())!;
  const transaction = state.shortTransactions.find((item) => item.id === "STX-01")!;
  transaction.leaseExpiresAt = new Date(0).toISOString();
  await manager.store.write(state);
  const takeover = await manager.claimNextShortTransaction("runner-b");
  assert.ok(takeover?.claimToken);
  assert.equal(takeover?.claimOwner, "runner-b");
});

test("cancel resolves a blocker as cancellation and closes downstream branches", async (context) => {
  const { root, requestId, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await manager.startOrResume({ requestId, planPath: "plan.md" });
  const claim = await manager.claimNextShortTransaction("runner-a");
  await manager.blockShortTransaction("STX-01", "用户取消当前目标", claim?.claimToken);
  await manager.resolveShortTransactionBlocker("STX-01", "取消", "用户明确取消");
  const state = (await manager.read())!;
  assert.equal(state.shortTransactions.find((item) => item.id === "STX-01")?.status, "已取消");
  assert.equal(state.shortTransactions.find((item) => item.id === "STX-17")?.status, "已取消");
  assert.equal((await manager.executionEnvelope()).state, "cancelled");
});

test("compare-and-swap rejects one of two stale concurrent state mutations", async (context) => {
  const { root, requestId, planPath, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await manager.startOrResume({ requestId, planPath });
  const other = new TestTaskStateManager(requestId, resolve(root, "state"), root);
  const results = await Promise.allSettled([
    manager.recordTaskOutputs({ taskId: "TASK-01", change: "引用", noPersistentOutput: true }),
    other.recordTaskOutputs({ taskId: "TASK-01", change: "引用", noPersistentOutput: true })
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(results.filter((item) => item.status === "rejected").length, 1);
});

test("the atomic store rejects a completed transaction without verification evidence", async (context) => {
  const { root, requestId, planPath, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await manager.startOrResume({ requestId, planPath });
  const state = (await manager.read())!;
  state.shortTransactions[0]!.status = "已完成";
  await manager.store.write(state);
  await assert.rejects(
    () => manager.recordTaskOutputs({ taskId: "TASK-01", change: "引用", noPersistentOutput: true }),
    /missing commit or verification evidence/
  );
});

test("resume reconstructs audit events missing after an interrupted append", async (context) => {
  const { root, requestId, planPath, manager } = await createHarness();
  context.after(() => rm(root, { recursive: true, force: true }));
  await manager.startOrResume({ requestId, planPath });
  const before = (await manager.read())!.recentEvents.map((event) => event.id).filter(Boolean);
  await rm(manager.store.eventsPath, { force: true });
  const resumed = new TestTaskStateManager(requestId, resolve(root, "state"), root);
  await resumed.startOrResume({ requestId, planPath });
  const logged = (await readFile(resumed.store.eventsPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).id);
  for (const id of before) assert.ok(logged.includes(id));
  assert.equal(new Set(logged).size, logged.length);
});
