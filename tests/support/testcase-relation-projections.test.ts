import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  CASE_RELATION_PROJECTION_MARKER_V1,
  synchronizeRequest
} from "../../scripts/testcase-relation-projections.ts";
import {
  projectRelationProjection,
  validateRelationProjection,
  validateRuleDesignMatrix
} from "../../src/support/testcase/relationProjection.js";
import {
  relationProjectionContractIssues,
  ruleLedgerContractIssues
} from "../../src/support/testcase/relationContract.js";

const plan = `> 结构版本：test-design-index-v1 / rule-design-ledger-v1 / ${CASE_RELATION_PROJECTION_MARKER_V1}。

## 需求索引

| REQ | sourceRef | 可验证需求 | 适用性 |
| --- | --- | --- | --- |
| REQ-DEMO-001 | SRC-DEMO-001 | 展示欢迎信息 | 适用 |

## 规则设计台账

| RULE | REQ | sourceRef | 条件 / 输入 | 可观察预期 | 设计方法 | caseIds | 风险 / 门禁 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-DEMO-001 | REQ-DEMO-001 | SRC-DEMO-001 | 打开页面 | 展示欢迎信息 | 场景法 | DEMO-MAIN-001 | no_write | 已覆盖 |
`;

const cases = `> 结构版本：testcase-v1-layered。

# 用例集：Demo

> 测试类型：Web ｜ 默认环境：test ｜ 默认数据策略：no_write
> 本文档仅用于确认测试设计，不代表授权执行或业务写入。
> 共 1 条 ｜ P0 1 条 ｜ 高风险 0 条 ｜ 参数化 0 条

## 快速索引

| 模块 | 用例编号 | 用例标题 | 优先级 | 风险 |
| --- | --- | --- | --- | --- |
| 页面 | DEMO-MAIN-001 | 验证欢迎信息 | P0 | 低 |

## 模块：页面

<details open>
<summary>DEMO-MAIN-001｜验证欢迎信息｜P0｜低风险</summary>

> 规则：RULE-DEMO-001
> 前置条件：页面可访问

| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
| — | 1 | 打开页面 | 无 | 展示欢迎信息 |

</details>
`;

test("v1 是唯一当前规则台账与关系投影", () => {
  assert.deepEqual(ruleLedgerContractIssues(plan), []);
  assert.deepEqual(relationProjectionContractIssues(plan), []);
  assert.ok(ruleLedgerContractIssues(plan.replace("rule-design-ledger-v1", "unsupported-version")).length > 0);
  assert.ok(relationProjectionContractIssues(plan.replace("case-relation-projection-v1", "unsupported-version")).length > 0);
});

test("当前计划与 v6 用例通过规则设计和双向关系校验", () => {
  assert.deepEqual(validateRuleDesignMatrix(plan), []);
  assert.deepEqual(validateRelationProjection(plan, { "cases.md": cases }), []);
});

test("关系投影只重建 v6 详情中的 RULE 与派生索引", () => {
  const drifted = cases.replace("> 规则：RULE-DEMO-001", "> 规则：RULE-DEMO-999");
  const projection = projectRelationProjection(plan, { "cases.md": drifted });
  assert.match(projection.packages["cases.md"] ?? "", /> 规则：RULE-DEMO-001/u);
  assert.deepEqual(projection.issues, []);
});

test("旧用例格式不进入关系解析器", () => {
  const issues = validateRelationProjection(plan, {
    "cases.md": cases.replace("testcase-v1-layered", "testcase-v1")
  });
  assert.ok(issues.some((issue) => issue.name === "用例格式"));
});

test("文件适配器只同步当前请求", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "relation-v1-only-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(root, { recursive: true });
  await writeFile(resolve(root, "plan.md"), plan, "utf8");
  await writeFile(resolve(root, "cases.md"), cases.replace("RULE-DEMO-001", "RULE-DEMO-999"), "utf8");
  const result = synchronizeRequest(root);
  assert.equal(result.strict, true);
  assert.deepEqual(result.issues, []);
  assert.match(await readFile(resolve(root, "cases.md"), "utf8"), /> 规则：RULE-DEMO-001/u);

  await writeFile(resolve(root, "plan.md"), plan.replace("case-relation-projection-v1", "unsupported-version"), "utf8");
  const rejected = synchronizeRequest(root);
  assert.equal(rejected.strict, false);
  assert.ok(rejected.issues.some((issue) => issue.name === "关系投影契约"));
});
