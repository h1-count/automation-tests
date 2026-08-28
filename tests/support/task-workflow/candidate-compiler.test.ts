import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateCompilerManifest,
  mergeCandidateCompilerFragment,
  parseCandidateCompilerSpec,
  renderDeterministicCandidateFragment,
  validateCandidateCompilerSpecAgainstPlan
} from "../../../src/support/task-workflow/candidateCompiler.js";
import { validateCandidateFragmentContent } from "../../../src/support/task-workflow/candidateFragments.js";

const plan = `
> 结构版本：rule-design-ledger-v1。

## 规则设计台账

| RULE | REQ | sourceRef | 条件 / 输入 | 可观察预期 | 设计方法 | caseIds | 风险 / 门禁 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-PROD-001 | REQ-PROD-001 | SRC-PROD-001 | 名称边界、重复与状态 | 长度正确，重复和状态由模型解释 | 边界值 | OPEN-NAME-001、OPEN-NAME-002、OPEN-NAME-003 | no_write | 已覆盖 |

## 编译子约束分解

| 子约束 | RULE | caseId | 来源范围 | 显式事实引用 | 摘要 |
| --- | --- | --- | --- | --- |
| CLAUSE-PROD-001 | RULE-PROD-001 | OPEN-NAME-001 | SRC-PROD-001#L1 | SRC-PROD-001#L1:limit | 名称长度 59/60/61 |
| CLAUSE-PROD-002 | RULE-PROD-001 | OPEN-NAME-002 | SRC-PROD-001#L1 | — | 重复名称 |
| CLAUSE-PROD-003 | RULE-PROD-001 | OPEN-NAME-003 | SRC-PROD-001#L1 | — | 创建后状态 |
`;

const spec = () => parseCandidateCompilerSpec(JSON.stringify({
  schemaVersion: "candidate-compiler-spec-v1", scope: "full",
  clauses: [
    { clauseId: "CLAUSE-PROD-001", generationMode: "deterministic", archetype: "range", title: "验证产品名称长度", priority: "P0", risk: "中", preconditions: "创建页可访问且不提交", field: "产品名称", triggerAction: "触发字段级校验", validData: "60 字符合成名称", validExpected: "字段通过校验", examples: [{ dataId: "D01", data: "61 字符合成名称", expected: "显示超长提示" }] },
    { clauseId: "CLAUSE-PROD-002", generationMode: "model" },
    { clauseId: "CLAUSE-PROD-003", generationMode: "model" }
  ]
}));

test("compiler splits one frozen RULE by case without allowing host case allocation", () => {
  const value = spec();
  validateCandidateCompilerSpecAgainstPlan(value, plan);
  const manifest = candidateCompilerManifest(value, plan);
  const module = manifest.modules[0]!;
  assert.equal(manifest.schemaVersion, "candidate-fragment-manifest-v1");
  assert.deepEqual(module.deterministicCaseIds, ["OPEN-NAME-001"]);
  assert.deepEqual(module.modelCaseIds, ["OPEN-NAME-002", "OPEN-NAME-003"]);
  assert.equal(module.generationMode, "mixed");
  assert.match(renderDeterministicCandidateFragment(value, manifest, module.id), /OPEN-NAME-001/u);
});

test("model merge rejects deterministic case overwrite and retains frozen rule relation", () => {
  const value = spec(); const manifest = candidateCompilerManifest(value, plan); const module = manifest.modules[0]!;
  assert.throws(() => mergeCandidateCompilerFragment(value, manifest, module.id, `## 模块：${module.title}

<details>
<summary>OPEN-NAME-001｜错误覆盖｜P0｜中风险</summary>

> 规则：RULE-PROD-001
> 前置条件：创建页可访问
> 差异：来源=SRC-PROD-001

| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
| — | 1 | 输入名称 | 61 字符 | 拒绝 |

</details>`), /only frozen model caseIds/u);
  const merged = mergeCandidateCompilerFragment(value, manifest, module.id, `## 模块：${module.title}

<details>
<summary>OPEN-NAME-002｜验证重复名称｜P1｜中风险</summary>

> 规则：RULE-PROD-001
> 前置条件：创建页可访问且不提交
> 差异：来源=SRC-PROD-001

| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
| — | 1 | 输入重复名称 | 合成重复值 | 显示重复提示 |

</details>

<details>
<summary>OPEN-NAME-003｜验证创建后状态｜P1｜中风险</summary>

> 规则：RULE-PROD-001
> 前置条件：创建页可访问且不提交
> 差异：来源=SRC-PROD-001

| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
| — | 1 | 查看冻结状态说明 | 无 | 交模型评估 |

</details>`);
  validateCandidateFragmentContent(merged, module);
  assert.match(merged, /OPEN-NAME-001/u);
});

test("observation templates generate read-only actions", () => {
  const value = parseCandidateCompilerSpec(JSON.stringify({ schemaVersion: "candidate-compiler-spec-v1", scope: "full", clauses: [
    { clauseId: "CLAUSE-PROD-001", generationMode: "deterministic", archetype: "pagination", title: "验证分页边界", priority: "P1", risk: "低", preconditions: "列表页可访问", field: "产品列表", triggerAction: "查看分页结果", validData: "第 2 页", validExpected: "每页 10 条且无空页", examples: [{ dataId: "D01", data: "第 1 页", expected: "展示可见记录" }] },
    { clauseId: "CLAUSE-PROD-002", generationMode: "deterministic", archetype: "display", title: "验证展示占位", priority: "P1", risk: "低", preconditions: "列表页可访问", field: "默认图片", triggerAction: "查看占位展示", validData: "未上传图片", validExpected: "显示默认图", examples: [{ dataId: "D01", data: "已上传图片", expected: "显示产品图片" }] },
    { clauseId: "CLAUSE-PROD-003", generationMode: "deterministic", archetype: "page_structure", title: "验证向导结构", priority: "P1", risk: "低", preconditions: "入口可访问", field: "创建产品向导", triggerAction: "查看步骤结构", validData: "无", validExpected: "展示冻结步骤", examples: [{ dataId: "D01", data: "无", expected: "第一步可见" }] }
  ] }));
  const manifest = candidateCompilerManifest(value, plan);
  const content = renderDeterministicCandidateFragment(value, manifest, manifest.modules[0]!.id);
  assert.match(content, /查看产品列表并查看分页结果/u);
  assert.match(content, /查看默认图片并查看占位展示/u);
  assert.doesNotMatch(content, /点击提交|发送 POST|调用 API/u);
});

test("compiler rejects host case ownership and a mixed mode for one frozen case", () => {
  const raw = JSON.parse(JSON.stringify(spec())) as { clauses: Array<Record<string, unknown>> };
  raw.clauses[0]!.caseId = "OPEN-NAME-001";
  assert.throws(() => parseCandidateCompilerSpec(JSON.stringify(raw)), /may not declare derived/u);
  const mixedPlan = plan.replace("| CLAUSE-PROD-002 | RULE-PROD-001 | OPEN-NAME-002", "| CLAUSE-PROD-002 | RULE-PROD-001 | OPEN-NAME-001");
  assert.throws(() => validateCandidateCompilerSpecAgainstPlan(spec(), mixedPlan), /cannot mix deterministic and model clauses/u);
});
