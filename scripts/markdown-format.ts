export interface MarkdownFormatIssue {
  line: number;
  detail: string;
  repairable: boolean;
}

export interface MarkdownFormatRepairResult {
  content: string;
  repairedLines: number[];
  issues: MarkdownFormatIssue[];
}

export function splitMarkdownTableRow(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  for (const character of line) {
    if (character === "|" && !escaped) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
    escaped = character === "\\" && !escaped;
    if (character !== "\\") escaped = false;
  }
  cells.push(cell.trim());
  return cells.slice(1, -1);
}

function isTableRow(line: string): boolean {
  return line.trim().startsWith("|") && line.trim().endsWith("|");
}

function isSeparatorRow(line: string): boolean {
  return /^\|\s*:?-{3,}/.test(line.trim());
}

function normalizedSeparator(columnCount: number): string {
  return `|${Array.from({ length: columnCount }, () => " --- ").join("|")}|`;
}

export function inspectMarkdownFormat(content: string): MarkdownFormatIssue[] {
  const lines = content.split("\n");
  const issues: MarkdownFormatIssue[] = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = lines[index]?.trim() ?? "";
    const separator = lines[index + 1]?.trim() ?? "";
    if (!isTableRow(header) || !isSeparatorRow(separator)) continue;
    const headerColumns = splitMarkdownTableRow(header).length;
    const separatorColumns = splitMarkdownTableRow(separator).length;
    if (headerColumns !== separatorColumns) {
      issues.push({ line: index + 2, detail: `表头 ${headerColumns} 列、分隔行 ${separatorColumns} 列`, repairable: true });
    }
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const row = lines[rowIndex]?.trim() ?? "";
      if (!isTableRow(row)) break;
      const rowColumns = splitMarkdownTableRow(row).length;
      if (rowColumns !== headerColumns) {
        issues.push({ line: rowIndex + 1, detail: `表头 ${headerColumns} 列、数据行 ${rowColumns} 列`, repairable: false });
      }
    }
  }
  const escapedLineBreaks = (content.match(/\\[nr]/g) ?? []).length;
  if (escapedLineBreaks > 0) issues.push({ line: 0, detail: `发现 ${escapedLineBreaks} 个字面量 \\n 或 \\r`, repairable: false });
  return issues;
}

/** Only separator rows are normalized automatically; data rows need human or generator repair. */
export function repairMarkdownSeparators(content: string): MarkdownFormatRepairResult {
  const lines = content.split("\n");
  const repairedLines: number[] = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = lines[index]?.trim() ?? "";
    const separator = lines[index + 1]?.trim() ?? "";
    if (!isTableRow(header) || !isSeparatorRow(separator)) continue;
    const headerColumns = splitMarkdownTableRow(header).length;
    if (headerColumns !== splitMarkdownTableRow(separator).length) {
      lines[index + 1] = normalizedSeparator(headerColumns);
      repairedLines.push(index + 2);
    }
  }
  const repairedContent = lines.join("\n");
  return { content: repairedContent, repairedLines, issues: inspectMarkdownFormat(repairedContent) };
}
