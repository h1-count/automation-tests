import { createHash } from "node:crypto";
import { canonicalJson } from "./canonicalJson.js";
import { markdownSection, markdownTableRows } from "../testcase/relationProjection.js";
import { ruleLedgerContractIssues } from "../testcase/relationContract.js";
import { extractRequirementFacts } from "../testcase/requirementFacts.js";

export const CANDIDATE_PLAN_PREFLIGHT_SCHEMA_VERSION = "candidate-plan-preflight-v1" as const;

const dataStrategies = new Set(["no_write", "ephemeral_cleanup", "reusable_fixture", "tracked_residual"]);
const requiredSections = [
  "## 基本信息", "## 请求默认值", "## 测试范围", "## 请求内来源", "## 需求索引",
  "## 规则设计台账", "## 显式事实覆盖", "## 编译子约束分解", "## 需求歧义与未定义预期", "## 缺口与风险", "## 评审与正式决定"
];
const supportedFactDispositions = new Set(["modeled", "excluded", "ambiguous"]);

export type CandidateFactCategory = "enum" | "limit" | "conditional_enum";
export type CandidateSourceUnitKind = "line" | "paragraph" | "page";
export type CandidateSourceFact = { sourceId: string; reference: string; category: CandidateFactCategory; quote: string };
export type CandidateSourceDocument = { kind: CandidateSourceUnitKind; units: readonly string[] };
export type CandidatePlanSourceLink = { sourceId: string; path: string; factRange: string };
export type CandidatePlanClause = {
  clauseId: string;
  ruleId: string;
  caseId: string;
  sourceSpan: string;
  factRefs: string[];
  summary: string;
};
export type ExplicitSourceQuote = { sourceId: string; text: string };
export type CandidateRepairCategory = "plan_structure" | "source_registration" | "source_quote" | "rule_ledger" | "case_structure";

export interface CandidatePlanPreflightReport {
  schemaVersion: typeof CANDIDATE_PLAN_PREFLIGHT_SCHEMA_VERSION;
  complete: boolean;
  issues: string[];
  repairCategories: CandidateRepairCategory[];
  explicitQuotes: ExplicitSourceQuote[];
  sourceFactCount: number;
  factCoverage: Record<"modeled" | "excluded" | "ambiguous", number>;
  digest: string;
}

