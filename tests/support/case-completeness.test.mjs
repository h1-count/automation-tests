import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditPack, scopeSchema } from "../../scripts/audit-case-completeness.mjs";

const categories = ["C01", "C02", "C03", "C04", "C05", "C06", "C07"];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function combinationDesign(overrides = {}) {
  return {
    strategy: "not_applicable",
    rationale: "对象无参数交叉影响",
    validCombinationCount: 0,
    parameters: [],
    constraints: [],
    ...overrides
  };
}

function validScope() {
  return {
    schema: scopeSchema,
    categories: categories.map((code) => ({
      code,
      name: code,
      objects: [{
        id: `${code.toLowerCase()}-object`,
        name: `${code} 对象`,
        evidence: ["需求说明第 1 节"],
        disposition: "covered",
        caseIds: ["OP-DEMO-001"],
        combinationDesign: code === "C07"
          ? combinationDesign({ manualSupplementCaseIds: ["OP-DEMO-001"] })
          : combinationDesign()
      }]
    }))
  };
}

/** 三参数、无约束、有效组合 27 条的 pairwise 模型。 */
const pairwiseModel = {
  parameters: {
    登录方式: ["账号密码", "短信验证码", "扫码"],
    凭证有效性: ["有效", "无效", "过期"],
    协议勾选: ["已勾选", "未勾选", "半选"]
  }
};

async function writeFixture(scope, { casesText = "# cases\nOP-DEMO-001\n", files = {} } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "case-completeness-"));
  await fs.writeFile(path.join(directory, "cases.md"), casesText, "utf8");
  await fs.writeFile(path.join(directory, "scope.json"), JSON.stringify(scope), "utf8");
  for (const [name, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true });
    await fs.writeFile(path.join(directory, name), content, "utf8");
  }
  return directory;
}

async function fixture(mutator, options) {
  const scope = validScope();
  mutator?.(scope);
  return writeFixture(scope, options);
}

