import {
  isCurrentTestcaseDocumentVersion,
  parseTestcaseDocument,
  projectTestcaseV6Rules
} from "./testcaseDocument.js";
import {
  CURRENT_RELATION_PROJECTION_MARKER,
  CURRENT_RULE_LEDGER_MARKER,
  relationProjectionContractIssues,
  ruleLedgerContractIssues
} from "./relationContract.js";

export const CASE_RELATION_PROJECTION_MARKER_V3 = CURRENT_RELATION_PROJECTION_MARKER;
export const RULE_DESIGN_LEDGER_MARKER_V3 = CURRENT_RULE_LEDGER_MARKER;

export type RelationIssue = { name: string; detail: string };
export type RuleCaseRecord = {
  id: string;
  reqIds: string[];
  type: string;
  applicability: string;
  caseIds: string[];
};
export type RuleDesignRecord = { id: string; caseIds: string[]; rawCaseIds: string };
export type RuleDesignDetail = RuleDesignRecord & {
  fieldOrState: string;
  requiredness: string;
  inputs: string;
  observableExpectation: string;
  dataPrecondition: string;
  executionGate: string;
  conclusion: string;
};
export type RelationProjection = { plan: string; packages: Record<string, string>; issues: RelationIssue[] };

const casePattern = /\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+\b/g;
const rulePattern = /\bRULE-[A-Z0-9]+(?:-[A-Z0-9]+)+\b/g;
const reqPattern = /\bREQ-[A-Z0-9]+(?:-[A-Z0-9]+)+\b/g;

function ids(value: string, pattern: RegExp): string[] {
  pattern.lastIndex = 0;
  return [...new Set(value.match(pattern) ?? [])].sort();
}

export function parseCaseIds(value: string): string[] {
  return ids(value, casePattern).filter((id) => !/^(?:REQ|RULE)-/u.test(id));
}

export function markdownSection(content: string, heading: string): string {
  const start = content.indexOf(heading);
  if (start < 0) return "";
  const end = content.indexOf("\n## ", start + heading.length);
  return content.slice(start, end < 0 ? undefined : end);
}