type SourceRange = { start: number; end: number };
type LedgerRule = { ruleId: string; sourceRefs: string[]; caseIds: string[] };
type FactCoverageRow = { reference: string; disposition: string; ruleIds: string[]; rationale: string };

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}
function cell(value: string | undefined): string { return (value ?? "").replace(/`/gu, "").trim(); }
function identifiers(value: string): string[] { return unique(value.match(/\bRULE-[A-Z0-9-]+\b/gu) ?? []); }
function sourceIds(value: string): string[] { return unique(value.match(/\bSRC-[A-Z0-9-]+\b/gu) ?? []); }
function caseIds(value: string): string[] { return unique(value.match(/\bOPEN-[A-Z0-9]+(?:-[A-Z0-9]+)+\b/gu) ?? []); }
function clauseIds(value: string): string[] { return unique(value.match(/\bCLAUSE-[A-Z0-9]+(?:-[A-Z0-9]+)+\b/gu) ?? []); }

function ledgerRules(plan: string): Map<string, LedgerRule> {
  const rows = markdownTableRows(markdownSection(plan, "## 规则设计台账"));
  const header = rows.find((row) => row.includes("RULE") && row.includes("sourceRef") && row.includes("caseIds"));
  if (!header) return new Map();
  const ruleIndex = header.indexOf("RULE");
  const sourceIndex = header.indexOf("sourceRef");
  const caseIndex = header.indexOf("caseIds");
  return new Map(rows
    .filter((row) => /^RULE-[A-Z0-9-]+$/u.test(cell(row[ruleIndex])))
    .map((row) => {
      const ruleId = cell(row[ruleIndex]);
      return [ruleId, { ruleId, sourceRefs: sourceIds(cell(row[sourceIndex])), caseIds: caseIds(cell(row[caseIndex])) }];
    }));
}

function ledgerRuleCases(plan: string): Map<string, string[]> {
  return new Map([...ledgerRules(plan)].map(([ruleId, rule]) => [ruleId, rule.caseIds]));
}

export function candidateBaselineCoverageIssues(plan: string, baselinePlan: string): string[] {
  const baseline = ledgerRuleCases(baselinePlan);
  if (!baseline.size) return [];
  const candidate = ledgerRuleCases(plan);
  const issues: string[] = [];
  for (const [ruleId, baselineCaseIds] of baseline) {
    const candidateCaseIds = candidate.get(ruleId);
    if (!candidateCaseIds) {
      issues.push(`完整重建不得遗漏稳定套件规则 ${ruleId}。`);
      continue;
    }
    const missingCaseIds = baselineCaseIds.filter((caseId) => !candidateCaseIds.includes(caseId));
    if (missingCaseIds.length) issues.push(`完整重建规则 ${ruleId} 不得遗漏稳定用例 ${missingCaseIds.join("、")}。`);
  }
  return issues;
}

export function candidateRepairChecklist(issues: readonly string[]): Array<{ category: CandidateRepairCategory; issues: string[] }> {
  const grouped = new Map<CandidateRepairCategory, string[]>();
  for (const issue of issues) {
    const category: CandidateRepairCategory = /逐字引文|逐字文本|原文：/u.test(issue)
      ? "source_quote"
      : /事实覆盖|显式事实|RULE-|规则设计台账/u.test(issue)
        ? "rule_ledger"
        : /用例|caseId|测试步骤|测试数据/u.test(issue)
          ? "case_structure"
          : /来源|SHA-256|路径|SRC-|事实范围|L\d+|P\d+/u.test(issue)
            ? "source_registration" : "plan_structure";
    grouped.set(category, [...(grouped.get(category) ?? []), issue]);
  }
  return [...grouped.entries()]
    .map(([category, categoryIssues]) => ({ category, issues: unique(categoryIssues) }))
    .sort((left, right) => left.category.localeCompare(right.category));
}

function defaults(plan: string): Map<string, string> {
  return new Map(markdownTableRows(markdownSection(plan, "## 请求默认值"))
    .filter((row) => row.length >= 2 && row[0] && row[0] !== "项目")
    .map((row) => [cell(row[0]), cell(row[1]) ]));
}
function basicInformation(plan: string): Map<string, string> {
  return new Map(markdownTableRows(markdownSection(plan, "## 基本信息"))
    .filter((row) => row.length >= 2 && row[0] && row[0] !== "项目")
    .map((row) => [cell(row[0]), cell(row[1]) ]));
}

export function parseExplicitSourceQuotes(plan: string): ExplicitSourceQuote[] {
  const quotes: ExplicitSourceQuote[] = [];
  const marker = /原文：[ \t]*(SRC-[A-Z0-9-]+)[ \t]*「([^」\r\n]+)」/gu;
  for (const match of plan.matchAll(marker)) quotes.push({ sourceId: match[1]!, text: match[2]! });
  return quotes;
}

export function parseCandidatePlanSourceLinks(plan: string): CandidatePlanSourceLink[] {
  const rows = markdownTableRows(markdownSection(plan, "## 请求内来源"));
  const header = rows.find((row) => row.includes("来源 ID") && row.includes("路径"));
  const rangeIndex = header?.indexOf("事实范围") ?? -1;
  return rows.filter((row) => /^SRC-[A-Z0-9-]+$/u.test(cell(row[0]))).flatMap((row) => {
    // A legacy source registration can contain a primary readable artifact plus
    // screenshots or supporting files under one immutable source ID.  Fact
    // ranges have one coordinate space, so preflight must use exactly the
    // first linked artifact as that source's fact anchor.  The remaining links
    // remain visible in the ledger, but are not silently concatenated into an
    // incompatible L/P coordinate space.
    const match = [...(row[1] ?? "").matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)][0];
    if (!match?.[1]?.trim()) return [];
    return [{
      sourceId: cell(row[0]), path: match[1].trim(), factRange: rangeIndex >= 0 ? cell(row[rangeIndex]) : ""
    }];
  });
}

function parseFactRanges(value: string, kind: CandidateSourceUnitKind): SourceRange[] | undefined {
  const prefix = kind === "line" ? "L" : "P";
  const ranges = value.split(/[，,]/u).map((part) => part.trim()).filter(Boolean).map((part) => {
    const match = part.match(new RegExp(`^${prefix}(\\d+)(?:-${prefix}?(\\d+))?$`, "u"));
    if (!match) return undefined;
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    return start > 0 && end >= start ? { start, end } : undefined;
  });
  return ranges.length > 0 && ranges.every((range): range is SourceRange => Boolean(range)) ? ranges as SourceRange[] : undefined;
}

function parseSourceSpan(value: string): { sourceId: string; coordinate: "L" | "P"; range: SourceRange } | undefined {
  const match = value.trim().match(/^(SRC-[A-Z0-9-]+)#([LP])(\d+)(?:-[LP]?(\d+))?$/u);
  if (!match) return undefined;
  const start = Number(match[3]);
  const end = Number(match[4] ?? match[3]);
  return start > 0 && end >= start
    ? { sourceId: match[1]!, coordinate: match[2] as "L" | "P", range: { start, end } }
    : undefined;
}

/** The frozen plan, never the compiler proposal, owns clause-to-case allocation. */
export function parseCandidatePlanClauses(plan: string): CandidatePlanClause[] {
  const rows = markdownTableRows(markdownSection(plan, "## 编译子约束分解"));
  const header = rows.find((row) => row.includes("子约束") && row.includes("RULE") && row.includes("caseId")
    && row.includes("来源范围") && row.includes("显式事实引用") && row.includes("摘要"));
  if (!header) return [];
  const index = (name: string) => header.indexOf(name);
  return rows.slice(rows.indexOf(header) + 1).flatMap((row) => {
    const clauseId = cell(row[index("子约束")]);
    return !clauseId || clauseId === "—" ? [] : [{
      clauseId,
      ruleId: cell(row[index("RULE")]),
      caseId: cell(row[index("caseId")]),
      sourceSpan: cell(row[index("来源范围")]),
      factRefs: unique(cell(row[index("显式事实引用")]).match(/SRC-[A-Z0-9-]+#[LP]\d+:(?:enum|limit|conditional_enum)/gu) ?? []),
      summary: cell(row[index("摘要")])
    }];
  });
}

function validateClausePlan(input: {
  plan: string;
  sourceDocuments?: ReadonlyMap<string, CandidateSourceDocument>;
  links: CandidatePlanSourceLink[];
  facts: CandidateSourceFact[];
  issues: string[];
}): void {
  const table = markdownTableRows(markdownSection(input.plan, "## 编译子约束分解"));
  const hasHeader = table.some((row) => row.includes("子约束") && row.includes("RULE") && row.includes("caseId")
    && row.includes("来源范围") && row.includes("显式事实引用") && row.includes("摘要"));
  if (!hasHeader) {
    input.issues.push("编译子约束分解必须包含 子约束、RULE、caseId、来源范围、显式事实引用、摘要 表头。");
    return;
  }
  const clauses = parseCandidatePlanClauses(input.plan);
  const rules = ledgerRules(input.plan);
  const facts = new Set(input.facts.map((fact) => fact.reference));
  const seenClauses = new Set<string>();
  const coveredPairs = new Set<string>();
  for (const clause of clauses) {
    if (clauseIds(clause.clauseId).length !== 1 || clauseIds(clause.clauseId)[0] !== clause.clauseId || seenClauses.has(clause.clauseId)) {
      input.issues.push(`编译子约束 ${clause.clauseId || "<unknown>"} 必须唯一且使用 CLAUSE-... 标识。`);
      continue;
    }
    seenClauses.add(clause.clauseId);
    const rule = rules.get(clause.ruleId);
    if (!rule) { input.issues.push(`编译子约束 ${clause.clauseId} 引用未知 RULE ${clause.ruleId || "<unknown>"}。`); continue; }
    if (!rule.caseIds.includes(clause.caseId)) { input.issues.push(`编译子约束 ${clause.clauseId} 的 caseId 必须属于冻结 ${clause.ruleId}。`); continue; }
    if (!clause.summary || clause.summary === "—") input.issues.push(`编译子约束 ${clause.clauseId} 必须填写可审计摘要。`);
    const span = parseSourceSpan(clause.sourceSpan);
    if (!span) { input.issues.push(`编译子约束 ${clause.clauseId} 使用了非法来源范围。`); continue; }
    if (!rule.sourceRefs.includes(span.sourceId)) input.issues.push(`编译子约束 ${clause.clauseId} 不得跨来源关联 ${span.sourceId}。`);
    const link = input.links.find((item) => item.sourceId === span.sourceId);
    const document = input.sourceDocuments?.get(span.sourceId);
    const expectedCoordinate = document?.kind === "line" ? "L" : "P";
    if (!link || !document || span.coordinate !== expectedCoordinate || span.range.end > document.units.length) {
      input.issues.push(`编译子约束 ${clause.clauseId} 的来源范围不可在受控来源中校验。`);
    } else {
      const allowed = parseFactRanges(link.factRange, document.kind);
      if (!allowed || !allowed.some((range) => span.range.start >= range.start && span.range.end <= range.end)) {
        input.issues.push(`编译子约束 ${clause.clauseId} 的来源范围必须落在 ${span.sourceId} 的冻结事实范围内。`);
      }
    }
    for (const factRef of clause.factRefs) {
      if (!facts.has(factRef) || !factRef.startsWith(`${span.sourceId}#`)) input.issues.push(`编译子约束 ${clause.clauseId} 引用未知或跨来源显式事实 ${factRef}。`);
    }
    coveredPairs.add(`${clause.ruleId}/${clause.caseId}`);
  }
  for (const rule of rules.values()) for (const caseId of rule.caseIds) {
    if (!coveredPairs.has(`${rule.ruleId}/${caseId}`)) input.issues.push(`编译子约束分解未覆盖冻结关系 ${rule.ruleId} → ${caseId}。`);
  }
}

