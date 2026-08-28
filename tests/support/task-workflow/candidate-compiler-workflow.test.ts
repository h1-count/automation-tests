import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { DurableWorkflowManager } from "../../../src/support/task-workflow/workflowManager.js";

const plan = `# 测试计划

> 结构版本：test-design-index-v1 / rule-design-ledger-v1 / case-relation-projection-v1。
> 用例格式：testcase-v1-layered。

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 测试请求 | web/demo/compiler |
| 测试类型 | Web |
| 目标环境 | test |

## 请求默认值

| 项目 | 内容 |
| --- | --- |
| 测试类型 | Web |
| 目标环境 | test |
| 数据策略 | no_write |

## 测试范围

### 包含

- 注册字段校验。

## 请求内来源

| 来源 ID | 路径 | SHA-256 | 事实范围 |
| --- | --- | --- | --- |
| SRC-DEMO-REG | [受控说明](../../../../sources/demo.md) | ${"a".repeat(64)} | L1 |

## 需求索引

| 需求 | 来源 |
| --- | --- |
| REQ-DEMO-REG | SRC-DEMO-REG |

## 规则设计台账

rule-design-ledger-v1

| RULE | REQ | sourceRef | 条件 / 输入 | 可观察预期 | 设计方法 | caseIds | 风险 / 门禁 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-DEMO-REG | REQ-DEMO-REG | SRC-DEMO-REG | 手机号为空 | 显示必填提示 | 等价类 | OPEN-DEMO-REG-001、OPEN-DEMO-REG-002 | no_write | 已覆盖 |

## 显式事实覆盖

| 事实引用 | 处置 | RULE | 理由 |
| --- | --- | --- | --- |

## 编译子约束分解

| 子约束 | RULE | caseId | 来源范围 | 显式事实引用 | 摘要 |
| --- | --- | --- | --- | --- |
| CLAUSE-DEMO-REG-001 | RULE-DEMO-REG | OPEN-DEMO-REG-001 | SRC-DEMO-REG#L1 | — | 手机号必填观察 |
| CLAUSE-DEMO-REG-002 | RULE-DEMO-REG | OPEN-DEMO-REG-002 | SRC-DEMO-REG#L1 | — | 手机号格式观察 |

## 需求歧义与未定义预期

无。

## 缺口与风险

无。

## 评审与正式决定

待评审。
`;

const compilerSpec = JSON.stringify({
  schemaVersion: "candidate-compiler-spec-v1",
  scope: "full",
  clauses: [{
    clauseId: "CLAUSE-DEMO-REG-001",
    generationMode: "deterministic", archetype: "required_field", title: "验证手机号必填", priority: "P0", risk: "中",
    preconditions: "注册页可访问且不提交表单", field: "手机号输入框", triggerAction: "触发字段级校验", validData: "合成 11 位手机号", validExpected: "字段通过校验",
    examples: [{ dataId: "D01", data: "保持为空", expected: "显示必填提示" }]
  }, {
    clauseId: "CLAUSE-DEMO-REG-002",
    generationMode: "deterministic", archetype: "format", title: "验证手机号格式", priority: "P1", risk: "中",
    preconditions: "注册页可访问且不提交表单", field: "手机号输入框", triggerAction: "触发字段级校验", validData: "合成 11 位手机号", validExpected: "字段通过校验",
    examples: [{ dataId: "D01", data: "非法字符", expected: "显示格式提示" }]
  }]
});

