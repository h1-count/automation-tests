import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { auditPack, validateScope } from "./audit-case-completeness.mjs";

const exportSchema = "testcase-review-export";
const modelSchema = "testcase-review-model";
const receiptSchema = "testcase-review-workbook-receipt";
const sheetNames = ["说明", "范围矩阵", "用例索引", "用例详情"];
const digestPattern = /^[a-f0-9]{64}$/u;

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function required(args, name) {
  const value = option(args, name);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function textOf(value) {
  return typeof value === "string" ? value.trim() : "";
}

const combinationStrategyLabels = {
  not_applicable: "不适用",
  direct_enumeration: "直接枚举",
  pairwise: "Pairwise",
};

/** scope.json combinationDesign 中的 D 编号数组渲染为连续区间（如 D01~D16），不连续则逐个列出。 */
function renderDataIdRange(dataIds) {
  const ids = dataIds.map(textOf).filter(Boolean);
  if (ids.length === 0) return "—";
  const numbers = ids.map((id) => (/^D(\d{2,})$/u.exec(id)?.[1] ? Number(/^D(\d{2,})$/u.exec(id)[1]) : Number.NaN));
  const contiguous = numbers.every((number, index) => Number.isInteger(number) && (index === 0 || number === numbers[index - 1] + 1));
  return contiguous ? `${ids[0]}~${ids[ids.length - 1]}` : ids.join("、");
}

/** 组合策略摘要：审核者在「范围矩阵」即可看到每个对象的策略、组合数、模型来源、D 编号与人工补充。 */
function combinationSummaryCells(object) {
  const design = object?.combinationDesign;
  if (!design || typeof design !== "object" || Array.isArray(design)) return ["—", "—", "—", "—", "—"];
  const strategy = combinationStrategyLabels[design.strategy] ?? (textOf(design.strategy) || "—");
  const validCount = Number.isInteger(design.validCombinationCount) ? String(design.validCombinationCount) : "—";
  const model = design.strategy === "pairwise" && textOf(design.modelPath) ? design.modelPath : "—";
  const dataIds = Array.isArray(design.dataIds) && design.dataIds.length > 0 ? renderDataIdRange(design.dataIds) : "—";
  const manualIds = Array.isArray(design.manualSupplementCaseIds) ? design.manualSupplementCaseIds.map(textOf).filter(Boolean) : [];
  const manual = manualIds.length > 0
    ? manualIds.join("、")
    : textOf(design.manualSupplementReason) ? `范围外：${textOf(design.manualSupplementReason)}` : "—";
  return [strategy, validCount, model, dataIds, manual];
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical JSON does not support non-finite numbers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    ).join(",")}}`;
  }
  throw new Error(`Canonical JSON does not support ${typeof value}.`);
}

function validateExport(value, scope) {
  if (!value || typeof value !== "object" || value.schema !== exportSchema) {
    throw new Error(`Review export schema must be ${exportSchema}.`);
  }
  const { model } = value;
  if (!model || model.schema !== modelSchema || model.formatVersion !== "testcase-layered") {
    throw new Error("Review export must contain a testcase-layered review model.");
  }
  for (const [label, digest] of [
    ["modelDigest", value.modelDigest],
    ["callbackSubjectDigest", value.callbackSubjectDigest],
    ["semanticDigest", value.semanticDigest],
    ["contentDigest", value.contentDigest],
    ["bindingDigest", value.bindingDigest],
  ]) {
    if (!digestPattern.test(digest ?? "")) throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  if (sha256(canonicalJson(model)) !== value.modelDigest) {
    throw new Error("Review export modelDigest does not match its model.");
  }
  if (
    model.callbackSubjectDigest !== value.callbackSubjectDigest
    || model.semanticDigest !== value.semanticDigest
    || model.contentDigest !== value.contentDigest
    || model.bindingDigest !== value.bindingDigest
  ) {
    throw new Error("Review export digests do not match its model.");
  }
  if (!Array.isArray(model.indexRows) || model.indexRows.length === 0) {
    throw new Error("Review model must contain at least one testcase.");
  }
  if (!Array.isArray(model.modules) || model.modules.length === 0) {
    throw new Error("Review model must contain at least one module.");
  }
  const cases = model.modules.flatMap((module) => module.cases ?? []);
  if (cases.length !== model.indexRows.length) {
    throw new Error("Review model module cases do not match index rows.");
  }
  if (cases.some((testcase) => !testcase.executionRows?.length)) {
    throw new Error("Every review model testcase must contain execution rows.");
  }
  if (!digestPattern.test(value.scopeDigest ?? "") || value.scopeDigest !== model.scopeDigest) {
    throw new Error("Review export must contain a matching scopeDigest.");
  }
  if (!Array.isArray(model.scopeMatrix) || model.scopeMatrix.length !== 7) {
    throw new Error("Review model must contain the seven-category scopeMatrix.");
  }
  if (scope) {
    const scopeDigest = sha256(canonicalJson(scope));
    if (scopeDigest !== value.scopeDigest) throw new Error("Review export scopeDigest does not match --scope.");
    if (JSON.stringify(model.scopeMatrix) !== JSON.stringify(scope.categories)) {
      throw new Error("Review model scopeMatrix does not match --scope.");
    }
    const scopeProblems = validateScope(scope, new Set(model.indexRows.map((row) => row.caseId)));
    if (scopeProblems.problems.length) {
      throw new Error(`Scope completeness failed: ${scopeProblems.problems.map((item) => `[${item.category}] ${item.message}`).join("；")}`);
    }
  }
  return value;
}

export function buildWorkbookLayout(exported) {
  const { model } = validateExport(exported);
  const scopeRowCount = model.scopeMatrix.reduce((total, category) => total + category.objects.length, 0);
  const indexLastRow = model.indexRows.length + 1;
  let detailRow = 2;
  const merges = [];
  for (const module of model.modules) {
    const moduleStart = detailRow;
    for (const testcase of module.cases) {
      const caseStart = detailRow;
      const caseEnd = caseStart + testcase.executionRows.length - 1;
      if (caseEnd > caseStart) {
        for (const column of ["B", "C", "D", "E", "F"]) {
          merges.push({ kind: "case", range: `${column}${caseStart}:${column}${caseEnd}` });
        }
      }
      let groupStart = caseStart;
      let activeDataId = testcase.executionRows[0].dataId ?? "—";
      testcase.executionRows.forEach((executionRow, index) => {
        const currentDataId = executionRow.dataId ?? "—";
        const absoluteRow = caseStart + index;
        if (currentDataId !== activeDataId) {
          if (absoluteRow - 1 > groupStart) {
            merges.push({ kind: "data", range: `G${groupStart}:G${absoluteRow - 1}` });
          }
          groupStart = absoluteRow;
          activeDataId = currentDataId;
        }
      });
      if (caseEnd > groupStart) merges.push({ kind: "data", range: `G${groupStart}:G${caseEnd}` });
      detailRow = caseEnd + 1;
    }
    const moduleEnd = detailRow - 1;
    if (moduleEnd > moduleStart) {
      merges.push({ kind: "module", range: `A${moduleStart}:A${moduleEnd}` });
    }
  }
  return {
    title: model.title,
    scopeLastRow: scopeRowCount + 1,
    indexLastRow,
    detailLastRow: detailRow - 1,
    statisticsFormulas: [
      `=COUNTA('用例索引'!B2:B${indexLastRow})`,
      `=COUNTIF('用例索引'!D2:D${indexLastRow},"P0")`,
      `=COUNTIF('用例索引'!E2:E${indexLastRow},"高")`,
    ],
    statistics: {
      moduleCount: model.modules.length,
      caseCount: model.indexRows.length,
      executionRowCount: detailRow - 2,
    },
    merges,
  };
}

function executionRowHeight(executionRow) {
  const lineCounts = [
    Math.ceil((executionRow.action?.length ?? 0) / 30),
    Math.ceil((executionRow.data?.length ?? 0) / 30),
    Math.ceil((executionRow.expected?.length ?? 0) / 42),
  ];
  return Math.min(110, Math.max(38, Math.max(...lineCounts) * 18 + 10));
}

async function writeJsonAtomic(target, value) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, target);
}

function cellFormulaText(cell) {
  const value = cell ? cell.value : null;
  if (value && typeof value === "object" && typeof value.formula === "string") {
    return `=${value.formula}`;
  }
  if (typeof value === "string" && value.startsWith("=")) return value;
  return "";
}

/** 确定性公式审计：替代原表格运行时的渲染错误扫描（§4.3「公式错误数」）。 */
function auditStatisticsFormulas(model, layout, formulaCells) {
  const errors = [];
  const expectedFormulas = layout.statisticsFormulas;
  if (formulaCells.length !== expectedFormulas.length) {
    errors.push(`统计公式单元格数量不一致：${formulaCells.length} vs ${expectedFormulas.length}。`);
  }
  formulaCells.forEach((cell, index) => {
    const actual = cellFormulaText(cell);
    if (actual !== expectedFormulas[index]) {
      errors.push(`统计公式第 ${index + 1} 项与确定性生成结果不一致：${actual || "(缺失)"}`);
    }
  });
  const indexRows = model.indexRows;
  const recomputed = {
    caseCount: indexRows.filter((row) => row.caseId && row.caseId.trim()).length,
    p0Count: indexRows.filter((row) => row.priority === "P0").length,
    highRiskCount: indexRows.filter((row) => row.risk === "高").length,
  };
  if (recomputed.caseCount !== indexRows.length) {
    errors.push("用例索引存在空用例编号，COUNTA 统计口径不成立。");
  }
  if (indexRows.some((row) => !row.priority || !row.risk)) {
    errors.push("用例索引存在空优先级或空风险，COUNTIF 统计口径不成立。");
  }
  if (recomputed.p0Count !== model.statistics.p0Count) {
    errors.push(`P0 统计与模型不一致：公式口径 ${recomputed.p0Count}，模型 ${model.statistics.p0Count}。`);
  }
  if (recomputed.highRiskCount !== model.statistics.highRiskCount) {
    errors.push(`高风险统计与模型不一致：公式口径 ${recomputed.highRiskCount}，模型 ${model.statistics.highRiskCount}。`);
  }
  return errors;
}

/** 从落盘后的工作簿生成逐表确定性文本预览（发布边界摘要校验的输入）。 */
function renderSheetPreview(sheet) {
  const lines = [`# ${sheet.name} · 确定性文本预览`, `# 行数：${sheet.rowCount}`];
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const cells = [];
    for (let columnNumber = 1; columnNumber <= row.cellCount; columnNumber += 1) {
      const cell = row.getCell(columnNumber);
      const formula = cellFormulaText(cell);
      if (formula) {
        cells.push(formula);
      } else {
        const value = cell.value;
        const text = value === null || value === undefined
          ? ""
          : String(value).replace(/\r?\n/gu, "\\n");
        cells.push(text);
      }
    }
    while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
    lines.push(`${rowNumber}\t${cells.join("\t")}`);
  }
  return `${lines.join("\n")}\n`;
}