export function extractCandidateSourceFacts(input: { sourceId: string; kind: CandidateSourceUnitKind; units: readonly string[]; ranges: readonly SourceRange[] }): CandidateSourceFact[] {
  const facts: CandidateSourceFact[] = [];
  const extracted = extractRequirementFacts([...input.units], [...input.ranges]);
  const byUnit = new Map<number, Set<CandidateFactCategory>>();
  for (const fact of extracted) {
    if (fact.category !== "enum" && fact.category !== "limit") continue;
    const categories = byUnit.get(fact.line) ?? new Set<CandidateFactCategory>();
    if (fact.category === "limit") categories.add("limit");
    if (fact.category === "enum") {
      const unit = input.units[fact.line - 1] ?? "";
      const hasCondition = /(?:当|若|根据|随|不同|对应|分别).{0,48}(?:可选|可用|仅|支持|显示|设备类型|开发方式)/u.test(unit);
      categories.add(hasCondition ? "conditional_enum" : "enum");
    }
    byUnit.set(fact.line, categories);
  }
  for (const [index, categories] of byUnit) {
    const quote = (input.units[index - 1] ?? "").replace(/\s+/gu, " ").trim();
    const coordinate = input.kind === "line" ? `L${index}` : `P${index}`;
    for (const category of categories) {
      facts.push({ sourceId: input.sourceId, reference: `${input.sourceId}#${coordinate}:${category}`, category, quote });
    }
  }
  return facts.sort((left, right) => left.reference.localeCompare(right.reference));
}

