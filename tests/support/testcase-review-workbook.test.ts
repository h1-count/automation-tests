import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  assertTestcaseReviewExportCurrent,
  buildTestcaseReviewExport,
  parseTestcaseReviewExport,
  validateTestcaseReviewWorkbookReceipt,
  type TestcaseReviewModel
} from "../../src/support/testcase/testcaseReviewModel.js";

const digest = "a".repeat(64);
const semanticDigest = "b".repeat(64);
const workbookSha256 = "c".repeat(64);
const builderPath = resolve(
  process.cwd(),
  "scripts/build-testcase-review-workbook.mjs"
);

function reviewModel(caseCount: number, firstCaseRows = 1): TestcaseReviewModel {
  const cases = Array.from({ length: caseCount }, (_, index) => {
    const suffix = String(index + 1).padStart(3, "0");
    const executionRows = Array.from(
      { length: index === 0 ? firstCaseRows : 1 },
      (_, rowIndex) => ({
        dataId: index === 0 && firstCaseRows > 1 ? "D01" : undefined,
        stepIndex: String(rowIndex + 1),
        action: `执行动作 ${rowIndex + 1}`,
        data: `测试数据 ${rowIndex + 1}`,
        expected: `预期结果 ${rowIndex + 1}`
      })
    );
    return {
      module: "通用模块",
      caseId: `DEMO-CASE-${suffix}`,
      title: `验证通用场景 ${suffix}`,
      priority: index === 0 ? "P0" : "P1",
      risk: index === 0 ? "高" : "低",
      ruleIds: [`RULE-DEMO-${suffix}`],
      preconditions: "已进入测试页面",
      environment: "test",
      dataStrategy: "no_write",
      sourceRefs: [`SRC-DEMO-${suffix}`],
      differences: [],
      executionRows
    };
  });
  return {
    schema: "testcase-review-model-v1",
    requestId: "web/demo/review-workbook",
    title: "通用评审用例",
    formatVersion: "testcase-v6-layered",
    callbackSubjectDigest: digest,
    semanticDigest,
    defaults: { testType: "Web", environment: "test", dataStrategy: "no_write" },
    statistics: {
      caseCount,
      p0Count: 1,
      highRiskCount: 1,
      parameterizedCount: firstCaseRows > 1 ? 1 : 0
    },
    indexRows: cases.map(({ module, caseId, title, priority, risk }) => ({
      module,
      caseId,
      title,
      priority,
      risk
    })),
    modules: [{ name: "通用模块", cases }]
  };
}

test("review export detects model tampering", () => {
  const exported = buildTestcaseReviewExport(reviewModel(1));
  assert.equal(parseTestcaseReviewExport(exported).modelDigest, exported.modelDigest);
  const tampered = structuredClone(exported);
  tampered.model.title = "被篡改的标题";
  assert.throws(() => parseTestcaseReviewExport(tampered), /modelDigest/u);
});

test("review export currentness detects semantic or callback drift before publication", () => {
  const exported = buildTestcaseReviewExport(reviewModel(1));
  assert.doesNotThrow(() => assertTestcaseReviewExportCurrent(exported, structuredClone(exported)));
  const changed = reviewModel(1);
  changed.modules[0]!.cases[0]!.executionRows[0]!.expected = "发生变化的预期";
  const drifted = buildTestcaseReviewExport(changed);
  assert.throws(() => assertTestcaseReviewExportCurrent(exported, drifted), /stale/u);
});

test("workbook receipt must match digests, counts, sheets, previews, and workbook SHA", () => {
  const exported = buildTestcaseReviewExport(reviewModel(2));
  const receipt = {
    schema: "testcase-review-workbook-receipt-v1",
    modelDigest: exported.modelDigest,
    callbackSubjectDigest: exported.callbackSubjectDigest,
    semanticDigest: exported.semanticDigest,
    workbookSha256,
    sheets: ["说明", "用例索引", "用例详情"],
    statistics: { moduleCount: 1, caseCount: 2, executionRowCount: 2 },
    formulaErrorCount: 0,
    previews: ["说明", "用例索引", "用例详情"].map((sheet) => ({
      sheet,
      path: `${sheet}.png`,
      sha256: createHash("sha256").update(sheet).digest("hex")
    }))
  };
  assert.equal(validateTestcaseReviewWorkbookReceipt({
    receipt,
    exported,
    workbookSha256
  }).statistics.caseCount, 2);
  assert.throws(() => validateTestcaseReviewWorkbookReceipt({
    receipt: { ...receipt, formulaErrorCount: 1 },
    exported,
    workbookSha256
  }), /formula errors/u);
  assert.throws(() => validateTestcaseReviewWorkbookReceipt({
    receipt: { ...receipt, workbookSha256: "d".repeat(64) },
    exported,
    workbookSha256
  }), /SHA-256/u);
  assert.throws(() => validateTestcaseReviewWorkbookReceipt({
    receipt: { ...receipt, sheets: ["说明", "用例索引"] },
    exported,
    workbookSha256
  }), /three required sheets/u);
});

test("workbook builder derives formulas and merge boundaries from any testcase count", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "testcase-review-layout-"));
  try {
    for (const count of [1, 27, 30]) {
      const modelPath = resolve(root, `model-${count}.json`);
      await writeFile(modelPath, JSON.stringify(buildTestcaseReviewExport(
        reviewModel(count, count === 1 ? 2 : 1)
      )), "utf8");
      const result = spawnSync(process.execPath, [
        builderPath,
        "--model",
        modelPath,
        "--validate-only"
      ], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      const layout = JSON.parse(result.stdout) as {
        title: string;
        indexLastRow: number;
        statisticsFormulas: string[];
        merges: Array<{ kind: string; range: string }>;
      };
      assert.equal(layout.title, "通用评审用例");
      assert.equal(layout.indexLastRow, count + 1);
      assert.match(layout.statisticsFormulas[0]!, new RegExp(`B2:B${count + 1}\\)`));
      assert.match(layout.statisticsFormulas[1]!, new RegExp(`D2:D${count + 1},`));
      assert.match(layout.statisticsFormulas[2]!, new RegExp(`E2:E${count + 1},`));
      assert.equal(layout.merges.some((merge) => /^[HIJ]/u.test(merge.range)), false);
      if (count === 1) {
        assert.ok(layout.merges.some((merge) => merge.range === "B2:B3"));
        assert.ok(layout.merges.some((merge) => merge.range === "G2:G3"));
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
