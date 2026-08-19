/**
 * 修订分层（revision tiering）：把 testcase_only 运行中「用户裁决/碎修正」引发的
 * 用例集修订按影响面分级，决定评审路径：
 * - structural：仅格式/计数/枚举级变化 → 确定性收口，零 LLM 评审轮
 * - scoped：少量用例块的语义行变化且不动规则台账行集 → 定向批次单轮复审
 * - substantive：动安全边界/数据策略语义、规则台账行集或大面积用例块 → 完整评审链
 *
 * 分级输入是基线（已被接受的冻结快照）与当前文本的纯 diff，不含任何环境状态，
 * 可在测试中直接断言。
 */

export const REVISION_TIER_SCHEMA_VERSION = "revision-tier-v1";

/** scoped 档允许发生语义行变化的最大用例块数；超过即升级 substantive。 */
export const MAX_SCOPED_CHANGED_CASES = 8;

export type RevisionTier = "structural" | "scoped" | "substantive";

export interface RevisionTierResult {
  schemaVersion: typeof REVISION_TIER_SCHEMA_VERSION;
  tier: RevisionTier;
  /** 内容发生变化的用例块（新增/删除/修改）。 */
  changedCaseIds: string[];
  /** 变化触及语义行（规则/前置条件/差异/步骤数据表/标题行）的用例块。 */
  semanticCaseIds: string[];
  /** 需求索引或规则设计台账的行集（caseIds 列除外）发生变化。 */
  ledgerChanged: boolean;
  ledgerChangeDetail: string[];
  reasons: string[];
}

const CASE_SUMMARY_PATTERN = /^<summary>(\S+?)｜/u;
const SEMANTIC_LINE_PATTERN = /^> (?:规则|前置条件|差异)：/u;
const CASE_TABLE_ROW_PATTERN = /^\| (?:D\d{2} |— )/u;
const LEDGER_SECTIONS = ["需求索引", "规则设计台账"] as const;
/** 台账表中允许在 structural 档内变化的列（用例集增删会同步 caseIds）。 */
const LEDGER_ALLOWED_STRUCTURAL_COLUMNS = new Set(["caseIds"]);

function diffLineSets(baseline: string, current: string): { added: Set<string>; removed: Set<string> } {
  const left = new Map<string, number>();
  for (const line of baseline.split(/\r?\n/u)) {
    left.set(line, (left.get(line) ?? 0) + 1);
  }
  const added = new Set<string>();
  const removed = new Set<string>();
  for (const line of current.split(/\r?\n/u)) {
    const count = left.get(line) ?? 0;
    if (count > 0) {
      left.set(line, count - 1);
    } else {
      added.add(line);
    }
  }
  for (const [line, count] of left) {
    if (count > 0) removed.add(line);
  }
  return { added, removed };
}

function normalizeFormatting(line: string): string {
  return line.replace(/[ \t]+$/u, "");
}

/** 仅格式差异（空行/行尾空白/分隔线）时视为无内容变化。 */
function onlyFormattingChanges(added: Set<string>, removed: Set<string>): boolean {
  const meaningful = (line: string) => normalizeFormatting(line).length > 0;
  return ![...added].some(meaningful) && ![...removed].some(meaningful);
}

interface CaseBlock {
  id: string;
  text: string;
}

function parseCaseBlocks(cases: string): CaseBlock[] {
  const starts = [...cases.matchAll(/^<summary>(\S+?)｜[^\n]*<\/summary>$/gmu)];
  return starts.map((match, index) => {
    const from = match.index ?? 0;
    const to = starts[index + 1]?.index ?? cases.length;
    return { id: match[1]!, text: cases.slice(from, to) };
  });
}

function isSemanticCaseChange(added: Set<string>, removed: Set<string>): boolean {
  const isSemantic = (line: string) =>
    SEMANTIC_LINE_PATTERN.test(line)
    || CASE_TABLE_ROW_PATTERN.test(line)
    || CASE_SUMMARY_PATTERN.test(line);
  return [...added].some(isSemantic) || [...removed].some(isSemantic);
}

function extractSectionTables(plan: string, headings: readonly string[]): string[] {
  const lines = plan.split(/\r?\n/u);
  const tables: string[] = [];
  for (const heading of headings) {
    const pattern = new RegExp(`^##\\s+${heading}\\s*$`, "u");
    const start = lines.findIndex((line) => pattern.test(line));
    if (start < 0) continue;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i += 1) {
      if (/^##\s+/u.test(lines[i]!)) {
        end = i;
        break;
      }
    }
    tables.push(lines.slice(start, end).join("\n"));
  }
  return tables;
}

/** 把 markdown 表行拆成单元格（不处理转义管道，台账列足够）。 */
function tableCells(line: string): string[] | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return undefined;
  return trimmed.slice(1, -1).split("|").map((cell) => cell.trim());
}

function ledgerRowKey(line: string, headerCells: string[] | undefined): string {
  const cells = tableCells(line);
  if (!cells || !headerCells) return line;
  // caseIds 列允许随用例集增删变化，不参与行键。
  const stable = cells
    .map((cell, index) => (LEDGER_ALLOWED_STRUCTURAL_COLUMNS.has(headerCells[index] ?? "") ? "" : cell))
    .join("｜");
  return stable;
}