function assertCachedWorkbookBody(workbook, exported, layout) {
  const scope = workbook.getWorksheet("范围矩阵");
  const index = workbook.getWorksheet("用例索引");
  const detail = workbook.getWorksheet("用例详情");
  if (scope.rowCount !== layout.scopeLastRow || index.rowCount !== layout.indexLastRow || detail.rowCount !== layout.detailLastRow) {
    throw new Error("Cached workbook body does not match the current review content.");
  }
  exported.model.indexRows.forEach((expected, offset) => {
    const row = index.getRow(offset + 2);
    const actual = [row.getCell(1).value, row.getCell(2).value, row.getCell(3).value, row.getCell(4).value, row.getCell(5).value];
    if (JSON.stringify(actual) !== JSON.stringify([expected.module, expected.caseId, expected.title, expected.priority, expected.risk])) {
      throw new Error(`Cached workbook index row ${offset + 2} differs from the current review content.`);
    }
  });
  let rowNumber = 2;
  for (const module of exported.model.modules) {
    for (const testcase of module.cases) {
      testcase.executionRows.forEach((execution, indexInCase) => {
        const row = detail.getRow(rowNumber + indexInCase);
        if (indexInCase === 0 && (String(row.getCell(2).value ?? "").split("\n")[0] !== testcase.caseId
          || String(row.getCell(3).value ?? "") !== testcase.priority || String(row.getCell(4).value ?? "") !== testcase.risk)) {
          throw new Error(`Cached workbook testcase header differs for ${testcase.caseId}.`);
        }
        const expectedAction = `${execution.stepIndex}. ${execution.action}`;
        if (String(row.getCell(8).value ?? "") !== expectedAction
          || String(row.getCell(9).value ?? "") !== execution.data || String(row.getCell(10).value ?? "") !== execution.expected) {
          throw new Error(`Cached workbook execution row differs for ${testcase.caseId}.`);
        }
      });
      rowNumber += testcase.executionRows.length;
    }
  }
  const expectedMerges = layout.merges.map((item) => item.range).sort();
  const actualMerges = [...detail.model.merges].sort();
  if (JSON.stringify(actualMerges) !== JSON.stringify(expectedMerges)) {
    throw new Error("Cached workbook merge ranges differ from the current review layout.");
  }
}

