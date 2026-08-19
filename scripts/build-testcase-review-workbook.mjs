import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const exportSchema = "testcase-review-export-v1";
const modelSchema = "testcase-review-model-v1";
const receiptSchema = "testcase-review-workbook-receipt-v1";
const sheetNames = ["说明", "用例索引", "用例详情"];
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

function validateExport(value) {
  if (!value || typeof value !== "object" || value.schema !== exportSchema) {
    throw new Error(`Review export schema must be ${exportSchema}.`);
  }
  const { model } = value;
  if (!model || model.schema !== modelSchema || model.formatVersion !== "testcase-v6-layered") {
    throw new Error("Review export must contain a testcase-v6-layered review model.");
  }
  for (const [label, digest] of [
    ["modelDigest", value.modelDigest],
    ["callbackSubjectDigest", value.callbackSubjectDigest],
    ["semanticDigest", value.semanticDigest],
  ]) {
    if (!digestPattern.test(digest ?? "")) throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  if (sha256(canonicalJson(model)) !== value.modelDigest) {
    throw new Error("Review export modelDigest does not match its model.");
  }
  if (
    model.callbackSubjectDigest !== value.callbackSubjectDigest
    || model.semanticDigest !== value.semanticDigest
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
  return value;
}

export function buildWorkbookLayout(exported) {
  const { model } = validateExport(exported);
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

function formulaErrorCount(ndjson) {
  const errorPattern = /#REF!|#DIV\/0!|#VALUE!|#NAME\?|#N\/A/u;
  return ndjson.split(/\r?\n/u).filter((line) =>
    line.trim() && !line.includes('"searchTerm"') && errorPattern.test(line)
  ).length;
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

async function createWorkbook(exported, outputPath, previewDir, receiptPath) {
  const { SpreadsheetFile, Workbook } = await import("@oai/artifact-tool");
  const { model } = exported;
  const layout = buildWorkbookLayout(exported);
  const workbook = Workbook.create();
  const colors = {
    navy: "#16324F",
    teal: "#0F766E",
    paleBlue: "#EAF2F8",
    paleTeal: "#E8F5F2",
    paleYellow: "#FFF4CC",
    paleRed: "#FDECEC",
    gray: "#F3F5F7",
    line: "#CBD5E1",
    text: "#1F2937",
    muted: "#64748B",
    white: "#FFFFFF",
  };
  const font = { name: "Microsoft YaHei", size: 10, color: colors.text };
  const border = { preset: "all", style: "thin", color: colors.line };

  function setColumnWidths(sheet, widths) {
    widths.forEach((width, index) => {
      sheet.getRangeByIndexes(0, index, 1, 1).format.columnWidth = width;
    });
  }

  function styleBase(sheet) {
    sheet.showGridLines = false;
    const used = sheet.getUsedRange();
    if (used) used.format.verticalAlignment = "center";
  }

  function styleHeader(range, fill = colors.navy) {
    range.format = {
      fill,
      font: { ...font, bold: true, color: colors.white },
      horizontalAlignment: "center",
      verticalAlignment: "center",
      wrapText: true,
      borders: border,
    };
    range.format.rowHeight = 28;
  }

  function styleBody(range) {
    range.format = { font, verticalAlignment: "center", wrapText: true, borders: border };
  }

  const infoSheet = workbook.worksheets.add("说明");
  const indexSheet = workbook.worksheets.add("用例索引");
  const detailSheet = workbook.worksheets.add("用例详情");

  infoSheet.getRange("A1:E1").merge();
  infoSheet.getRange("A1").values = [[`${model.title} · 只读评审版`]];
  infoSheet.getRange("A1:E1").format = {
    fill: colors.navy,
    font: { name: "Microsoft YaHei", size: 16, bold: true, color: colors.white },
    horizontalAlignment: "left",
    verticalAlignment: "center",
  };
  infoSheet.getRange("A1:E1").format.rowHeight = 34;
  infoSheet.getRange("A2:E2").merge();
  infoSheet.getRange("A2").values = [["只读评审版，以 cases.md 为准；请勿将本文件中的人工修改导回正式用例。"]];
  infoSheet.getRange("A2:E2").format = {
    fill: colors.paleYellow,
    font: { ...font, bold: true, color: "#7C5700" },
    wrapText: true,
  };
  infoSheet.getRange("A2:E2").format.rowHeight = 30;
  infoSheet.getRange("A4:B10").values = [
    ["请求编号", model.requestId],
    ["格式版本", model.formatVersion],
    ["测试类型", model.defaults.testType],
    ["默认环境", model.defaults.environment],
    ["默认数据策略", model.defaults.dataStrategy],
    ["确认摘要", model.callbackSubjectDigest],
    ["用例语义摘要", model.semanticDigest],
  ];
  infoSheet.getRange("A4:A10").format = { fill: colors.gray, font: { ...font, bold: true }, borders: border };
  infoSheet.getRange("B4:B10").format = { font, wrapText: true, borders: border };
  infoSheet.getRange("A12:B12").values = [["统计项", "当前值"]];
  styleHeader(infoSheet.getRange("A12:B12"), colors.teal);
  infoSheet.getRange("A13:A15").values = [["用例总数"], ["P0 用例"], ["高风险用例"]];
  infoSheet.getRange("B13:B15").formulas = layout.statisticsFormulas.map((formula) => [formula]);
  styleBody(infoSheet.getRange("A13:B15"));
  infoSheet.getRange("A17:E17").merge();
  infoSheet.getRange("A17").values = [["使用方式：先在“用例索引”筛选范围，再进入“用例详情”连续查看模块、用例、步骤和参数数据。"]];
  infoSheet.getRange("A17:E17").format = { fill: colors.paleBlue, font: { ...font, color: colors.navy }, wrapText: true };
  infoSheet.getRange("A17:E17").format.rowHeight = 30;
  infoSheet.getRange("A18:E18").merge();
  infoSheet.getRange("A18").values = [["颜色说明：索引斑马纹只用于阅读；P0 在优先级列标绿，高风险在风险列标红。"]];
  infoSheet.getRange("A18:E18").format = { fill: colors.gray, font: { ...font, color: colors.muted }, wrapText: true };
  infoSheet.getRange("A18:E18").format.rowHeight = 30;
  setColumnWidths(infoSheet, [18, 76, 16, 16, 16]);
  styleBase(infoSheet);
  infoSheet.freezePanes.freezeRows(2);

  indexSheet.getRange("A1:E1").values = [["模块", "用例编号", "用例标题", "优先级", "风险"]];
  indexSheet.getRange(`A2:E${layout.indexLastRow}`).values = model.indexRows.map((row) => [
    row.module, row.caseId, row.title, row.priority, row.risk,
  ]);
  styleHeader(indexSheet.getRange("A1:E1"));
  styleBody(indexSheet.getRange(`A2:E${layout.indexLastRow}`));
  indexSheet.getRange(`A2:E${layout.indexLastRow}`).format.rowHeight = 25;
  indexSheet.getRange(`D2:E${layout.indexLastRow}`).format.horizontalAlignment = "center";
  setColumnWidths(indexSheet, [22, 24, 46, 12, 12]);
  indexSheet.freezePanes.freezeRows(1);
  const indexTable = indexSheet.tables.add(`A1:E${layout.indexLastRow}`, true, "TestcaseIndexTable");
  indexTable.style = "TableStyleMedium2";
  indexTable.showFilterButton = true;
  indexSheet.getRange(`D2:D${layout.indexLastRow}`).conditionalFormats.add("expression", {
    formula: "$D2=\"P0\"",
    format: { fill: colors.paleTeal, font: { bold: true, color: colors.teal } },
  });
  indexSheet.getRange(`E2:E${layout.indexLastRow}`).conditionalFormats.add("expression", {
    formula: "$E2=\"高\"",
    format: { fill: colors.paleRed, font: { bold: true, color: "#991B1B" } },
  });
  styleBase(indexSheet);

  detailSheet.getRange("A1:J1").values = [[
    "模块", "用例", "优先级", "风险", "RULE / 差异", "前置条件", "数据编号", "步骤 / 操作", "测试数据", "预期结果",
  ]];
  styleHeader(detailSheet.getRange("A1:J1"));
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
      const rows = testcase.executionRows.map((executionRow, index) => {
        const dataId = executionRow.dataId ?? "—";
        const startsDataGroup = dataId !== previousDataId;
        previousDataId = dataId;
        return [
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
        ];
      });
      detailSheet.getRange(`A${caseStart}:J${caseEnd}`).values = rows;
      styleBody(detailSheet.getRange(`A${caseStart}:J${caseEnd}`));
      for (const column of ["B", "C", "D", "E", "F"]) {
        if (caseEnd > caseStart) detailSheet.getRange(`${column}${caseStart}:${column}${caseEnd}`).merge();
      }
      let groupStart = caseStart;
      let activeDataId = testcase.executionRows[0].dataId ?? "—";
      testcase.executionRows.forEach((executionRow, index) => {
        const currentDataId = executionRow.dataId ?? "—";
        const absoluteRow = caseStart + index;
        if (currentDataId !== activeDataId) {
          if (absoluteRow - 1 > groupStart) detailSheet.getRange(`G${groupStart}:G${absoluteRow - 1}`).merge();
          groupStart = absoluteRow;
          activeDataId = currentDataId;
        }
      });
      if (caseEnd > groupStart) detailSheet.getRange(`G${groupStart}:G${caseEnd}`).merge();
      detailSheet.getRange(`B${caseStart}:B${caseEnd}`).format = {
        fill: colors.paleBlue, font: { ...font, bold: true, color: colors.navy },
        horizontalAlignment: "left", verticalAlignment: "top", wrapText: true, borders: border,
      };
      detailSheet.getRange(`C${caseStart}:C${caseEnd}`).format = {
        fill: testcase.priority === "P0" ? colors.paleTeal : colors.gray,
        font: { ...font, bold: testcase.priority === "P0", color: testcase.priority === "P0" ? colors.teal : colors.text },
        horizontalAlignment: "center", verticalAlignment: "center", wrapText: true, borders: border,
      };
      detailSheet.getRange(`D${caseStart}:D${caseEnd}`).format = {
        fill: testcase.risk === "高" ? colors.paleRed : colors.gray,
        font: { ...font, bold: testcase.risk === "高", color: testcase.risk === "高" ? "#991B1B" : colors.text },
        horizontalAlignment: "center", verticalAlignment: "center", wrapText: true, borders: border,
      };
      for (const column of ["E", "F"]) {
        detailSheet.getRange(`${column}${caseStart}:${column}${caseEnd}`).format = {
          fill: column === "E" ? colors.gray : colors.white,
          font: column === "E" ? { ...font, color: colors.muted } : font,
          verticalAlignment: "top", wrapText: true, borders: border,
        };
      }
      detailSheet.getRange(`G${caseStart}:G${caseEnd}`).format.horizontalAlignment = "center";
      detailSheet.getRange(`A${caseStart}:J${caseStart}`).format.borders = { top: { style: "medium", color: colors.navy } };
      testcase.executionRows.forEach((executionRow, index) => {
        detailSheet.getRange(`A${caseStart + index}:J${caseStart + index}`).format.rowHeight = executionRowHeight(executionRow);
      });
      detailRow = caseEnd + 1;
    }
    const moduleEnd = detailRow - 1;
    if (moduleEnd > moduleStart) detailSheet.getRange(`A${moduleStart}:A${moduleEnd}`).merge();
    detailSheet.getRange(`A${moduleStart}:A${moduleEnd}`).format = {
      fill: colors.navy,
      font: { name: "Microsoft YaHei", size: 12, bold: true, color: colors.white },
      horizontalAlignment: "center", verticalAlignment: "center", wrapText: true,
      borders: { preset: "outside", style: "medium", color: colors.navy },
    };
    detailSheet.getRange(`A${moduleEnd}:J${moduleEnd}`).format.borders = { bottom: { style: "medium", color: colors.navy } };
  }
  setColumnWidths(detailSheet, [16, 31, 10, 10, 26, 32, 11, 34, 30, 44]);
  detailSheet.getRange(`H2:J${layout.detailLastRow}`).format.horizontalAlignment = "left";
  styleBase(detailSheet);
  detailSheet.freezePanes.freezeRows(1);
  detailSheet.freezePanes.freezeColumns(2);

  const summary = await workbook.inspect({
    kind: "workbook,sheet,table", maxChars: 5000, tableMaxRows: 5, tableMaxCols: 5, tableMaxCellChars: 100,
  });
  for (const sheetName of sheetNames) {
    if (!summary.ndjson.includes(sheetName)) throw new Error(`Workbook inspection is missing sheet ${sheetName}.`);
  }
  for (const sheetName of sheetNames) {
    const sheet = workbook.worksheets.getItem(sheetName);
    const usedRange = sheet.getUsedRange();
    if (!usedRange) throw new Error(`Workbook sheet ${sheetName} is empty.`);
    await workbook.inspect({
      kind: "region", sheetId: sheetName, range: usedRange.address,
      maxChars: 3000, tableMaxRows: 12, tableMaxCols: 10, tableMaxCellChars: 120,
    });
  }
  const errors = await workbook.inspect({
    kind: "match",
    searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
    options: { useRegex: true, maxResults: 300 },
    summary: "final formula error scan",
  });
  const detectedFormulaErrors = formulaErrorCount(errors.ndjson);
  if (detectedFormulaErrors !== 0) {
    throw new Error(`Workbook formula scan found ${detectedFormulaErrors} error record(s).`);
  }

  await fs.rm(previewDir, { recursive: true, force: true });
  await fs.mkdir(previewDir, { recursive: true });
  const previews = [];
  for (const sheetName of sheetNames) {
    const preview = await workbook.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
    const previewPath = path.join(previewDir, `${sheetName}.png`);
    const bytes = new Uint8Array(await preview.arrayBuffer());
    if (bytes.byteLength === 0) throw new Error(`Workbook preview is empty for ${sheetName}.`);
    await fs.writeFile(previewPath, bytes);
    previews.push({
      sheet: sheetName,
      path: path.relative(path.dirname(receiptPath), previewPath),
      sha256: sha256(bytes),
    });
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const exportedWorkbook = await SpreadsheetFile.exportXlsx(workbook);
  await exportedWorkbook.save(outputPath);
  const workbookBytes = await fs.readFile(outputPath);
  const receipt = {
    schema: receiptSchema,
    modelDigest: exported.modelDigest,
    callbackSubjectDigest: exported.callbackSubjectDigest,
    semanticDigest: exported.semanticDigest,
    workbookSha256: sha256(workbookBytes),
    sheets: sheetNames,
    statistics: layout.statistics,
    formulaErrorCount: detectedFormulaErrors,
    previews,
  };
  await writeJsonAtomic(receiptPath, receipt);
  await fs.rm(`${outputPath}.inspect.ndjson`, { force: true });
  return receipt;
}

async function main() {
  const args = process.argv.slice(2);
  const modelPath = required(args, "--model");
  const exported = validateExport(JSON.parse(await fs.readFile(modelPath, "utf8")));
  const layout = buildWorkbookLayout(exported);
  if (args.includes("--validate-only")) {
    process.stdout.write(`${JSON.stringify(layout)}\n`);
    return;
  }
  const outputPath = path.resolve(required(args, "--output"));
  const previewDir = path.resolve(required(args, "--preview-dir"));
  const receiptPath = path.resolve(required(args, "--receipt"));
  const receipt = await createWorkbook(exported, outputPath, previewDir, receiptPath);
  process.stdout.write(`${JSON.stringify({ outputPath, receiptPath, ...receipt })}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