function diffLedgerSections(baselinePlan: string, currentPlan: string): { changed: boolean; detail: string[] } {
  const detail: string[] = [];
  for (const heading of LEDGER_SECTIONS) {
    const baselineTable = extractSectionTables(baselinePlan, [heading])[0];
    if (!baselineTable) continue;
    const currentTable = extractSectionTables(currentPlan, [heading])[0];
    const baselineLines = baselineTable.split(/\r?\n/u).filter((line) => tableCells(line)?.length);
    const currentLines = (currentTable ?? "").split(/\r?\n/u).filter((line) => tableCells(line)?.length);
    // 表头行是首个表格行；分隔行（|---|）无单元格内容，被 tableCells 过滤前先剔除。
    const headerCells = tableCells(baselineLines.find((line, index) => index === 0) ?? "");
    const baselineKeys = new Set(baselineLines.map((line, index) => (index === 0 ? line : ledgerRowKey(line, headerCells))));
    const currentKeys = new Set(currentLines.map((line, index) => (index === 0 ? line : ledgerRowKey(line, headerCells))));
    for (const key of currentKeys) {
      if (!baselineKeys.has(key)) detail.push(`${heading}：新增/变更行 ${key.slice(0, 48)}`);
    }
    for (const key of baselineKeys) {
      if (!currentKeys.has(key)) detail.push(`${heading}：删除行 ${key.slice(0, 48)}`);
    }
  }
  return { changed: detail.length > 0, detail };
}

/**
 * 正式用户决定节是否新增了决定行（相对基线）。用户裁决覆盖的修订语义权威已定，
 * LLM 复审只承担转录核对，允许进入 scoped 定向单轮而非强制 substantive。
 * 判定用行摘要集合差：裁决可能替换/改写旧行而非纯追加，行数对比会漏判。
 */
function formalDecisionAdded(baselinePlan: string, currentPlan: string): boolean {
  const rowDigests = (plan: string): Set<string> => {
    const table = extractSectionTables(plan, ["正式用户决定"])[0];
    return new Set(
      (table ?? "")
        .split(/\r?\n/u)
        .map((line) => tableCells(line))
        .filter((cells): cells is string[] =>
          cells !== undefined && cells.length >= 4
          && !(cells.includes("subjectDigest") || cells.includes("subjectDigest / 输入摘要"))
        )
        .map((cells) => cells.join("｜"))
    );
  };
  const baseline = rowDigests(baselinePlan);
  for (const digest of rowDigests(currentPlan)) {
    if (!baseline.has(digest)) return true;
  }
  return false;
}

export function classifyRevisionDiff(
  baselineCases: string,
  currentCases: string,
  baselinePlan: string,
  currentPlan: string
): RevisionTierResult {
  const baselineBlocks = parseCaseBlocks(baselineCases);
  const currentBlocks = parseCaseBlocks(currentCases);
  const baselineById = new Map(baselineBlocks.map((block) => [block.id, block.text]));
  const currentById = new Map(currentBlocks.map((block) => [block.id, block.text]));

  const changedCaseIds: string[] = [];
  const semanticCaseIds: string[] = [];
  for (const id of new Set([...baselineById.keys(), ...currentById.keys()])) {
    const before = baselineById.get(id);
    const after = currentById.get(id);
    if (before === after) continue;
    changedCaseIds.push(id);
    if (before === undefined || after === undefined) {
      // 整块新增/删除：用例集合变化属于语义变化。
      semanticCaseIds.push(id);
      continue;
    }
    const { added, removed } = diffLineSets(before, after);
    if (onlyFormattingChanges(added, removed)) continue;
    if (isSemanticCaseChange(added, removed)) semanticCaseIds.push(id);
  }
  changedCaseIds.sort();
  semanticCaseIds.sort();

  const ledger = diffLedgerSections(baselinePlan, currentPlan);
  const decisionCovered = formalDecisionAdded(baselinePlan, currentPlan);

  const reasons: string[] = [];
  let tier: RevisionTier;
  if (semanticCaseIds.length === 0 && !ledger.changed) {
    tier = "structural";
    if (changedCaseIds.length) {
      reasons.push(`用例块 ${changedCaseIds.join("、")} 仅格式级变化`);
    }
  } else if (
    semanticCaseIds.length <= MAX_SCOPED_CHANGED_CASES
    && (!ledger.changed || decisionCovered)
  ) {
    tier = "scoped";
    reasons.push(`${semanticCaseIds.length} 个用例块存在语义行变化（≤${MAX_SCOPED_CHANGED_CASES}）`);
    if (ledger.changed && decisionCovered) {
      reasons.push("规则台账行集变化由新增正式用户决定覆盖，仅需定向转录核对");
    }
  } else {
    tier = "substantive";
    if (semanticCaseIds.length > MAX_SCOPED_CHANGED_CASES) {
      reasons.push(`语义行变化用例块 ${semanticCaseIds.length} 个，超过 scoped 上限 ${MAX_SCOPED_CHANGED_CASES}`);
    }
    if (ledger.changed && !decisionCovered) {
      reasons.push(`规则台账行集变化且无正式用户决定覆盖：${ledger.detail.join("；")}`);
    }
  }

  return {
    schemaVersion: REVISION_TIER_SCHEMA_VERSION,
    tier,
    changedCaseIds,
    semanticCaseIds,
    ledgerChanged: ledger.changed,
    ledgerChangeDetail: ledger.detail,
    reasons
  };
}