async function createWorkbook(exported, outputPath, previewDir, receiptPath) {
  const exceljsModule = await import("exceljs");
  const ExcelJS = exceljsModule.default ?? exceljsModule;
  const { model } = exported;
  const layout = buildWorkbookLayout(exported);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "automation-tests 用例评审工作簿";
  const colors = {
    navy: "FF16324F",
    teal: "FF0F766E",
    paleBlue: "FFEAF2F8",
    paleTeal: "FFE8F5F2",
    paleYellow: "FFFFF4CC",
    paleRed: "FFFDECEC",
    gray: "FFF3F5F7",
    line: "FFCBD5E1",
    text: "FF1F2937",
    muted: "FF64748B",
    white: "FFFFFFFF",
  };
  const font = { name: "Microsoft YaHei", size: 10, color: { argb: colors.text } };
  const border = {
    top: { style: "thin", color: { argb: colors.line } },
    left: { style: "thin", color: { argb: colors.line } },
    bottom: { style: "thin", color: { argb: colors.line } },
    right: { style: "thin", color: { argb: colors.line } },
  };
  const mediumNavy = { style: "medium", color: { argb: colors.navy } };

  const styleHeader = (row, fill) => {
    row.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      cell.font = { ...font, bold: true, color: { argb: colors.white } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = border;
    });
    row.height = 28;
  };
  const styleBody = (row) => {
    row.eachCell((cell) => {
      cell.font = font;
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.border = border;
    });
  };
  const setWidths = (sheet, widths) => {
    widths.forEach((width, index) => {
      sheet.getColumn(index + 1).width = width;
    });
  };

  const infoSheet = workbook.addWorksheet(sheetNames[0]);
  const scopeSheet = workbook.addWorksheet(sheetNames[1]);
  const indexSheet = workbook.addWorksheet(sheetNames[2]);
  const detailSheet = workbook.addWorksheet(sheetNames[3]);

  // 说明
  infoSheet.columns = [{ width: 18 }, { width: 76 }, { width: 16 }, { width: 16 }, { width: 16 }];
  const titleRow = infoSheet.addRow([`${model.title} · 只读评审版`]);
  infoSheet.mergeCells(titleRow.number, 1, titleRow.number, 5);
  const titleCell = titleRow.getCell(1);
  titleCell.font = { name: "Microsoft YaHei", size: 16, bold: true, color: { argb: colors.white } };
  titleCell.alignment = { horizontal: "left", vertical: "middle" };
  for (let column = 1; column <= 5; column += 1) {
    titleRow.getCell(column).fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.navy } };
  }
  titleRow.height = 34;
  const noteRow = infoSheet.addRow([
    "只读评审版，以 cases.md 为准；请勿将本文件中的人工修改导回正式用例。"
  ]);
  infoSheet.mergeCells(noteRow.number, 1, noteRow.number, 5);
  const noteCell = noteRow.getCell(1);
  noteCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.paleYellow } };
  noteCell.font = { ...font, bold: true, color: { argb: "FF7C5700" } };
  noteCell.alignment = { wrapText: true, vertical: "middle" };
  noteRow.height = 30;
  infoSheet.addRow([]);
  const metaRows = [
    ["请求编号", model.requestId],
    ["格式版本", model.formatVersion],
    ["测试类型", model.defaults.testType],
    ["默认环境", model.defaults.environment],
    ["默认数据策略", model.defaults.dataStrategy],
    ["确认摘要", model.callbackSubjectDigest],
    ["用例语义摘要", model.semanticDigest],
    ["内容摘要", model.contentDigest],
    ["本轮绑定摘要", model.bindingDigest],
    ["范围契约摘要", model.scopeDigest],
  ];
  metaRows.forEach(([label, value]) => {
    const row = infoSheet.addRow([label, value]);
    row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.gray } };
    row.getCell(1).font = { ...font, bold: true };
    row.getCell(1).border = border;
    row.getCell(2).font = font;
    row.getCell(2).alignment = { wrapText: true, vertical: "middle" };
    row.getCell(2).border = border;
  });
  infoSheet.addRow([]);
  const statsHeader = infoSheet.addRow(["统计项", "当前值"]);
  styleHeader(statsHeader, colors.teal);
  const statisticsLabels = ["用例总数", "P0 用例", "高风险用例"];
  const statsRows = infoSheet.addRows(layout.statisticsFormulas.map((formula, index) => [
    statisticsLabels[index],
    { formula: formula.slice(1) },
  ]));
  statsRows.forEach((row) => styleBody(row));
  infoSheet.addRow([]);
  const usageRow = infoSheet.addRow([
    "使用方式：先在“用例索引”筛选范围，再进入“用例详情”连续查看模块、用例、步骤和参数数据。"
  ]);
  infoSheet.mergeCells(usageRow.number, 1, usageRow.number, 5);
  const usageCell = usageRow.getCell(1);
  usageCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.paleBlue } };
  usageCell.font = { ...font, color: { argb: colors.navy } };
  usageCell.alignment = { wrapText: true, vertical: "middle" };
  usageRow.height = 30;
  const legendRow = infoSheet.addRow([
    "颜色说明：索引斑马纹只用于阅读；P0 在优先级列标绿，高风险在风险列标红。"
  ]);
  infoSheet.mergeCells(legendRow.number, 1, legendRow.number, 5);
  const legendCell = legendRow.getCell(1);
  legendCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.gray } };
  legendCell.font = { ...font, color: { argb: colors.muted } };
  legendCell.alignment = { wrapText: true, vertical: "middle" };
  legendRow.height = 30;
  infoSheet.views = [{ state: "frozen", ySplit: 2 }];
  infoSheet.properties.showGridLines = false;

  // 范围矩阵：审核者先核对七类对象、资料依据、归宿与组合策略摘要，再审核具体用例步骤。
  const scopeHeader = scopeSheet.addRow([
    "类别", "范围", "对象", "依据", "归宿", "关联用例", "范围外理由",
    "组合策略", "有效组合数", "组合模型", "数据编号", "人工补充",
  ]);
  styleHeader(scopeHeader, colors.teal);
  for (const category of model.scopeMatrix) {
    for (const object of category.objects) {
      const disposition = object.disposition === "covered" ? "已覆盖"
        : object.disposition === "out_of_scope" ? "范围外" : "待定";
      const row = scopeSheet.addRow([
        category.code,
        category.name,
        object.name,
        object.evidence.join("\n"),
        disposition,
        (object.caseIds ?? []).join("、"),
        object.reason ?? "",
        ...combinationSummaryCells(object),
      ]);
      styleBody(row);
      row.height = Math.max(30, Math.min(90, 18 + Math.max(object.evidence.length, 1) * 18));
      if (object.disposition === "out_of_scope") row.getCell(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.paleYellow } };
      if (object.disposition === "pending") row.getCell(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.paleRed } };
      if (object.combinationDesign?.strategy === "pairwise") {
        row.getCell(8).fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.paleBlue } };
        row.getCell(8).font = { ...font, bold: true, color: { argb: colors.navy } };
      }
    }
  }
  scopeSheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: layout.scopeLastRow, column: 12 } };
  setWidths(scopeSheet, [10, 24, 32, 52, 12, 32, 48, 14, 12, 34, 20, 30]);
  scopeSheet.views = [{ state: "frozen", ySplit: 1 }];
  scopeSheet.properties.showGridLines = false;

  // 用例索引
  const indexHeader = indexSheet.addRow(["模块", "用例编号", "用例标题", "优先级", "风险"]);
  styleHeader(indexHeader, colors.navy);
  model.indexRows.forEach((entry, position) => {
    const row = indexSheet.addRow([entry.module, entry.caseId, entry.title, entry.priority, entry.risk]);
    styleBody(row);
    row.height = 25;
    row.getCell(4).alignment = { horizontal: "center", vertical: "middle" };
    row.getCell(5).alignment = { horizontal: "center", vertical: "middle" };
    if (position % 2 === 1) {
      for (let column = 1; column <= 5; column += 1) {
        row.getCell(column).fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.gray } };
      }
    }
    if (entry.priority === "P0") {
      row.getCell(4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.paleTeal } };
      row.getCell(4).font = { ...font, bold: true, color: { argb: colors.teal } };
    }
    if (entry.risk === "高") {
      row.getCell(5).fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.paleRed } };
      row.getCell(5).font = { ...font, bold: true, color: { argb: "FF991B1B" } };
    }
  });
  indexSheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: layout.indexLastRow, column: 5 } };
  setWidths(indexSheet, [22, 24, 46, 12, 12]);
  indexSheet.views = [{ state: "frozen", ySplit: 1 }];
  indexSheet.properties.showGridLines = false;

  // 用例详情
  const detailHeader = detailSheet.addRow([
    "模块", "用例", "优先级", "风险", "RULE / 差异", "前置条件", "数据编号", "步骤 / 操作", "测试数据", "预期结果",
  ]);
  styleHeader(detailHeader, colors.navy);
  let detailRow = 2;
  for (const module of model.modules) {
    const moduleStart = detailRow;
    for (const testcase of module.cases) {
      const caseStart = detailRow;
      const caseEnd = caseStart + testcase.executionRows.length - 1;
      const governance = testcase.differences.length
        ? `${testcase.ruleIds.join("、")}\n差异：${testcase.differences.join("；")}`
        : testcase.ruleIds.join("、");
      let previousDataId;
      testcase.executionRows.forEach((executionRow, index) => {
        const dataId = executionRow.dataId ?? "—";
        const startsDataGroup = dataId !== previousDataId;
        previousDataId = dataId;
        const row = detailSheet.addRow([
          index === 0 && caseStart === moduleStart ? module.name : null,
          index === 0 ? `${testcase.caseId}\n${testcase.title}` : null,
          index === 0 ? testcase.priority : null,
          index === 0 ? testcase.risk : null,
          index === 0 ? governance : null,
          index === 0 ? testcase.preconditions : null,
          startsDataGroup ? dataId : null,
          `${executionRow.stepIndex}. ${executionRow.action}`,
          executionRow.data,
          executionRow.expected,
        ]);
        styleBody(row);
        row.getCell(7).alignment = { horizontal: "center", vertical: "middle" };
        for (const column of [8, 9, 10]) {
          row.getCell(column).alignment = { horizontal: "left", vertical: "top", wrapText: true };
        }
        row.height = executionRowHeight(executionRow);
      });
      for (const column of [2, 3, 4, 5, 6]) {
        if (caseEnd > caseStart) detailSheet.mergeCells(caseStart, column, caseEnd, column);
      }
      let groupStart = caseStart;
      let activeDataId = testcase.executionRows[0].dataId ?? "—";
      testcase.executionRows.forEach((executionRow, index) => {
        const currentDataId = executionRow.dataId ?? "—";
        const absoluteRow = caseStart + index;
        if (currentDataId !== activeDataId) {
          if (absoluteRow - 1 > groupStart) detailSheet.mergeCells(groupStart, 7, absoluteRow - 1, 7);
          groupStart = absoluteRow;
          activeDataId = currentDataId;
        }
      });
      if (caseEnd > groupStart) detailSheet.mergeCells(groupStart, 7, caseEnd, 7);
      const caseIdentity = (column, fill, bold, color) => {
        for (let row = caseStart; row <= caseEnd; row += 1) {
          const cell = detailSheet.getCell(row, column);
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
          cell.font = { ...font, bold, color: { argb: color } };
        }
      };
      caseIdentity(2, colors.paleBlue, true, colors.navy);
      detailSheet.getCell(caseStart, 2).alignment = { horizontal: "left", vertical: "top", wrapText: true };
      caseIdentity(
        3,
        testcase.priority === "P0" ? colors.paleTeal : colors.gray,
        testcase.priority === "P0",
        testcase.priority === "P0" ? colors.teal : colors.text,
      );
      caseIdentity(
        4,
        testcase.risk === "高" ? colors.paleRed : colors.gray,
        testcase.risk === "高",
        testcase.risk === "高" ? "FF991B1B" : colors.text,
      );
      for (let row = caseStart; row <= caseEnd; row += 1) {
        const ruleCell = detailSheet.getCell(row, 5);
        ruleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.gray } };
        ruleCell.font = { ...font, color: { argb: colors.muted } };
        ruleCell.alignment = { vertical: "top", wrapText: true };
        const preCell = detailSheet.getCell(row, 6);
        preCell.alignment = { vertical: "top", wrapText: true };
      }
      for (let column = 1; column <= 10; column += 1) {
        detailSheet.getCell(caseStart, column).border = { ...border, top: mediumNavy };
      }
      detailRow = caseEnd + 1;
    }
    const moduleEnd = detailRow - 1;
    if (moduleEnd > moduleStart) detailSheet.mergeCells(moduleStart, 1, moduleEnd, 1);
    for (let row = moduleStart; row <= moduleEnd; row += 1) {
      const cell = detailSheet.getCell(row, 1);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.navy } };
      cell.font = { name: "Microsoft YaHei", size: 12, bold: true, color: { argb: colors.white } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    }
    for (let column = 1; column <= 10; column += 1) {
      detailSheet.getCell(moduleEnd, column).border = { ...border, bottom: mediumNavy };
    }
  }
  setWidths(detailSheet, [21, 31, 10, 10, 26, 32, 11, 34, 30, 44]);
  detailSheet.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];
  detailSheet.properties.showGridLines = false;

  // 写入前公式审计：统计公式必须与确定性生成结果和模型统计一致。
  const formulaCells = statsRows.map((row) => row.getCell(2));
  const formulaAuditErrors = auditStatisticsFormulas(model, layout, formulaCells);
  if (formulaAuditErrors.length > 0) {
    throw new Error(`Workbook formula audit failed: ${formulaAuditErrors.join("；")}`);
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await workbook.xlsx.writeFile(outputPath);

  // 落盘后关键区域复核：从真实文件字节重新读取，校验工作表、行数与首行内容。
  const reread = new ExcelJS.Workbook();
  await reread.xlsx.readFile(outputPath);
  for (const sheetName of sheetNames) {
    const sheet = reread.getWorksheet(sheetName);
    if (!sheet) throw new Error(`Workbook inspection is missing sheet ${sheetName}.`);
    if (!sheet.rowCount || sheet.rowCount < 1) throw new Error(`Workbook sheet ${sheetName} is empty.`);
  }
  const rereadInfo = reread.getWorksheet(sheetNames[0]);
  const rereadTitle = rereadInfo.getCell(1, 1).value;
  if (rereadTitle !== `${model.title} · 只读评审版`) {
    throw new Error(`Workbook title region mismatch: ${String(rereadTitle)}`);
  }
  const rereadScope = reread.getWorksheet(sheetNames[1]);
  const expectedScopeHeader = [
    "类别", "范围", "对象", "依据", "归宿", "关联用例", "范围外理由",
    "组合策略", "有效组合数", "组合模型", "数据编号", "人工补充",
  ];
  const rereadScopeHeader = [];
  for (let column = 1; column <= expectedScopeHeader.length; column += 1) {
    rereadScopeHeader.push(rereadScope.getCell(1, column).value);
  }
  if (rereadScope.rowCount !== layout.scopeLastRow || JSON.stringify(rereadScopeHeader) !== JSON.stringify(expectedScopeHeader)) {
    throw new Error("Workbook scope matrix mismatch.");
  }
  const rereadIndex = reread.getWorksheet(sheetNames[2]);
  if (rereadIndex.rowCount !== layout.indexLastRow) {
    throw new Error(`Workbook index row count mismatch: ${rereadIndex.rowCount} vs ${layout.indexLastRow}.`);
  }
  const firstIndexRow = model.indexRows[0];
  if (
    rereadIndex.getCell(2, 1).value !== firstIndexRow.module
    || rereadIndex.getCell(2, 2).value !== firstIndexRow.caseId
    || rereadIndex.getCell(2, 3).value !== firstIndexRow.title
  ) {
    throw new Error("Workbook index first data row mismatch.");
  }
  const rereadDetail = reread.getWorksheet(sheetNames[3]);
  if (rereadDetail.rowCount !== layout.detailLastRow) {
    throw new Error(`Workbook detail row count mismatch: ${rereadDetail.rowCount} vs ${layout.detailLastRow}.`);
  }
  const detailHeaderCells = [];
  for (let column = 1; column <= 10; column += 1) {
    detailHeaderCells.push(rereadDetail.getCell(1, column).value);
  }
  const expectedDetailHeader = [
    "模块", "用例", "优先级", "风险", "RULE / 差异", "前置条件", "数据编号", "步骤 / 操作", "测试数据", "预期结果",
  ];
  if (JSON.stringify(detailHeaderCells) !== JSON.stringify(expectedDetailHeader)) {
    throw new Error("Workbook detail header mismatch.");
  }
  const firstCase = model.modules[0].cases[0];
  const firstExecutionText = `${firstCase.executionRows[0].stepIndex}. ${firstCase.executionRows[0].action}`;
  if (rereadDetail.getCell(2, 8).value !== firstExecutionText) {
    throw new Error("Workbook detail first execution row mismatch.");
  }
  const rereadFormulaAudit = auditStatisticsFormulas(model, layout, [
    rereadInfo.getCell(16, 2),
    rereadInfo.getCell(17, 2),
    rereadInfo.getCell(18, 2),
  ]);
  if (rereadFormulaAudit.length > 0) {
    throw new Error(`Workbook formula audit failed after write: ${rereadFormulaAudit.join("；")}`);
  }

  // 逐表确定性文本预览：从落盘文件派生，作为发布边界摘要校验的输入。
  await fs.rm(previewDir, { recursive: true, force: true });
  await fs.mkdir(previewDir, { recursive: true });
  const previews = [];
  for (const sheetName of sheetNames) {
    const sheet = reread.getWorksheet(sheetName);
    const previewText = renderSheetPreview(sheet);
    if (!previewText.trim()) throw new Error(`Workbook preview is empty for ${sheetName}.`);
    const previewPath = path.join(previewDir, `${sheetName}.md`);
    await fs.writeFile(previewPath, previewText, "utf8");
    previews.push({
      sheet: sheetName,
      path: path.relative(path.dirname(receiptPath), previewPath),
      sha256: sha256(previewText),
    });
  }

  const workbookBytes = await fs.readFile(outputPath);
  const receipt = {
    schema: receiptSchema,
    modelDigest: exported.modelDigest,
    callbackSubjectDigest: exported.callbackSubjectDigest,
    semanticDigest: exported.semanticDigest,
    contentDigest: exported.contentDigest,
    bindingDigest: exported.bindingDigest,
    scopeDigest: exported.scopeDigest,
    workbookSha256: sha256(workbookBytes),
    sheets: sheetNames,
    statistics: layout.statistics,
    formulaErrorCount: 0,
    previews,
  };
  await writeJsonAtomic(receiptPath, receipt);
  return receipt;
}