async function problems(mutator, options) {
  const directory = await fixture(mutator, options);
  try {
    return (await auditPack(directory)).problems.map((problem) => problem.message);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test("合法覆盖通过", async () => {
  const directory = await fixture();
  try {
    const result = await auditPack(directory);
    assert.deepEqual(result.problems, []);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("缺少类别失败", async () => {
  const result = await problems((scope) => scope.categories.pop());
  assert.ok(result.some((message) => message.includes("缺少 C07")));
});

test("空对象与无依据失败", async () => {
  const result = await problems((scope) => {
    scope.categories[0].objects = [];
    scope.categories[1].objects[0].evidence = [];
  });
  assert.ok(result.some((message) => message.includes("至少包含一个范围对象")));
  assert.ok(result.some((message) => message.includes("至少一条源码或资料依据")));
});

test("未知用例 ID 失败", async () => {
  const result = await problems((scope) => { scope.categories[0].objects[0].caseIds = ["OP-DEMO-404"]; });
  assert.ok(result.some((message) => message.includes("不存在于 cases.md")));
});

test("范围外必须有理由，合法范围外通过", async () => {
  const invalid = await problems((scope) => {
    const object = scope.categories[0].objects[0];
    object.disposition = "out_of_scope";
    delete object.caseIds;
  });
  assert.ok(invalid.some((message) => message.includes("范围外理由")));
  const valid = await problems((scope) => {
    const object = scope.categories[0].objects[0];
    object.disposition = "out_of_scope";
    object.reason = "当前需求未定义该对象";
    delete object.caseIds;
  });
  assert.deepEqual(valid, []);
});

test("pending 阻断审核与执行前的审计", async () => {
  const result = await problems((scope) => {
    const object = scope.categories[0].objects[0];
    object.disposition = "pending";
    delete object.caseIds;
  });
  assert.ok(result.some((message) => message.includes("pending 仅可在设计中暂存")));
});

test("缺少 combinationDesign 失败", async () => {
  const result = await problems((scope) => { delete scope.categories[0].objects[0].combinationDesign; });
  assert.ok(result.some((message) => message.includes("必须声明 combinationDesign")));
});

test("缺少策略理由、参数依据或约束说明失败", async () => {
  const missingRationale = await problems((scope) => { scope.categories[0].objects[0].combinationDesign.rationale = ""; });
  assert.ok(missingRationale.some((message) => message.includes("策略理由")));
  const missingConstraintField = await problems((scope) => {
    const design = scope.categories[0].objects[0].combinationDesign;
    Object.assign(design, {
      strategy: "direct_enumeration",
      rationale: "两参数直接枚举",
      validCombinationCount: 4,
      parameters: [
        { name: "登录方式", values: ["账号密码", "短信"], evidence: "登录页面原型" },
        { name: "凭证有效性", values: ["有效", "无效"], evidence: "需求第 2 节" }
      ]
    });
    delete design.constraints;
  });
  assert.ok(missingConstraintField.some((message) => message.includes("业务约束说明")));
  const missingParameterEvidence = await problems((scope) => {
    const design = scope.categories[0].objects[0].combinationDesign;
    Object.assign(design, {
      strategy: "direct_enumeration",
      rationale: "两参数直接枚举",
      validCombinationCount: 4,
      constraints: [],
      parameters: [{ name: "登录方式", values: ["账号密码", "短信"], evidence: "" }]
    });
  });
  assert.ok(missingParameterEvidence.some((message) => message.includes("等价类取值和依据")));
});

test("无组合对象携带参数或组合数即失败", async () => {
  const result = await problems((scope) => {
    scope.categories[0].objects[0].combinationDesign = combinationDesign({
      validCombinationCount: 2,
      parameters: [{ name: "开关", values: ["开", "关"], evidence: "需求第 3 节" }]
    });
  });
  assert.ok(result.some((message) => message.includes("not_applicable 必须无参数")));
});

test("两参数与三参数 12 条有效组合可直接枚举", async () => {
  const direct = (parameterCount) => (scope) => {
    const design = scope.categories[0].objects[0].combinationDesign;
    Object.assign(design, {
      strategy: "direct_enumeration",
      rationale: "有效组合不超过 12 条",
      validCombinationCount: parameterCount === 2 ? 4 : 12,
      constraints: ["短信登录不出现密码框"],
      parameters: Array.from({ length: parameterCount }, (_, index) => ({
        name: `参数${index + 1}`,
        values: ["取值A", "取值B"],
        evidence: "需求说明"
      }))
    });
  };
  assert.deepEqual(await problems(direct(2)), []);
  assert.deepEqual(await problems(direct(3)), []);
});

test("三参数且有效组合超过 12 条仍选直接枚举失败", async () => {
  const result = await problems((scope) => {
    const design = scope.categories[0].objects[0].combinationDesign;
    Object.assign(design, {
      strategy: "direct_enumeration",
      rationale: "误判为直接枚举",
      validCombinationCount: 13,
      constraints: [],
      parameters: Array.from({ length: 3 }, (_, index) => ({
        name: `参数${index + 1}`,
        values: ["取值A", "取值B", "取值C"],
        evidence: "需求说明"
      }))
    });
  });
  assert.ok(result.some((message) => message.includes("必须使用 pairwise")));
});

test("无业务约束的直接枚举必须如实登记有效组合数", async () => {
  const result = await problems((scope) => {
    const design = scope.categories[0].objects[0].combinationDesign;
    Object.assign(design, {
      strategy: "direct_enumeration",
      rationale: "两个参数直接枚举",
      validCombinationCount: 3,
      constraints: [],
      parameters: [
        { name: "登录方式", values: ["密码", "短信"], evidence: "页面原型" },
        { name: "凭证", values: ["有效", "无效"], evidence: "需求说明" }
      ]
    });
  });
  assert.ok(result.some((message) => message.includes("笛卡尔积")));
});

test("未知 strategy 失败", async () => {
  const result = await problems((scope) => { scope.categories[0].objects[0].combinationDesign.strategy = "full_combination"; });
  assert.ok(result.some((message) => message.includes("strategy 必须是")));
});

test("合法 pairwise 模型重放通过且 D 编号落入 cases.md", async () => {
  const directory = await fixture(null, {
    files: { "runtime/pairwise/pict-model.json": JSON.stringify(pairwiseModel) }
  });
  try {
    // 用同一生成器推导期望值，避免测试内复刻 pairwise 算法。
    const { spawnSync } = await import("node:child_process");
    const generated = JSON.parse(spawnSync(process.execPath,
      ["skills/testcase-designer/scripts/pict-pairwise.mjs", "--model", path.join(directory, "runtime/pairwise/pict-model.json"), "--format", "json"],
      { cwd: root, encoding: "utf8" }).stdout);
    const dataIds = generated.rows.map((_, index) => `D${String(index + 1).padStart(2, "0")}`);
    await fs.writeFile(path.join(directory, "cases.md"), `# cases\nOP-DEMO-001\n参数化数据 ${dataIds.join("、")}\n`, "utf8");
    const scope = validScope();
    scope.categories[0].objects[0].combinationDesign = combinationDesign({
      strategy: "pairwise",
      rationale: "3 参数 27 条有效组合，pairwise 压缩",
      validCombinationCount: generated.statistics.validCombos,
      constraints: [],
      parameters: Object.entries(pairwiseModel.parameters).map(([name, values]) => ({ name, values, evidence: "登录页面原型" })),
      modelPath: "runtime/pairwise/pict-model.json",
      modelDigest: sha256(JSON.stringify(pairwiseModel)),
      dataIds,
      manualSupplementReason: "无写入动作，两两覆盖足够"
    });
    await fs.writeFile(path.join(directory, "scope.json"), JSON.stringify(scope), "utf8");
    const result = await auditPack(directory);
    assert.deepEqual(result.problems, []);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("pairwise 模型缺失、摘要不一致、组合数不一致、D 编号未落地均失败", async () => {
  const baseFiles = { "runtime/pairwise/pict-model.json": JSON.stringify(pairwiseModel) };
  const asPairwise = (overrides) => (scope) => {
    scope.categories[0].objects[0].combinationDesign = combinationDesign({
      strategy: "pairwise",
      rationale: "3 参数 27 条有效组合",
      validCombinationCount: 27,
      constraints: [],
      parameters: Object.entries(pairwiseModel.parameters).map(([name, values]) => ({ name, values, evidence: "登录页面原型" })),
      modelPath: "runtime/pairwise/pict-model.json",
      modelDigest: sha256(JSON.stringify(pairwiseModel)),
      dataIds: ["D01", "D02", "D03"],
      manualSupplementReason: "无写入动作",
      ...overrides
    });
  };
  const casesText = "# cases\nOP-DEMO-001\n参数化数据 D01、D02、D03\n";
  const missingModel = await problems(asPairwise({ modelPath: "runtime/pairwise/absent.json" }), { casesText, files: baseFiles });
  assert.ok(missingModel.some((message) => message.includes("pairwise 模型不存在")));

  const digestMismatch = await problems(asPairwise({ modelDigest: "0".repeat(64) }), { casesText, files: baseFiles });
  assert.ok(digestMismatch.some((message) => message.includes("模型摘要与 scope.json 不一致")));

  const countMismatch = await problems(asPairwise({ validCombinationCount: 26 }), { casesText, files: baseFiles });
  assert.ok(countMismatch.some((message) => message.includes("有效组合数与 scope.json 不一致")));

  const dataIdMismatch = await problems(asPairwise({ dataIds: ["D01", "D02", "D04"] }), { casesText, files: baseFiles });
  assert.ok(dataIdMismatch.some((message) => message.includes("D 编号未与生成结果一致")));

  const notGrounded = await problems(asPairwise(), { casesText: "# cases\nOP-DEMO-001\n未引用任何数据编号\n", files: baseFiles });
  assert.ok(notGrounded.some((message) => message.includes("未落入 cases.md")));
});

test("约束缩减组合后的有效组合数与模型重放一致才通过", async () => {
  const constrainedModel = {
    parameters: pairwiseModel.parameters,
    exclude: [["登录方式=短信验证码", "凭证有效性=无效"]]
  };
  const directory = await writeFixture(validScope(), {
    files: { "runtime/pairwise/pict-model.json": JSON.stringify(constrainedModel) }
  });
  try {
    const { spawnSync } = await import("node:child_process");
    const generated = JSON.parse(spawnSync(process.execPath,
      ["skills/testcase-designer/scripts/pict-pairwise.mjs", "--model", path.join(directory, "runtime/pairwise/pict-model.json"), "--format", "json"],
      { cwd: root, encoding: "utf8" }).stdout);
    assert.ok(generated.statistics.validCombos < 27);
    const dataIds = generated.rows.map((_, index) => `D${String(index + 1).padStart(2, "0")}`);
    await fs.writeFile(path.join(directory, "cases.md"), `# cases\nOP-DEMO-001\n参数化数据 ${dataIds.join("、")}\n`, "utf8");
    const scope = validScope();
    scope.categories[0].objects[0].combinationDesign = combinationDesign({
      strategy: "pairwise",
      rationale: "约束过滤后仍超过 12 条",
      validCombinationCount: generated.statistics.validCombos,
      constraints: ["短信登录不校验无效凭证"],
      parameters: Object.entries(pairwiseModel.parameters).map(([name, values]) => ({ name, values, evidence: "登录页面原型" })),
      modelPath: "runtime/pairwise/pict-model.json",
      modelDigest: sha256(JSON.stringify(constrainedModel)),
      dataIds,
      manualSupplementReason: "无写入动作"
    });
    await fs.writeFile(path.join(directory, "scope.json"), JSON.stringify(scope), "utf8");
    const result = await auditPack(directory);
    assert.deepEqual(result.problems, []);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("pairwise 模型参数与 scope.json 不一致时失败", async () => {
  const directory = await fixture(null, { files: { "runtime/pairwise/pict-model.json": JSON.stringify(pairwiseModel) } });
  try {
    const generated = JSON.parse((await import("node:child_process")).spawnSync(process.execPath,
      ["skills/testcase-designer/scripts/pict-pairwise.mjs", "--model", path.join(directory, "runtime/pairwise/pict-model.json"), "--format", "json"],
      { cwd: root, encoding: "utf8" }).stdout);
    const dataIds = generated.rows.map((_, index) => `D${String(index + 1).padStart(2, "0")}`);
    await fs.writeFile(path.join(directory, "cases.md"), `# cases\nOP-DEMO-001\n${dataIds.join(" ")}\n`, "utf8");
    const scope = validScope();
    scope.categories[0].objects[0].combinationDesign = combinationDesign({
      strategy: "pairwise", rationale: "三参数组合", validCombinationCount: 27, constraints: [],
      parameters: Object.entries(pairwiseModel.parameters).map(([name, values]) => ({ name, values: [...values], evidence: "原型" })),
      modelPath: "runtime/pairwise/pict-model.json", modelDigest: sha256(JSON.stringify(pairwiseModel)), dataIds,
      manualSupplementReason: "只读对象"
    });
    scope.categories[0].objects[0].combinationDesign.parameters[0].values.pop();
    await fs.writeFile(path.join(directory, "scope.json"), JSON.stringify(scope), "utf8");
    const result = await auditPack(directory);
    assert.ok(result.problems.some((problem) => problem.message.includes("模型参数或等价类取值")));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("C07 写入对象未补充人工高风险用例失败，人工用例必须落地", async () => {
  const missingSupplement = await problems((scope) => { delete scope.categories[6].objects[0].combinationDesign.manualSupplementCaseIds; });
  assert.ok(missingSupplement.some((message) => message.includes("人工补充的高风险用例")));

  const ghostSupplement = await problems((scope) => {
    scope.categories[6].objects[0].combinationDesign.manualSupplementCaseIds = ["OP-DEMO-404"];
  });
  assert.ok(ghostSupplement.some((message) => message.includes("人工补充用例 OP-DEMO-404 不存在于 cases.md")));
});

test("pairwise 未标注人工补充且无范围外理由失败", async () => {
  const pairwiseDesign = {
    strategy: "pairwise",
    rationale: "3 参数 27 条有效组合",
    validCombinationCount: 13,
    constraints: [],
    parameters: Object.entries(pairwiseModel.parameters).map(([name, values]) => ({ name, values, evidence: "登录页面原型" })),
    modelPath: "runtime/pairwise/pict-model.json",
    modelDigest: sha256(JSON.stringify(pairwiseModel)),
    dataIds: ["D01", "D02"]
  };
  const missing = await problems((scope) => {
    scope.categories[0].objects[0].combinationDesign = { ...pairwiseDesign };
  }, { casesText: "# cases\nOP-DEMO-001\nD01 D02\n" });
  assert.ok(missing.some((message) => message.includes("人工补充")));

  const withReason = await problems((scope) => {
    scope.categories[0].objects[0].combinationDesign = { ...pairwiseDesign, manualSupplementReason: "只读对象，多负向叠加不在范围" };
  }, { casesText: "# cases\nOP-DEMO-001\nD01 D02\n" });
  assert.ok(!withReason.some((message) => message.includes("人工补充")));
});

test("非 testcase-scope 的 schema 一律失败", async () => {
  for (const legacy of ["testcase-scope-legacy", "testcase-scope-v2"]) {
    const invalid = await problems((scope) => { scope.schema = legacy; });
    assert.ok(invalid.some((message) => message.includes(`schema 必须为 ${scopeSchema}`)), legacy);
  }
});