test("v1 compiler expands deterministic fragments without a fragment model call", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "candidate-compiler-v1-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const requestId = "web/demo/compiler";
  const requestRoot = resolve(root, ".local", "test-runs", ...requestId.split("/"));
  await mkdir(requestRoot, { recursive: true });
  await mkdir(resolve(root, "sources"), { recursive: true });
  await writeFile(resolve(root, "sources/demo.md"), "注册页面说明。\n", "utf8");
  await writeFile(resolve(requestRoot, "plan.md"), plan, "utf8");
  const manager = new DurableWorkflowManager(requestId, root);
  await manager.initialize({ capabilities: ["web"], casePackages: ["cases.md"], deliveryTarget: "testcase_only", fragmented: true });
  const source = await manager.startActivity("source-selection", "host");
  await manager.succeedActivity("source-selection", { claimToken: source.claimToken, verification: "sources selected" });
  const preflight = await manager.startActivity("candidate-preflight", "host");
  const result = await manager.preflightCandidatePlan({ claimToken: preflight.claimToken, publishId: "preflight", verification: "valid plan", plan });
  assert.equal(result.report.complete, true);
  await assert.rejects(manager.startActivity("candidate-compiler", "host"), /candidate-generation-start/u);
  const compiler = await manager.startCandidateGeneration("candidate-compiler", "host");
  await manager.publishCandidateCompiler({ claimToken: compiler.claimToken, publishId: "compiler", verification: "source grounded spec", spec: compilerSpec });
  const expanded = await manager.expandCandidateGraph();
  assert.equal(expanded.definitionVersion, "v1");
  assert.equal(expanded.readyActivities.length, 1);
  const fragmentId = expanded.readyActivities[0]!;
  assert.deepEqual(
    expanded.activities["case-review-conflict-decision"]?.definition.activation,
    { activityId: "case-review-resolution", outcomes: ["human_conflict"] }
  );
  assert.deepEqual(
    expanded.activities["case-confirmation"]?.definition.activation,
    { activityId: "case-review-resolution", outcomes: ["converged"] }
  );
  await manager.compileCandidateFragment({ activityId: fragmentId, owner: "host", publishId: "compiled", verification: "deterministic renderer" });
  const after = await manager.gate();
  assert.deepEqual(after.readyActivities, ["candidate-assemble"]);
  const assembly = await manager.startActivity("candidate-assemble", "host");
  await manager.assembleCandidateFragments({ claimToken: assembly.claimToken, publishId: "assembled", verification: "deterministic assembly" });
  const cases = await readFile(resolve(requestRoot, "cases.md"), "utf8");
  assert.match(cases, /OPEN-DEMO-REG-001/u);
  assert.match(cases, /OPEN-DEMO-REG-002/u);
  const gate = await manager.startActivity("candidate-gate", "host");
  const gateResult = await manager.succeedCandidateGate(gate.claimToken);
  assert.equal(gateResult.report.reviewMode, "deterministic_only");
  const resolution = await manager.startActivity("case-review-resolution", "host");
  await assert.rejects(
    manager.publishArtifactsAndSucceed("case-review-resolution", {
      claimToken: resolution.claimToken,
      publishId: "wrong-resolution-path",
      verification: "must use the dedicated deterministic closer",
      outcome: "converged",
      artifacts: [{ targetPath: manager.planPath, content: await readFile(manager.planPath, "utf8") }]
    }),
    /review-resolution-complete/u
  );
  const closed = await manager.completeDeterministicReviewResolution({
    claimToken: resolution.claimToken,
    publishId: "deterministic-resolution",
    verification: "candidate gate established deterministic-only closure"
  });
  assert.equal(closed.activities["case-review-resolution"]?.outcome, "converged");
  assert.equal(closed.activities["case-confirmation"]?.state, "READY");
  const events = await manager.events();
  assert.equal(events.filter((event) => event.type === "CandidateGenerationStarted" && event.payload.activityId === fragmentId).length, 0);
});

test("v11 model fragments require the dedicated frozen-relation publisher", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "candidate-compiler-model-v1-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const requestId = "web/demo/compiler-model";
  const requestRoot = resolve(root, "testcases", ...requestId.split("/"));
  await mkdir(requestRoot, { recursive: true });
  await mkdir(resolve(root, "sources"), { recursive: true });
  await writeFile(resolve(root, "sources/demo.md"), "注册页面说明。\n", "utf8");
  await writeFile(resolve(requestRoot, "plan.md"), plan, "utf8");
  const manager = new DurableWorkflowManager(requestId, root);
  await manager.initialize({ capabilities: ["web"], casePackages: ["cases.md"], deliveryTarget: "testcase_only", fragmented: true });
  const source = await manager.startActivity("source-selection", "host");
  await manager.succeedActivity("source-selection", { claimToken: source.claimToken, verification: "sources selected" });
  const preflight = await manager.startActivity("candidate-preflight", "host");
  await manager.preflightCandidatePlan({ claimToken: preflight.claimToken, publishId: "preflight", verification: "valid plan", plan });
  const compiler = await manager.startCandidateGeneration("candidate-compiler", "host");
  const raw = JSON.parse(compilerSpec) as { clauses: Array<Record<string, unknown>> };
  raw.clauses = [
    { clauseId: "CLAUSE-DEMO-REG-001", generationMode: "model" },
    { clauseId: "CLAUSE-DEMO-REG-002", generationMode: "model" }
  ];
  await manager.publishCandidateCompiler({ claimToken: compiler.claimToken, publishId: "compiler", verification: "model spec", spec: JSON.stringify(raw) });
  const expanded = await manager.expandCandidateGraph();
  const fragmentId = expanded.readyActivities[0]!;
  const fragment = await manager.startCandidateGeneration(fragmentId, "host");
  await manager.publishModelCandidateFragment({
    activityId: fragmentId,
    claimToken: fragment.claimToken,
    publishId: "model-fragment",
    verification: "frozen relation model fragment",
    content: `## 模块：模块 OPEN-DEMO-REG

<details>
<summary>OPEN-DEMO-REG-001｜验证手机号为空｜P0｜中风险</summary>

> 规则：RULE-DEMO-REG
> 前置条件：注册页可访问且不提交表单
> 差异：来源=SRC-DEMO-REG

| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
| — | 1 | 输入手机号 | 保持为空 | 显示必填提示 |

</details>

<details>
<summary>OPEN-DEMO-REG-002｜验证手机号格式｜P1｜中风险</summary>

> 规则：RULE-DEMO-REG
> 前置条件：注册页可访问且不提交表单
> 差异：来源=SRC-DEMO-REG

| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
| — | 1 | 输入手机号 | 非法字符 | 显示必填提示 |

</details>
`
  });
  assert.equal((await manager.gate()).activities[fragmentId]?.state, "SUCCEEDED");
});