/** Reuses only the request-independent index/detail workbook body.  Binding
 * metadata and receipt are always regenerated for the current request. */
async function refreshCachedWorkbook(exported, cachedPath, outputPath, previewDir, receiptPath) {
  const exceljsModule = await import("exceljs");
  const ExcelJS = exceljsModule.default ?? exceljsModule;
  const layout = buildWorkbookLayout(exported);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(cachedPath);
  for (const sheetName of sheetNames) {
    if (!workbook.getWorksheet(sheetName)) throw new Error(`Cached workbook is missing ${sheetName}.`);
  }
  assertCachedWorkbookBody(workbook, exported, layout);
  const info = workbook.getWorksheet("说明");
  info.getCell(4, 2).value = exported.model.requestId;
  info.getCell(9, 2).value = exported.callbackSubjectDigest;
  info.getCell(10, 2).value = exported.semanticDigest;
  info.getCell(11, 2).value = exported.contentDigest;
  info.getCell(12, 2).value = exported.bindingDigest;
  info.getCell(13, 2).value = exported.scopeDigest;
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await workbook.xlsx.writeFile(outputPath);
  const reread = new ExcelJS.Workbook();
  await reread.xlsx.readFile(outputPath);
  const formulas = auditStatisticsFormulas(exported.model, layout, [
    reread.getWorksheet("说明").getCell(16, 2),
    reread.getWorksheet("说明").getCell(17, 2),
    reread.getWorksheet("说明").getCell(18, 2),
  ]);
  if (formulas.length) throw new Error(`Cached workbook formula audit failed: ${formulas.join("；")}`);
  await fs.rm(previewDir, { recursive: true, force: true });
  await fs.mkdir(previewDir, { recursive: true });
  const previews = [];
  for (const sheetName of sheetNames) {
    const text = renderSheetPreview(reread.getWorksheet(sheetName));
    const previewPath = path.join(previewDir, `${sheetName}.md`);
    await fs.writeFile(previewPath, text, "utf8");
    previews.push({ sheet: sheetName, path: path.relative(path.dirname(receiptPath), previewPath), sha256: sha256(text) });
  }
  const receipt = {
    schema: receiptSchema,
    modelDigest: exported.modelDigest,
    callbackSubjectDigest: exported.callbackSubjectDigest,
    semanticDigest: exported.semanticDigest,
    contentDigest: exported.contentDigest,
    bindingDigest: exported.bindingDigest,
    scopeDigest: exported.scopeDigest,
    workbookSha256: sha256(await fs.readFile(outputPath)),
    sheets: sheetNames,
    statistics: layout.statistics,
    formulaErrorCount: 0,
    previews,
  };
  await writeJsonAtomic(receiptPath, receipt);
  return receipt;
}

