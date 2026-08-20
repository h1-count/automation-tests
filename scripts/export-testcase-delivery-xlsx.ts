import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import type { Row as ExcelRow, Worksheet as ExcelWorksheet } from "exceljs";
import { buildTestcaseReviewModel } from "../src/support/testcase/testcaseReviewModel.js";

/**
 * 用例确认后的交付 Excel 生成器（docs/testing/testcase-guideline.md §7.1）。
 *
 * 从套件 cases.md + design.md 确定性解析（复用评审模型管线），按 §4.3 评审工作簿
 * 的三表版式（说明 / 用例索引 / 用例详情）生成用户侧交付 xlsx。样式仅为阅读辅助，
 * 数据投影与规则列语义必须与评审工作簿保持一致；任何统计不一致都直接失败。
 */

const sheetNames = ["说明", "用例索引", "用例详情"] as const;

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function required(args: string[], name: string): string {
  const value = option(args, name);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

/** cases.md 头部统计行（共 N 条 ｜ P0 n ｜ 高风险 h ｜ 参数化 p）交叉核对。 */
function headerStatistics(casesText: string): {
  caseCount: number;
  p0Count: number;
  highRiskCount: number;
  parameterizedCount: number;
} {
  for (const line of casesText.split(/\r?\n/u)) {
    const match = /^>\s*共\s*(\d+)\s*条\s*｜\s*P0\s*(\d+)\s*条\s*｜\s*高风险\s*(\d+)\s*条\s*｜\s*参数化\s*(\d+)\s*条\s*$/u
      .exec(line.trim());
    if (match) {
      return {
        caseCount: Number(match[1]),
        p0Count: Number(match[2]),
        highRiskCount: Number(match[3]),
        parameterizedCount: Number(match[4])
      };
    }
  }
  throw new Error("cases.md 头部缺少「共 N 条 ｜ P0 … ｜ 高风险 … ｜ 参数化 …」统计行。");
}

interface DeliveryModel {
  title: string;
  requestId: string;
  formatVersion: string;
  defaults: { testType: string; environment: string; dataStrategy: string };
  suitePath: string;
  casesSha256: string;
  semanticDigest: string;
  statistics: { caseCount: number; p0Count: number; highRiskCount: number; parameterizedCount: number };
  indexRows: { module: string; caseId: string; title: string; priority: string; risk: string }[];
  modules: {
    name: string;
    cases: {
      caseId: string;
      title: string;
      priority: string;
      risk: string;
      ruleIds: string[];
      differences: string[];
      preconditions: string;
      executionRows: { dataId?: string; stepIndex: string; action: string; data: string; expected: string }[];
    }[];
  }[];
}

function buildDeliveryModel(input: {
  requestId: string;
  plan: string;
  cases: string;
  casesSha256: string;
  suitePath: string;
}): DeliveryModel {
  const model = buildTestcaseReviewModel({
    requestId: input.requestId,
    plan: input.plan,
    cases: input.cases,
    callbackSubjectDigest: input.casesSha256
  });
  const cases = model.modules.flatMap((module) => module.cases);
  if (cases.length === 0) throw new Error("cases.md 未解析出任何用例。");
  const caseIds = new Set<string>();
  for (const testcase of cases) {
    if (caseIds.has(testcase.caseId)) throw new Error(`用例编号重复：${testcase.caseId}。`);
    caseIds.add(testcase.caseId);
    if (testcase.executionRows.length === 0) {
      throw new Error(`用例 ${testcase.caseId} 没有执行行。`);
    }
  }
  const header = headerStatistics(input.cases);
  const computed = {
    caseCount: model.statistics.caseCount,
    p0Count: model.statistics.p0Count,
    highRiskCount: model.statistics.highRiskCount,
    parameterizedCount: model.statistics.parameterizedCount
  };
  for (const key of Object.keys(header) as (keyof typeof header)[]) {
    if (header[key] !== computed[key]) {
      throw new Error(
        `统计交叉核对失败（${key}）：cases.md 头部声明 ${header[key]}，解析结果 ${computed[key]}。`
      );
    }
  }
  return {
    title: model.title,
    requestId: model.requestId,
    formatVersion: model.formatVersion,
    defaults: model.defaults,
    suitePath: input.suitePath,
    casesSha256: input.casesSha256,
    semanticDigest: model.semanticDigest,
    statistics: computed,
    indexRows: model.indexRows.map((row) => ({ ...row })),
    modules: model.modules.map((module) => ({
      name: module.name,
      cases: module.cases.map((testcase) => ({
        caseId: testcase.caseId,
        title: testcase.title,
        priority: testcase.priority,
        risk: testcase.risk,
        ruleIds: [...testcase.ruleIds],
        differences: [...testcase.differences],
        preconditions: testcase.preconditions,
        executionRows: testcase.executionRows.map((row) => ({
          dataId: row.dataId,
          stepIndex: row.stepIndex,
          action: row.action,
          data: row.data,
          expected: row.expected
        }))
      }))
    }))
  };
}

function executionRowHeight(row: { action: string; data: string; expected: string }): number {
  const lineCounts = [
    Math.ceil((row.action?.length ?? 0) / 30),
    Math.ceil((row.data?.length ?? 0) / 30),
    Math.ceil((row.expected?.length ?? 0) / 42)
  ];
  return Math.min(110, Math.max(38, Math.max(...lineCounts) * 18 + 10));
}

async function createWorkbook(model: DeliveryModel, outputPath: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "automation-tests 交付导出";
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
    white: "FFFFFFFF"
  };
  const font = { name: "Microsoft YaHei", size: 10, color: { argb: colors.text } };
  const border = {
    top: { style: "thin" as const, color: { argb: colors.line } },
    left: { style: "thin" as const, color: { argb: colors.line } },
    bottom: { style: "thin" as const, color: { argb: colors.line } },
    right: { style: "thin" as const, color: { argb: colors.line } }
  };
  const mediumNavy = { style: "medium" as const, color: { argb: colors.navy } };

  const infoSheet = workbook.addWorksheet(sheetNames[0]);
  const indexSheet = workbook.addWorksheet(sheetNames[1]);
  const detailSheet = workbook.addWorksheet(sheetNames[2]);

  const styleHeader = (row: ExcelRow, fill: string) => {
    row.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      cell.font = { ...font, bold: true, color: { argb: colors.white } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = border;
    });
    row.height = 28;
  };
  const styleBody = (row: ExcelRow) => {
    row.eachCell((cell) => {
      cell.font = font;
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.border = border;
    });
  };
  const setWidths = (sheet: ExcelWorksheet, widths: number[]) => {
    widths.forEach((width, index) => {
      sheet.getColumn(index + 1).width = width;
    });
  };

  // 说明
  infoSheet.columns = [{ width: 18 }, { width: 76 }, { width: 16 }, { width: 16 }, { width: 16 }];
  const titleRow = infoSheet.addRow([`${model.title} · 交付版`]);
  infoSheet.mergeCells(titleRow.number, 1, titleRow.number, 5);
  const titleCell = titleRow.getCell(1);
  titleCell.font = { name: "Microsoft YaHei", size: 16, bold: true, color: { argb: colors.white } };
  titleCell.alignment = { horizontal: "left", vertical: "middle" };
  for (let column = 1; column <= 5; column += 1) {
    titleRow.getCell(column).fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.navy } };
  }
  titleRow.height = 34;
  const noteRow = infoSheet.addRow([
    "本表由套件 cases.md 确定性生成，内容以套件 cases.md 为准；人工修改后不得导回正式用例。"
  ]);
  infoSheet.mergeCells(noteRow.number, 1, noteRow.number, 5);
  const noteCell = noteRow.getCell(1);
  noteCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.paleYellow } };
  noteCell.font = { ...font, bold: true, color: { argb: "FF7C5700" } };
  noteCell.alignment = { wrapText: true, vertical: "middle" };
  noteRow.height = 30;
  infoSheet.addRow([]);
  const metaRows: [string, string][] = [
    ["请求编号", model.requestId],
    ["格式版本", model.formatVersion],
    ["测试类型", model.defaults.testType],
    ["默认环境", model.defaults.environment],
    ["默认数据策略", model.defaults.dataStrategy],
    ["套件文件", model.suitePath],
    ["套件摘要（cases.md SHA-256）", model.casesSha256],
    ["用例语义摘要", model.semanticDigest]
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
  const indexLastRow = model.indexRows.length + 1;
  const statsRows = infoSheet.addRows([
    ["用例总数", { formula: `COUNTA('用例索引'!B2:B${indexLastRow})` }],
    ["P0 用例", { formula: `COUNTIF('用例索引'!D2:D${indexLastRow},"P0")` }],
    ["高风险用例", { formula: `COUNTIF('用例索引'!E2:E${indexLastRow},"高")` }]
  ]);
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
  indexSheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: indexLastRow, column: 5 } };
  setWidths(indexSheet, [22, 24, 46, 12, 12]);
  indexSheet.views = [{ state: "frozen", ySplit: 1 }];
  indexSheet.properties.showGridLines = false;

  // 用例详情
  const detailHeader = detailSheet.addRow([
    "模块", "用例", "优先级", "风险", "RULE / 差异", "前置条件", "数据编号", "步骤 / 操作", "测试数据", "预期结果"
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
      let previousDataId: string | undefined;
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
          executionRow.expected
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
      let activeDataId = testcase.executionRows[0]?.dataId ?? "—";
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
      const caseIdentity = (column: number, fill: string, bold: boolean, color: string): void => {
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
        testcase.priority === "P0" ? colors.teal : colors.text
      );
      caseIdentity(
        4,
        testcase.risk === "高" ? colors.paleRed : colors.gray,
        testcase.risk === "高",
        testcase.risk === "高" ? "FF991B1B" : colors.text
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
        detailSheet.getCell(caseStart, column).border = {
          ...border,
          top: mediumNavy
        };
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
      detailSheet.getCell(moduleEnd, column).border = {
        ...border,
        bottom: mediumNavy
      };
    }
  }
  setWidths(detailSheet, [16, 31, 10, 10, 26, 32, 11, 34, 30, 44]);
  detailSheet.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];
  detailSheet.properties.showGridLines = false;

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await workbook.xlsx.writeFile(outputPath);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const casesPath = path.resolve(required(args, "--cases"));
  const designPath = path.resolve(required(args, "--design"));
  const requestId = required(args, "--request");
  const outputPath = path.resolve(required(args, "--output"));
  const casesBytes = await fs.readFile(casesPath);
  const casesText = casesBytes.toString("utf8");
  const planText = await fs.readFile(designPath, "utf8");
  const model = buildDeliveryModel({
    requestId,
    plan: planText,
    cases: casesText,
    casesSha256: sha256(casesBytes),
    suitePath: path.relative(process.cwd(), casesPath) || casesPath
  });
  const executionRowCount = model.modules
    .flatMap((module) => module.cases)
    .reduce((total, testcase) => total + testcase.executionRows.length, 0);
  await createWorkbook(model, outputPath);
  const workbookBytes = await fs.readFile(outputPath);
  const receipt = {
    outputPath,
    sheets: [...sheetNames],
    statistics: { ...model.statistics, executionRowCount },
    casesSha256: model.casesSha256,
    semanticDigest: model.semanticDigest,
    workbookSha256: sha256(workbookBytes)
  };
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
