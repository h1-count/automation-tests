import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const codes = ["C01", "C02", "C03", "C04", "C05", "C06", "C07"];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function canonicalJson(value) {
  if (value === null || ["boolean", "string", "number"].includes(typeof value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

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

const pairwiseDesign = () => combinationDesign({
  strategy: "pairwise",
  rationale: "3 参数 27 条有效组合，pairwise 压缩",
  validCombinationCount: 27,
  constraints: ["短信登录不出现密码框"],
  parameters: [
    { name: "登录方式", values: ["账号密码", "短信验证码", "扫码"], evidence: "登录页面原型" },
    { name: "凭证有效性", values: ["有效", "无效", "过期"], evidence: "需求第 2 节" },
    { name: "协议勾选", values: ["已勾选", "未勾选", "半选"], evidence: "注册页面源码" }
  ],
  modelPath: "runtime/pairwise/pict-model.json",
  modelDigest: "a".repeat(64),
  dataIds: ["D01", "D02", "D03", "D04"],
  manualSupplementReason: "只读对象，多负向叠加不在范围"
});

function buildScope({ disposition = "covered", schema = "testcase-scope", withDesign = true } = {}) {
  return {
    schema,
    categories: codes.map((code) => {
      const object = {
        id: `${code.toLowerCase()}-object`, name: `${code} 对象`, evidence: ["需求说明"], disposition,
        ...(disposition === "covered" ? { caseIds: ["OP-DEMO-001"] } : {})
      };
      if (withDesign && schema === "testcase-scope") {
        object.combinationDesign = code === "C01"
          ? pairwiseDesign()
          : combinationDesign(code === "C07" && disposition === "covered" ? { manualSupplementCaseIds: ["OP-DEMO-001"] } : {});
      }
      return { code, name: code, objects: [object] };
    })
  };
}

function buildExport(scope) {
  const scopeDigest = sha256(canonicalJson(scope));
  const testcase = {
    module: "演示", caseId: "OP-DEMO-001", title: "范围矩阵导出", priority: "P0", risk: "低", ruleIds: [],
    preconditions: "无", environment: "test", dataStrategy: "no_write", sourceRefs: [], differences: [],
    executionRows: [{ stepIndex: 1, action: "打开页面", data: "无", expected: "页面可见" }]
  };
  const modules = [{ name: "演示", cases: [testcase] }];
  const selectedCaseIds = [testcase.caseId];
  const model = {
    schema: "testcase-review-model", requestId: "demo", title: "范围矩阵测试", formatVersion: "testcase-layered",
    scopeDigest, scopeMatrix: scope.categories, callbackSubjectDigest: sha256(`cases\n${scopeDigest}`), selectedCaseIds,
    semanticDigest: sha256(canonicalJson({ selectedCaseIds, modules, scopeMatrix: scope.categories })),
    contentDigest: sha256(canonicalJson({ title: "范围矩阵测试", modules, scopeMatrix: scope.categories })), bindingDigest: sha256("demo"),
    defaults: { testType: "Web", environment: "test", dataStrategy: "no_write" },
    statistics: { caseCount: 1, p0Count: 1, highRiskCount: 0, parameterizedCount: 0 },
    indexRows: [{ module: "演示", caseId: testcase.caseId, title: testcase.title, priority: "P0", risk: "低" }], modules
  };
  return { schema: "testcase-review-export", modelDigest: sha256(canonicalJson(model)), callbackSubjectDigest: model.callbackSubjectDigest,
    semanticDigest: model.semanticDigest, contentDigest: model.contentDigest, bindingDigest: model.bindingDigest, scopeDigest, model };
}

async function run(options) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workbook-scope-"));
  const scope = buildScope(options);
  const model = buildExport(scope);
  const scopePath = path.join(dir, "scope.json");
  const modelPath = path.join(dir, "model.json");
  await Promise.all([fs.writeFile(scopePath, JSON.stringify(scope)), fs.writeFile(modelPath, JSON.stringify(model))]);
  const output = path.join(dir, "review.xlsx");
  const receipt = path.join(dir, "receipt.json");
  const result = spawnSync(process.execPath, ["scripts/build-testcase-review-workbook.mjs", "--model", modelPath, "--scope", scopePath,
    "--output", output, "--preview-dir", path.join(dir, "previews"), "--receipt", receipt], { cwd: root, encoding: "utf8" });
  return { dir, output, receipt, result };
}

test("工作簿含第四张范围矩阵，回执绑定范围摘要", async () => {
  const fixture = await run();
  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(fixture.output);
    assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["说明", "范围矩阵", "用例索引", "用例详情"]);
    const receipt = JSON.parse(await fs.readFile(fixture.receipt, "utf8"));
    assert.equal(receipt.schema, "testcase-review-workbook-receipt");
    assert.match(receipt.scopeDigest, /^[a-f0-9]{64}$/u);
  } finally { await fs.rm(fixture.dir, { recursive: true, force: true }); }
});

test("范围矩阵展示每个对象的组合策略、组合数、模型来源、D 编号与人工补充", async () => {
  const fixture = await run();
  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(fixture.output);
    const scopeSheet = workbook.getWorksheet("范围矩阵");
    const header = Array.from({ length: 12 }, (_, index) => scopeSheet.getRow(1).getCell(index + 1).value);
    assert.deepEqual(header.slice(7), ["组合策略", "有效组合数", "组合模型", "数据编号", "人工补充"]);
    const firstRow = Array.from({ length: 12 }, (_, index) => scopeSheet.getRow(2).getCell(index + 1).value);
    assert.equal(firstRow[7], "Pairwise");
    assert.equal(firstRow[8], "27");
    assert.equal(firstRow[9], "runtime/pairwise/pict-model.json");
    assert.equal(firstRow[10], "D01~D04");
    assert.equal(firstRow[11], "范围外：只读对象，多负向叠加不在范围");
  } finally { await fs.rm(fixture.dir, { recursive: true, force: true }); }
});

test("pending 范围契约阻断工作簿导出", async () => {
  const fixture = await run({ disposition: "pending" });
  try {
    assert.notEqual(fixture.result.status, 0);
    assert.match(fixture.result.stderr, /pending 仅可在设计中暂存/u);
  } finally { await fs.rm(fixture.dir, { recursive: true, force: true }); }
});

test("缺少组合设计阻断工作簿导出", async () => {
  const fixture = await run({ withDesign: false });
  try {
    assert.notEqual(fixture.result.status, 0);
    assert.match(fixture.result.stderr, /combinationDesign/u);
  } finally { await fs.rm(fixture.dir, { recursive: true, force: true }); }
});

test("非 testcase-scope 的范围契约阻断工作簿导出", async () => {
  const fixture = await run({ schema: "testcase-scope-legacy", withDesign: false });
  try {
    assert.notEqual(fixture.result.status, 0);
    assert.match(fixture.result.stderr, /schema 必须为 testcase-scope/u);
  } finally { await fs.rm(fixture.dir, { recursive: true, force: true }); }
});
