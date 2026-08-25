import { createHash } from "node:crypto";
import { canonicalJson } from "./canonicalJson.js";
import { markdownSection, markdownTableRows } from "../testcase/relationProjection.js";
import { ruleLedgerContractIssues } from "../testcase/relationContract.js";

export const CANDIDATE_PLAN_PREFLIGHT_SCHEMA_VERSION = "candidate-plan-preflight-v1" as const;

const dataStrategies = new Set([
  "no_write",
  "ephemeral_cleanup",
  "reusable_fixture",
  "tracked_residual"
]);

const requiredSections = [
  "## 请求默认值",
  "## 测试范围",
  "## 请求内来源",
  "## 需求索引",
  "## 规则设计台账",
  "## 需求歧义与未定义预期",
  "## 缺口与风险",
  "## 评审与正式决定"
];

export type CandidatePlanSourceLink = {
  sourceId: string;
  path: string;
};

export type ExplicitSourceQuote = {
  sourceId: string;
  text: string;
};

export type CandidateRepairCategory =
  | "plan_structure"
  | "source_registration"
  | "source_quote"
  | "rule_ledger"
  | "case_structure";

export interface CandidatePlanPreflightReport {
  schemaVersion: typeof CANDIDATE_PLAN_PREFLIGHT_SCHEMA_VERSION;
  complete: boolean;
  issues: string[];
  repairCategories: CandidateRepairCategory[];
  explicitQuotes: ExplicitSourceQuote[];
  digest: string;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

/** Safe, host-facing repair routing only. It never edits business content. */
export function candidateRepairChecklist(issues: readonly string[]): Array<{
  category: CandidateRepairCategory;
  issues: string[];
}> {
  const grouped = new Map<CandidateRepairCategory, string[]>();
  for (const issue of issues) {
    const category: CandidateRepairCategory = /逐字引文|逐字文本|原文：/u.test(issue)
      ? "source_quote"
      : /sourceRef|规则设计台账|RULE-/u.test(issue)
        ? "rule_ledger"
        : /用例|caseId|测试步骤|测试数据/u.test(issue)
          ? "case_structure"
          : /来源|SHA-256|路径|SRC-/u.test(issue)
            ? "source_registration"
            : "plan_structure";
    grouped.set(category, [...(grouped.get(category) ?? []), issue]);
  }
  return [...grouped.entries()]
    .map(([category, categoryIssues]) => ({ category, issues: unique(categoryIssues) }))
    .sort((left, right) => left.category.localeCompare(right.category));
}

function defaults(plan: string): Map<string, string> {
  return new Map(markdownTableRows(markdownSection(plan, "## 请求默认值"))
    .filter((row) => row.length >= 2 && row[0] && row[0] !== "项目")
    .map((row) => [row[0]!, row[1]?.replace(/`/gu, "").trim() ?? ""]));
}

export function parseExplicitSourceQuotes(plan: string): ExplicitSourceQuote[] {
  const quotes: ExplicitSourceQuote[] = [];
  const marker = /原文：[ \t]*(SRC-[A-Z0-9-]+)[ \t]*「([^」\r\n]+)」/gu;
  for (const match of plan.matchAll(marker)) {
    quotes.push({ sourceId: match[1]!, text: match[2]! });
  }
  return quotes;
}

/** Returns only controlled request-source links. It intentionally ignores all
 * other Markdown links, including UI examples and normal prose. */
export function parseCandidatePlanSourceLinks(plan: string): CandidatePlanSourceLink[] {
  return markdownTableRows(markdownSection(plan, "## 请求内来源"))
    .flatMap((row) => {
      const sourceId = row[0]?.trim() ?? "";
      if (!/^SRC-[A-Z0-9-]+$/u.test(sourceId)) return [];
      return [...(row[1] ?? "").matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)]
        .map((match) => ({ sourceId, path: match[1]!.trim() }))
        .filter((link) => Boolean(link.path));
    });
}

export function evaluateCandidatePlanPreflight(input: {
  plan: string;
  sourceTexts?: ReadonlyMap<string, readonly string[]>;
}): CandidatePlanPreflightReport {
  const issues: string[] = [];
  for (const section of requiredSections) {
    if (!input.plan.includes(section)) issues.push(`plan.md 缺少 ${section}。`);
  }
  const requestDefaults = defaults(input.plan);
  for (const key of ["测试类型", "目标环境", "数据策略"]) {
    if (!(requestDefaults.get(key) ?? "").trim()) issues.push(`请求默认值缺少 ${key}。`);
  }
  const strategy = requestDefaults.get("数据策略") ?? "";
  if (strategy && !dataStrategies.has(strategy)) {
    issues.push(`请求默认值的数据策略不受支持：${strategy}。`);
  }

  const sourceRows = markdownTableRows(markdownSection(input.plan, "## 请求内来源"))
    .filter((row) => /^SRC-[A-Z0-9-]+$/u.test(row[0] ?? ""));
  const sourceIds = new Set(sourceRows.map((row) => row[0]!));
  if (!sourceRows.length) issues.push("请求内来源至少需要一条实际读取的来源。");
  for (const row of sourceRows) {
    if (!row[1]?.trim() || /<[^>]+>|待填写|待补充/u.test(row[1]!)) {
      issues.push(`${row[0]} 缺少可点击路径或精确定位。`);
    }
    if (!/\b[a-f0-9]{64}\b/iu.test(row[2] ?? "")) issues.push(`${row[0]} 缺少有效 SHA-256。`);
  }
  for (const row of markdownTableRows(markdownSection(input.plan, "## 规则设计台账"))
    .filter((row) => /^RULE-[A-Z0-9-]+$/u.test(row[0] ?? ""))) {
    const refs = unique((row[2] ?? "").match(/\bSRC-[A-Z0-9-]+\b/gu) ?? []);
    if (!refs.length) issues.push(`${row[0]} 缺少 sourceRef。`);
    for (const sourceId of refs) {
      if (!sourceIds.has(sourceId)) issues.push(`${row[0]} 引用未登记来源 ${sourceId}。`);
    }
  }
  issues.push(...ruleLedgerContractIssues(input.plan));

  const explicitQuotes = parseExplicitSourceQuotes(input.plan);
  for (const quote of explicitQuotes) {
    const texts = input.sourceTexts?.get(quote.sourceId) ?? [];
    if (!texts.length) {
      issues.push(`${quote.sourceId} 没有可校验的受控文本来源，无法核验逐字引文。`);
    } else if (!texts.some((text) => text.includes(quote.text))) {
      issues.push(`${quote.sourceId} 未包含逐字引文「${quote.text}」。`);
    }
  }
  const normalized = {
    schemaVersion: CANDIDATE_PLAN_PREFLIGHT_SCHEMA_VERSION,
    complete: issues.length === 0,
    issues: unique(issues),
    repairCategories: candidateRepairChecklist(issues).map((item) => item.category),
    explicitQuotes
  };
  return {
    ...normalized,
    digest: createHash("sha256").update(canonicalJson(normalized), "utf8").digest("hex")
  };
}