function factCoverageRows(plan: string, issues: string[]): FactCoverageRow[] {
  const rows = markdownTableRows(markdownSection(plan, "## 显式事实覆盖"));
  const header = rows.find((row) => row.includes("事实引用") && row.includes("处置") && row.includes("RULE") && row.includes("理由"));
  if (!header) {
    issues.push("显式事实覆盖必须包含 事实引用、处置、RULE、理由 表头。");
    return [];
  }
  const referenceIndex = header.indexOf("事实引用");
  const dispositionIndex = header.indexOf("处置");
  const ruleIndex = header.indexOf("RULE");
  const rationaleIndex = header.indexOf("理由");
  return rows.slice(rows.indexOf(header) + 1).flatMap((row) => {
    const reference = cell(row[referenceIndex]);
    return !reference || reference === "—" ? [] : [{
      reference, disposition: cell(row[dispositionIndex]), ruleIds: identifiers(cell(row[ruleIndex])), rationale: cell(row[rationaleIndex])
    }];
  });
}

function validateFactCoverage(input: { plan: string; sourceDocuments?: ReadonlyMap<string, CandidateSourceDocument>; links: CandidatePlanSourceLink[]; issues: string[] }): { facts: CandidateSourceFact[]; counts: Record<"modeled" | "excluded" | "ambiguous", number> } {
  const counts = { modeled: 0, excluded: 0, ambiguous: 0 };
  const facts: CandidateSourceFact[] = [];
  for (const link of input.links) {
    const document = input.sourceDocuments?.get(link.sourceId);
    const extension = link.path.toLowerCase().split(".").at(-1) ?? "";
    const expectedKind: CandidateSourceUnitKind = extension === "docx"
      ? "paragraph"
      : extension === "pdf"
        ? "page"
        : "line";
    if (!document) { input.issues.push(`${link.sourceId} 缺少可抽取的受控来源正文，无法校验显式事实覆盖。`); continue; }
    if (document.kind !== expectedKind) { input.issues.push(`${link.sourceId} 的事实范围类型与来源格式不一致。`); continue; }
    const ranges = parseFactRanges(link.factRange, expectedKind);
    if (!ranges) {
      input.issues.push(`${link.sourceId} 缺少或使用了非法事实范围；${expectedKind === "line" ? "Markdown 使用 L<n> 或 L<n>-L<m>" : "DOCX 使用 P<n> 或 P<n>-P<m>"}。`);
      continue;
    }
    if (ranges.some((range) => range.end > document.units.length)) { input.issues.push(`${link.sourceId} 的事实范围超出受控来源正文。`); continue; }
    facts.push(...extractCandidateSourceFacts({ sourceId: link.sourceId, kind: document.kind, units: document.units, ranges }));
  }
  const rows = factCoverageRows(input.plan, input.issues);
  const factsByReference = new Map(facts.map((fact) => [fact.reference, fact]));
  const rules = ledgerRules(input.plan);
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.reference)) { input.issues.push(`显式事实覆盖重复登记 ${row.reference}。`); continue; }
    seen.add(row.reference);
    const fact = factsByReference.get(row.reference);
    if (!fact) { input.issues.push(`显式事实覆盖引用未知事实 ${row.reference}。`); continue; }
    if (!supportedFactDispositions.has(row.disposition)) { input.issues.push(`${row.reference} 的处置必须是 modeled、excluded 或 ambiguous。`); continue; }
    if (row.disposition === "modeled") {
      if (!row.ruleIds.length) { input.issues.push(`${row.reference} 的 modeled 处置必须关联至少一个 RULE。`); continue; }
      for (const ruleId of row.ruleIds) {
        const rule = rules.get(ruleId);
        if (!rule) input.issues.push(`${row.reference} 关联未知 RULE ${ruleId}。`);
        else if (!rule.sourceRefs.includes(fact.sourceId)) input.issues.push(`${row.reference} 不得关联跨来源 RULE ${ruleId}。`);
        else if (!rule.caseIds.length) input.issues.push(`${row.reference} 关联的 RULE ${ruleId} 缺少冻结 caseId。`);
      }
      counts.modeled += 1;
    } else {
      if (row.ruleIds.length || !row.rationale || row.rationale === "—") input.issues.push(`${row.reference} 的 ${row.disposition} 处置不得关联 RULE，且必须填写可审计理由。`);
      else counts[row.disposition as "excluded" | "ambiguous"] += 1;
    }
  }
  for (const fact of facts) if (!seen.has(fact.reference)) input.issues.push(`显式事实 ${fact.reference} 未登记覆盖处置。`);
  return { facts, counts };
}

