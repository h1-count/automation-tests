import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { CASE_RELATION_PROJECTION_MARKER, synchronizeRequest } from "../../scripts/testcase-relation-projections.ts";
import { parseCaseIds, projectRelationProjection, validateRelationProjection } from "../../src/support/testcase/relationProjection.ts";

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
| REQ-AUTH-002 | PRD | P0 | 共用登录规则 | 适用 | 登录 | 手工值 | 已覆盖 | 无 |

## 规则覆盖台账
| 规则编号 | 需求追溯编号 | 来源定位 | 规则类型 | 触发条件/输入 | 可观察预期 | 设计证据 | 适用性 | 覆盖状态 | 关联 caseId | 依据、执行门禁或裁决 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-AUTH-001 | REQ-AUTH-001、REQ-AUTH-002 | PRD | 业务规则 | 登录 | 成功 | 场景法 | 适用 | 已覆盖 | AUTH-LOGIN-001、AUTH-LOGIN-002 | 明确 |
| RULE-AUTH-002 | REQ-AUTH-001 | PRD | 输入边界 | 验证码 | 提示 | 等价类与边界 | 适用 | 已覆盖 | AUTH-LOGIN-001 | 明确 |

## 规则设计矩阵
| 规则编号 | 字段或状态对象 | 必填/选填 | 有效、无效或边界输入 | 可观察预期 | 数据前置 | 执行门禁 | 关联 caseId | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RULE-AUTH-001 | 登录 | 必填 | 合法输入 | 登录成功 | 账号 | no_write | 阶段二生成 | 已覆盖 |
| RULE-AUTH-002 | 验证码 | 必填 | 合法输入 | 提示 | 账号 | no_write | 阶段二生成 | 已覆盖 |

### 基准资料与模块映射
| 资料 | 规则编号 | 派生 caseId |
| --- | --- | --- |
| PRD | RULE-AUTH-001 至 RULE-AUTH-002 | 手工值 |

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

test("caseId 解析不将 REQ 或 RULE 编号当作原子用例", () => {
  assert.deepEqual(parseCaseIds("REQ-AUTH-001、RULE-AUTH-001、AUTH-LOGIN-001"), ["AUTH-LOGIN-001"]);
});

test("纯关系投影不读取或写入文件", () => {
  const result = projectRelationProjection(plan, { "cases-login.md": cases });
  assert.equal(result.issues.length, 0);
  assert.match(result.plan, /AUTH-LOGIN-001、AUTH-LOGIN-002/);
  assert.match(result.packages["cases-login.md"]!, /规则覆盖编号 \| RULE-AUTH-001、RULE-AUTH-002/);
});

test("关系投影保留 Markdown 单元格中的转义管道", () => {
  const result = projectRelationProjection(
    plan.replace("登录 | 已覆盖", "登录\\|OAuth | 已覆盖"),
    { "cases-login.md": cases }
  );
  assert.equal(result.issues.length, 0);
  assert.match(result.plan, /登录\\\|OAuth \| 已覆盖/);
});

test("关系校验拒绝同包或跨包重复 caseId", () => {
  const result = validateRelationProjection(plan, {
    "cases-login.md": cases,
    "cases-other.md": cases.replace(/AUTH-LOGIN-002/g, "AUTH-LOGIN-001")
  });
  assert.ok(result.some((issue) => issue.name === "caseId 唯一性"));
});