async function main() {
  const args = process.argv.slice(2);
  const modelPath = required(args, "--model");
  const scopePath = required(args, "--scope");
  const scope = JSON.parse(await fs.readFile(scopePath, "utf8"));
  // scope.json 位于功能包时，导出前重放 Pairwise 模型；临时纯模型文件仍可做结构预览。
  const packDirectory = path.dirname(scopePath);
  if (await fs.access(path.join(packDirectory, "cases.md")).then(() => true).catch(() => false)) {
    const audit = await auditPack(packDirectory);
    if (audit.problems.length > 0) {
      throw new Error(`Scope completeness failed: ${audit.problems.map((item) => `[${item.category}] ${item.object}：${item.message}`).join("；")}`);
    }
  }
  const exported = validateExport(JSON.parse(await fs.readFile(modelPath, "utf8")), scope);
  const layout = buildWorkbookLayout(exported);
  if (args.includes("--validate-only")) {
    process.stdout.write(`${JSON.stringify(layout)}\n`);
    return;
  }
  const outputPath = path.resolve(required(args, "--output"));
  const previewDir = path.resolve(required(args, "--preview-dir"));
  const receiptPath = path.resolve(required(args, "--receipt"));
  const cachedPath = option(args, "--reuse-workbook");
  const receipt = cachedPath
    ? await refreshCachedWorkbook(exported, path.resolve(cachedPath), outputPath, previewDir, receiptPath)
    : await createWorkbook(exported, outputPath, previewDir, receiptPath);
  process.stdout.write(`${JSON.stringify({ outputPath, receiptPath, ...receipt })}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