export function evaluateCandidatePlanPreflight(input: {
  plan: string;
  sourceTexts?: ReadonlyMap<string, readonly string[]>;
  sourceDocuments?: ReadonlyMap<string, CandidateSourceDocument>;
  sourceDiagnostics?: ReadonlyMap<string, string>;
  baselinePlan?: string;
}): CandidatePlanPreflightReport {
  const issues: string[] = [];
  for (const section of requiredSections) if (!input.plan.includes(section)) issues.push(`plan.md 缺少 ${section}。`);
  if (!/用例格式[：:]\s*testcase-v1-layered\b/u.test(input.plan)) issues.push("plan.md 必须声明用例格式 testcase-v1-layered。");
  const requestDefaults = defaults(input.plan);
  for (const key of ["测试类型", "目标环境", "数据策略"]) if (!(requestDefaults.get(key) ?? "").trim()) issues.push(`请求默认值缺少 ${key}。`);
  const strategy = requestDefaults.get("数据策略") ?? "";
  if (strategy && !dataStrategies.has(strategy)) issues.push(`请求默认值的数据策略不受支持：${strategy}。`);
  const basic = basicInformation(input.plan);
  for (const key of ["测试请求", "测试类型", "目标环境"]) if (!(basic.get(key) ?? "").trim()) issues.push(`基本信息缺少 ${key}。`);
  const scope = markdownSection(input.plan, "## 测试范围");
  if (!/^###\s+包含\s*$/mu.test(scope) || !/^\s*-\s+\S+/mu.test(scope)) issues.push("测试范围必须包含非空的 ### 包含 顶层范围。");

  const sourceRows = markdownTableRows(markdownSection(input.plan, "## 请求内来源")).filter((row) => /^SRC-[A-Z0-9-]+$/u.test(cell(row[0])));
  const links = parseCandidatePlanSourceLinks(input.plan);
  const sourceIdSet = new Set(sourceRows.map((row) => cell(row[0])));
  if (!sourceRows.length) issues.push("请求内来源至少需要一条实际读取的来源。");
  for (const row of sourceRows) {
    if (!cell(row[1]) || /<[^>]+>|待填写|待补充/u.test(row[1] ?? "")) issues.push(`${cell(row[0])} 缺少可点击路径或精确定位。`);
    if (!/\b[a-f0-9]{64}\b/iu.test(row[2] ?? "")) issues.push(`${cell(row[0])} 缺少有效 SHA-256。`);
    if (!links.some((link) => link.sourceId === cell(row[0]))) issues.push(`${cell(row[0])} 缺少可解析的来源链接。`);
  }
  for (const rule of ledgerRules(input.plan).values()) {
    if (!rule.sourceRefs.length) issues.push(`${rule.ruleId} 缺少 sourceRef。`);
    for (const sourceId of rule.sourceRefs) if (!sourceIdSet.has(sourceId)) issues.push(`${rule.ruleId} 引用未登记来源 ${sourceId}。`);
  }
  issues.push(...ruleLedgerContractIssues(input.plan));
  if (input.baselinePlan) issues.push(...candidateBaselineCoverageIssues(input.plan, input.baselinePlan));
  const coverage = validateFactCoverage({ plan: input.plan, sourceDocuments: input.sourceDocuments, links, issues });
  validateClausePlan({ plan: input.plan, sourceDocuments: input.sourceDocuments, links, facts: coverage.facts, issues });
  const explicitQuotes = parseExplicitSourceQuotes(input.plan);
  for (const quote of explicitQuotes) {
    const texts = input.sourceTexts?.get(quote.sourceId) ?? [];
    if (!texts.length) issues.push(input.sourceDiagnostics?.get(quote.sourceId) ?? `${quote.sourceId} 没有可校验的受控文本来源，无法核验逐字引文。`);
    else if (!texts.some((text) => text.includes(quote.text))) issues.push(`${quote.sourceId} 未包含逐字引文「${quote.text}」。`);
  }
  const normalized = {
    schemaVersion: CANDIDATE_PLAN_PREFLIGHT_SCHEMA_VERSION, complete: issues.length === 0, issues: unique(issues),
    repairCategories: candidateRepairChecklist(issues).map((item) => item.category), explicitQuotes,
    sourceFactCount: coverage.facts.length, factCoverage: coverage.counts
  };
  return { ...normalized, digest: createHash("sha256").update(canonicalJson(normalized), "utf8").digest("hex") };
}
