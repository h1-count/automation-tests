import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CASE_RELATION_PROJECTION_MARKER, synchronizeRequest } from "../../scripts/testcase-relation-projections.ts";

const plan = `# 测试计划
> ${CASE_RELATION_PROJECTION_MARKER}

## 覆盖矩阵
| 覆盖域 | 适用性与依据 | 计划覆盖范围 | 结论 | 派生 caseId |
| --- | --- | --- | --- | --- |
| 业务功能与规则 | 适用 | 登录 | 已覆盖 | 手工值 |
| 输入与数据校验 | 适用 | 验证码 | 已覆盖 | 手工值 |

## 需求追溯矩阵
| 追溯编号 | 需求来源与版本/章节 | 优先级 | 可验证业务规则 | 适用性 | 计划覆盖范围 | 派生 caseId | 覆盖状态 | 缺失信息或执行门禁 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| REQ-AUTH-001 | PRD | P0 | 登录 | 适用 | 登录与验证码 | 手工值 | 已覆盖 | 无 |

## 规则覆盖台账
| 规则编号 | 需求追溯编号 | 来源定位 | 规则类型 | 触发条件/输入 | 可观察预期 | 设计证据 | 适用性 | 覆盖状态 | 关联 caseId | 依据、执行门禁或裁决 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-AUTH-001 | REQ-AUTH-001 | PRD | 业务规则 | 登录 | 成功 | 场景法 | 适用 | 已覆盖 | AUTH-LOGIN-001、AUTH-LOGIN-002 | 明确 |
| RULE-AUTH-002 | REQ-AUTH-001 | PRD | 输入边界 | 验证码 | 提示 | 等价类与边界 | 适用 | 已覆盖 | AUTH-LOGIN-001 | 明确 |

## 用例包目录
| 用例包 | 覆盖模块或流程 | 计划覆盖范围 | 实际原子用例编号 | 生成状态 | 特殊门禁 |
| --- | --- | --- | --- | --- | --- |
| \`cases-login.md\` | 登录 | 登录 | 手工值 | 草案完整 | 无 |
`;

const cases = `# 用例包：登录

## 测试用例：登录

| 项目 | 内容 |
| --- | --- |
| 用例编号 | AUTH-LOGIN-001 |
| 需求追溯编号 | REQ-AUTH-001 |
| 规则覆盖编号 | 手工值 |

## 测试用例：第二登录

| 项目 | 内容 |
| --- | --- |
| 用例编号 | AUTH-LOGIN-002 |
| 需求追溯编号 | REQ-AUTH-001 |
| 规则覆盖编号 | 手工值 |
`;

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "case-relations-"));
  await writeFile(join(directory, "plan.md"), plan, "utf8");
  await writeFile(join(directory, "cases-login.md"), cases, "utf8");
  return directory;
}

test("同步 RULE 关系源到需求、覆盖、用例包和原子用例视图", async (context) => {
  const directory = await fixture();
  context.after(() => rm(directory, { recursive: true, force: true }));
  const result = synchronizeRequest(directory);
  assert.equal(result.issues.length, 0);
  assert.equal(result.changedFiles.length, 2);
  const synchronizedPlan = await readFile(join(directory, "plan.md"), "utf8");
  const synchronizedCases = await readFile(join(directory, "cases-login.md"), "utf8");
  assert.match(synchronizedPlan, /REQ-AUTH-001 \| PRD[\s\S]*?AUTH-LOGIN-001、AUTH-LOGIN-002/);
  assert.match(synchronizedPlan, /业务功能与规则 \| 适用 \| 登录 \| 已覆盖 \| AUTH-LOGIN-001、AUTH-LOGIN-002/);
  assert.match(synchronizedPlan, /输入与数据校验 \| 适用 \| 验证码 \| 已覆盖 \| AUTH-LOGIN-001/);
  assert.match(synchronizedPlan, /`cases-login\.md` \| 登录 \| 登录 \| AUTH-LOGIN-001、AUTH-LOGIN-002/);
  assert.match(synchronizedCases, /\| 规则覆盖编号 \| RULE-AUTH-001、RULE-AUTH-002 \|/);
  assert.match(synchronizedCases, /\| 规则覆盖编号 \| RULE-AUTH-001 \|/);
});

test("校验模式报告手工改写的派生视图", async (context) => {
  const directory = await fixture();
  context.after(() => rm(directory, { recursive: true, force: true }));
  synchronizeRequest(directory);
  await writeFile(join(directory, "cases-login.md"), cases, "utf8");
  const result = synchronizeRequest(directory, { check: true });
  assert.ok(result.issues.some((issue) => issue.name === "派生视图未同步"));
});

test("拒绝 RULE 关系源引用不存在的 caseId，历史请求保持兼容", async (context) => {
  const directory = await fixture();
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "plan.md"), plan.replace("AUTH-LOGIN-001、AUTH-LOGIN-002", "AUTH-LOGIN-999"), "utf8");
  assert.ok(synchronizeRequest(directory).issues.some((issue) => issue.name === "RULE 关系源"));
  await writeFile(join(directory, "plan.md"), plan.replace(`> ${CASE_RELATION_PROJECTION_MARKER}\n`, ""), "utf8");
  const historical = synchronizeRequest(directory, { check: true });
  assert.equal(historical.strict, false);
  assert.equal(historical.issues[0]?.name, "历史请求兼容");
});