test("同步 RULE 关系源到需求、覆盖、用例包和原子用例视图", async (context) => {
  const directory = await fixture();
  context.after(() => rm(directory, { recursive: true, force: true }));
  const result = synchronizeRequest(directory);
  assert.equal(result.issues.length, 0);
  assert.equal(result.changedFiles.length, 2);
  const synchronizedPlan = await readFile(join(directory, "plan.md"), "utf8");
  const synchronizedCases = await readFile(join(directory, "cases-login.md"), "utf8");
  assert.match(synchronizedPlan, /REQ-AUTH-001 \| PRD[\s\S]*?AUTH-LOGIN-001、AUTH-LOGIN-002/);
  assert.match(synchronizedPlan, /REQ-AUTH-002 \| PRD[\s\S]*?AUTH-LOGIN-001、AUTH-LOGIN-002/);
  assert.match(synchronizedPlan, /PRD \| RULE-AUTH-001 至 RULE-AUTH-002 \| AUTH-LOGIN-001、AUTH-LOGIN-002/);
  assert.match(synchronizedPlan, /业务功能与规则 \| 适用 \| 登录 \| 已覆盖 \| AUTH-LOGIN-001、AUTH-LOGIN-002/);
  assert.match(synchronizedPlan, /输入与数据校验 \| 适用 \| 验证码 \| 已覆盖 \| AUTH-LOGIN-001/);
  assert.match(synchronizedPlan, /`cases-login\.md` \| 登录 \| 登录 \| AUTH-LOGIN-001、AUTH-LOGIN-002/);
  assert.match(synchronizedPlan, /RULE-AUTH-001 \| 登录[\s\S]*?AUTH-LOGIN-001、AUTH-LOGIN-002/);
  assert.match(synchronizedPlan, /RULE-AUTH-002 \| 验证码[\s\S]*?AUTH-LOGIN-001/);
  assert.match(synchronizedCases, /\| 规则覆盖编号 \| RULE-AUTH-001、RULE-AUTH-002 \|/);
  assert.match(synchronizedCases, /\| 规则覆盖编号 \| RULE-AUTH-001 \|/);
  assert.match(synchronizedCases, /\| 需求追溯编号 \| REQ-AUTH-001、REQ-AUTH-002 \|/);
});

test("校验模式报告手工改写的派生视图", async (context) => {
  const directory = await fixture();
  context.after(() => rm(directory, { recursive: true, force: true }));
  synchronizeRequest(directory);
  await writeFile(join(directory, "cases-login.md"), cases, "utf8");
  const result = synchronizeRequest(directory, { check: true });
  assert.ok(result.issues.some((issue) => issue.name === "派生视图未同步"));
});

test("已存在原子用例时拒绝规则设计矩阵中的阶段占位", async (context) => {
  const directory = await fixture();
  context.after(() => rm(directory, { recursive: true, force: true }));
  const result = synchronizeRequest(directory, { check: true });
  assert.ok(result.issues.some((issue) => issue.detail.includes("阶段二生成")));
  synchronizeRequest(directory);
  const checked = synchronizeRequest(directory, { check: true });
  assert.equal(checked.issues.length, 0);
});

test("拒绝规则设计矩阵手工指向其他 caseId", async (context) => {
  const directory = await fixture();
  context.after(() => rm(directory, { recursive: true, force: true }));
  synchronizeRequest(directory);
  const path = join(directory, "plan.md");
  await writeFile(
    path,
    (await readFile(path, "utf8")).replace(
      "账号 | no_write | AUTH-LOGIN-001、AUTH-LOGIN-002 | 已覆盖",
      "账号 | no_write | AUTH-LOGIN-999 | 已覆盖"
    ),
    "utf8"
  );
  const result = synchronizeRequest(directory, { check: true });
  assert.ok(result.issues.some((issue) => issue.name === "规则设计关系源"));
});

test("已存在原子用例时拒绝适用规则缺少 RULE 台账 caseId", async (context) => {
  const directory = await fixture();
  context.after(() => rm(directory, { recursive: true, force: true }));
  synchronizeRequest(directory);
  const path = join(directory, "plan.md");
  await writeFile(
    path,
    (await readFile(path, "utf8")).replace(
      "| RULE-AUTH-002 | REQ-AUTH-001 | PRD | 输入边界 | 验证码 | 提示 | 等价类与边界 | 适用 | 已覆盖 | AUTH-LOGIN-001 | 明确 |",
      "| RULE-AUTH-002 | REQ-AUTH-001 | PRD | 输入边界 | 验证码 | 提示 | 等价类与边界 | 适用 | 已覆盖 | 无 | 明确 |"
    ),
    "utf8"
  );
  const result = synchronizeRequest(directory, { check: true });
  assert.ok(result.issues.some((issue) => issue.detail.includes("缺少有效 RULE → caseId")));
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

test("CLI 只写暂存副本，最终请求目录仅允许 --check", async (context) => {
  const directory = await fixture();
  context.after(() => rm(directory, { recursive: true, force: true }));
  synchronizeRequest(directory);
  const projectRoot = resolve(import.meta.dirname, "../..");
  const check = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/sync-testcase-relations.ts",
      "--check",
      directory
    ],
    { cwd: projectRoot, encoding: "utf8" }
  );
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /校验通过/);

  const finalWrite = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/sync-testcase-relations.ts",
      "testcases/web/demo/not-an-active-request"
    ],
    { cwd: projectRoot, encoding: "utf8" }
  );
  assert.notEqual(finalWrite.status, 0);
  assert.match(finalWrite.stderr, /read-only/);
});