export function splitMarkdownTableRow(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  for (const character of line.trim()) {
    if (escaped) {
      cell += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      cell += character;
      escaped = true;
      continue;
    }
    if (character === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += character;
  }
  cells.push(cell.trim());
  return cells.slice(1, -1);
}

export function markdownTableRows(content: string): string[][] {
  return content.split("\n")
    .filter((line) => line.trim().startsWith("|") && !/^\|\s*:?-{3,}/u.test(line.trim()))
    .map(splitMarkdownTableRow);
}

function ruleRows(plan: string): string[][] {
  if (ruleLedgerContractIssues(plan).length > 0) return [];
  return markdownTableRows(markdownSection(plan, "## 规则设计台账"))
    .filter((cells) => /^RULE-/u.test(cells[0] ?? ""));
}

export function parseRuleCaseRecords(plan: string): RuleCaseRecord[] {
  return ruleRows(plan).map((cells) => ({
    id: ids(cells[0] ?? "", rulePattern)[0] ?? "",
    reqIds: ids(cells[1] ?? "", reqPattern),
    type: cells[5] ?? "",
    applicability: cells[8] ?? "",
    caseIds: parseCaseIds(cells[6] ?? "")
  }));
}

export function parseRuleDesignRecords(plan: string): RuleDesignRecord[] {
  return ruleRows(plan).map((cells) => ({
    id: ids(cells[0] ?? "", rulePattern)[0] ?? "",
    caseIds: parseCaseIds(cells[6] ?? ""),
    rawCaseIds: (cells[6] ?? "").trim()
  }));
}

export function parseRuleDesignDetails(plan: string): RuleDesignDetail[] {
  return ruleRows(plan).map((cells) => ({
    id: ids(cells[0] ?? "", rulePattern)[0] ?? "",
    fieldOrState: cells[3] ?? "",
    requiredness: "不适用",
    inputs: cells[3] ?? "",
    observableExpectation: cells[4] ?? "",
    dataPrecondition: cells[7] ?? "",
    executionGate: cells[7] ?? "",
    caseIds: parseCaseIds(cells[6] ?? ""),
    rawCaseIds: (cells[6] ?? "").trim(),
    conclusion: cells[8] ?? ""
  }));
}

function concrete(value: string): boolean {
  const normalized = value.replace(/`/gu, "").trim();
  return normalized.length > 0
    && !["无", "待填写", "待补充", "未知", "已定义校验", "符合预期", "功能正常"].includes(normalized);
}

export function validateRuleDesignMatrix(plan: string): RelationIssue[] {
  const contractIssues = [
    ...ruleLedgerContractIssues(plan),
    ...relationProjectionContractIssues(plan)
  ];
  if (contractIssues.length) return contractIssues.map((detail) => ({ name: "规则关系契约", detail }));
  const rules = parseRuleCaseRecords(plan);
  const designs = new Map(parseRuleDesignDetails(plan).map((record) => [record.id, record]));
  const issues: RelationIssue[] = [];
  for (const rule of rules.filter((record) => ["已覆盖", "受控执行"].includes(record.applicability))) {
    const design = designs.get(rule.id);
    if (!design) {
      issues.push({ name: "规则设计台账", detail: `${rule.id} 缺少规则设计记录。` });
      continue;
    }
    if (!concrete(design.inputs) || !concrete(design.observableExpectation)) {
      issues.push({ name: "规则设计台账", detail: `${rule.id} 缺少具体输入或可观察预期。` });
    }
    if (!design.executionGate.trim() || /<|待填写|未知/u.test(design.executionGate)) {
      issues.push({ name: "规则设计台账", detail: `${rule.id} 缺少风险或执行门禁。` });
    }
    if (!concrete(design.rawCaseIds)) issues.push({ name: "规则设计台账", detail: `${rule.id} 缺少关联 caseId。` });
    if (!sameValues(design.caseIds, rule.caseIds)) {
      issues.push({ name: "规则设计台账", detail: `${rule.id} 的设计 caseId 与 RULE 台账不一致。` });
    }
    if (!["已覆盖", "受控执行", "待确认", "不适用"].includes(design.conclusion)) {
      issues.push({ name: "规则设计台账", detail: `${rule.id} 缺少有效设计结论。` });
    }
  }
  return issues;
}

function sameValues(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function validateRelationProjection(plan: string, packages: Record<string, string>): RelationIssue[] {
  const contractIssues = [
    ...ruleLedgerContractIssues(plan),
    ...relationProjectionContractIssues(plan)
  ];
  if (contractIssues.length) return contractIssues.map((detail) => ({ name: "规则关系契约", detail }));
  const rules = parseRuleCaseRecords(plan);
  const requestIds = new Set(markdownTableRows(markdownSection(plan, "## 需求索引"))
    .flatMap((row) => ids(row[0] ?? "", reqPattern)));
  const bodyRecords: Array<{ caseId: string; ruleIds: string[] }> = [];
  const issues: RelationIssue[] = [];
  for (const [name, content] of Object.entries(packages)) {
    const document = parseTestcaseDocument(content);
    if (!isCurrentTestcaseDocumentVersion(document.version)) {
      issues.push({ name: "用例格式", detail: `${name} 不是当前 testcase-v6-layered。` });
      continue;
    }
    bodyRecords.push(...document.cases.map((testcase) => ({
      caseId: testcase.caseId,
      ruleIds: [...testcase.ruleIds].sort()
    })));
  }
  const bodies = bodyRecords.map((record) => record.caseId).filter(Boolean);
  const caseSet = new Set(bodies);
  const duplicates = [...new Set(bodies.filter((caseId, index) => bodies.indexOf(caseId) !== index))];
  if (duplicates.length) issues.push({ name: "caseId 唯一性", detail: `重复 caseId：${duplicates.join("、")}` });
  for (const rule of rules) {
    if (!rule.reqIds.length) issues.push({ name: "RULE 关系源", detail: `${rule.id} 没有关联任何 REQ。` });
    for (const reqId of rule.reqIds) {
      if (!requestIds.has(reqId)) issues.push({ name: "RULE 关系源", detail: `${rule.id} 关联的 ${reqId} 不存在。` });
    }
    if (bodies.length && ["已覆盖", "受控执行"].includes(rule.applicability) && !rule.caseIds.length) {
      issues.push({ name: "RULE 关系源", detail: `${rule.id} 缺少有效 RULE → caseId。` });
    }
    for (const caseId of rule.caseIds) {
      if (!caseSet.has(caseId)) issues.push({ name: "RULE 关系源", detail: `${rule.id} → ${caseId} 不存在。` });
    }
  }
  for (const record of bodyRecords) {
    const planRules = rules.filter((rule) => rule.caseIds.includes(record.caseId)).map((rule) => rule.id).sort();
    if (!planRules.length) issues.push({ name: "RULE 关系源", detail: `${record.caseId} 没有任何 RULE → caseId 关系。` });
    if (!sameValues(planRules, record.ruleIds)) {
      issues.push({ name: "RULE ↔ caseId 双向追溯", detail: `${record.caseId} 的规则编号与规则设计台账不一致。` });
    }
  }
  return issues;
}

export function projectRelationProjection(plan: string, packages: Record<string, string>): RelationProjection {
  const rulesByCase = new Map<string, string[]>();
  for (const rule of parseRuleCaseRecords(plan)) {
    for (const caseId of rule.caseIds) {
      rulesByCase.set(caseId, [...new Set([...(rulesByCase.get(caseId) ?? []), rule.id])].sort());
    }
  }
  const projectedPackages = Object.fromEntries(Object.entries(packages).map(([name, value]) => [
    name,
    projectTestcaseV6Rules(value, rulesByCase)
  ]));
  return {
    plan,
    packages: projectedPackages,
    issues: validateRelationProjection(plan, projectedPackages)
  };
}
