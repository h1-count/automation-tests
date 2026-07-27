export const RULE_COVERAGE_MARKER = "结构版本：rule-coverage-v1";
export const RULE_COVERAGE_SECTION = "## 规则覆盖台账";
export const RULE_TYPES = ["业务规则", "分支/决策", "输入边界", "异常与恢复", "状态流转", "页面交互", "权限/身份", "集成与数据一致性"] as const;

export interface RuleRecord {
  ruleId: string;
  traceIds: string[];
  source: string;
  type: string;
  trigger: string;
  expected: string;
  designEvidence: string;
  applicability: string;
  coverageStatus: string;
  caseIds: string[];
  rationale: string;
}

export interface RuleCaseRecord {
  caseId: string;
  ruleIds: string[];
  source: string;
}

export interface RuleGateIssue {
  name: string;
  detail: string;
}

const ruleIdPattern = /\bRULE-[A-Z0-9]+(?:-[A-Z0-9]+)+\b/g;
const traceIdPattern = /\bREQ-[A-Z0-9]+(?:-[A-Z0-9]+)+\b/g;
const caseIdPattern = /\b[A-Z][A-Z0-9]+(?:-[A-Z0-9]+){2,}\b/g;
const allowedApplicability = new Set(["适用", "不适用", "待补充", "受控执行", "待用户裁决"]);
const allowedCoverage = new Set(["已覆盖", "受控执行", "待用户裁决", "不适用", "待补充"]);

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function ids(value: string, pattern: RegExp): string[] {
  return unique(value.match(pattern) ?? []);
}

function hasValue(value: string): boolean {
  return Boolean(value.trim()) && !/[<＞>]/.test(value) && !/^(无|待填写|待补充|不适用)$/u.test(value.trim());
}

export function extractMarkdownSection(content: string, heading: string): string {
  const start = content.indexOf(heading);
  if (start === -1) return "";
  const next = content.indexOf("\n## ", start + heading.length);
  return content.slice(start, next === -1 ? undefined : next);
}

function markdownRows(content: string): string[][] {
  return content
    .split("\n")
    .filter((line) => line.trim().startsWith("|") && !/^\|\s*-{3,}/.test(line.trim()))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
}

export function parseRuleRecords(plan: string): RuleRecord[] {
  return markdownRows(extractMarkdownSection(plan, RULE_COVERAGE_SECTION))
    .filter((cells) => cells.length === 11 && cells[0] !== "规则编号")
    .filter((cells) => ids(cells[0] ?? "", ruleIdPattern).length > 0)
    .map((cells) => ({
      ruleId: ids(cells[0] ?? "", ruleIdPattern)[0] ?? "",
      traceIds: ids(cells[1] ?? "", traceIdPattern),
      source: cells[2] ?? "",
      type: cells[3] ?? "",
      trigger: cells[4] ?? "",
      expected: cells[5] ?? "",
      designEvidence: cells[6] ?? "",
      applicability: cells[7] ?? "",
      coverageStatus: cells[8] ?? "",
      caseIds: ids(cells[9] ?? "", caseIdPattern).filter((id) => !id.startsWith("REQ-") && !id.startsWith("RULE-")),
      rationale: cells[10] ?? ""
    }));
}

function evidenceIsValid(rule: RuleRecord): boolean {
  if (!hasValue(rule.designEvidence)) return false;
  if (rule.type === "分支/决策") return rule.designEvidence.includes("决策表");
  if (rule.type === "输入边界") return /等价类|边界/.test(rule.designEvidence);
  if (rule.type === "状态流转") return rule.designEvidence.includes("状态迁移");
  if (rule.type === "页面交互") return /交互断言|可观察断言/.test(rule.designEvidence);
  if (rule.type === "异常与恢复") return /异常路径|恢复路径/.test(rule.designEvidence);
  return true;
}

export function validateRuleCoverage(plan: string, cases: RuleCaseRecord[]): RuleGateIssue[] {
  const section = extractMarkdownSection(plan, RULE_COVERAGE_SECTION);
  if (!section || !plan.includes(RULE_COVERAGE_MARKER)) {
    return [{ name: "规则覆盖台账", detail: "未标记 rule-coverage-v1；历史请求保持兼容告警，首次实质变更时迁移。" }];
  }
  const rows = markdownRows(section);
  const records = parseRuleRecords(plan);
  const issues: RuleGateIssue[] = [];
  const header = ["规则编号", "需求追溯编号", "来源定位", "规则类型", "触发条件/输入", "可观察预期", "设计证据", "适用性", "覆盖状态", "关联 caseId", "依据、执行门禁或裁决"];
  if (!header.every((item) => section.includes(`| ${item} |`)) || records.length === 0 || rows.some((row) => row[0] !== "规则编号" && row.length !== 11)) {
    issues.push({ name: "规则覆盖台账结构", detail: "必须提供 rule-coverage-v1 标记、十一列表头和至少一条 RULE 记录。" });
    return issues;
  }
  const duplicateRules = records.filter((rule, index) => records.findIndex((item) => item.ruleId === rule.ruleId) !== index).map((rule) => rule.ruleId);
  if (duplicateRules.length) issues.push({ name: "规则编号唯一性", detail: `重复 RULE：${unique(duplicateRules).join("、")}。` });
  const invalidFields = records.filter((rule) => !rule.traceIds.length || !hasValue(rule.source) || !RULE_TYPES.includes(rule.type as (typeof RULE_TYPES)[number]) || !hasValue(rule.trigger) || !hasValue(rule.expected) || !allowedApplicability.has(rule.applicability) || !allowedCoverage.has(rule.coverageStatus));
  if (invalidFields.length) issues.push({ name: "规则台账字段", detail: `来源、类型、触发、可观察预期、适用性或状态不合法：${invalidFields.map((rule) => rule.ruleId).join("、")}。` });
  const invalidRationale = records.filter((rule) => ["不适用", "待补充", "待用户裁决", "受控执行"].includes(rule.applicability) && !hasValue(rule.rationale));
  if (invalidRationale.length) issues.push({ name: "规则适用性依据", detail: `不适用、待补充、待用户裁决或受控执行必须给出业务依据或门禁：${invalidRationale.map((rule) => rule.ruleId).join("、")}。` });
  const missingEvidence = records.filter((rule) => rule.applicability === "适用" && !evidenceIsValid(rule));
  if (missingEvidence.length) issues.push({ name: "规则设计证据", detail: `适用规则缺少对应设计证据（决策表、等价类/边界、状态迁移、交互断言或异常/恢复路径）：${missingEvidence.map((rule) => rule.ruleId).join("、")}。` });
  const missingCases = records.filter((rule) => ["适用", "受控执行"].includes(rule.applicability) && rule.caseIds.length === 0);
  if (missingCases.length) issues.push({ name: "适用规则关联", detail: `适用或受控执行规则必须关联 caseId：${missingCases.map((rule) => rule.ruleId).join("、")}。` });
  const invalidControlled = records.filter((rule) => rule.applicability === "受控执行" && rule.coverageStatus !== "受控执行");
  if (invalidControlled.length) issues.push({ name: "受控执行规则", detail: `受控执行必须使用“受控执行”覆盖状态：${invalidControlled.map((rule) => rule.ruleId).join("、")}。` });
  const invalidNonApplicable = records.filter((rule) => rule.applicability === "不适用" && rule.coverageStatus !== "不适用");
  if (invalidNonApplicable.length) issues.push({ name: "不适用规则", detail: `不适用规则必须使用“不适用”覆盖状态：${invalidNonApplicable.map((rule) => rule.ruleId).join("、")}。` });

  const ruleById = new Map(records.map((rule) => [rule.ruleId, rule]));
  const caseById = new Map(cases.map((item) => [item.caseId, item]));
  const unmappedCases = cases.filter((item) => item.ruleIds.length === 0).map((item) => item.caseId);
  if (unmappedCases.length) issues.push({ name: "用例规则回链", detail: `每个原子用例必须关联至少一条 RULE：${unmappedCases.join("、")}。` });
  const unknownRules = cases.flatMap((item) => item.ruleIds.filter((id) => !ruleById.has(id)).map((id) => `${item.caseId} → ${id}`));
  if (unknownRules.length) issues.push({ name: "用例规则存在性", detail: `用例引用了不存在的 RULE：${unknownRules.join("、")}。` });
  const missingCaseTargets = records.flatMap((rule) => rule.caseIds.filter((caseId) => !caseById.has(caseId)).map((caseId) => `${rule.ruleId} → ${caseId}`));
  if (missingCaseTargets.length) issues.push({ name: "规则用例存在性", detail: `规则台账关联了不存在的 caseId：${missingCaseTargets.join("、")}。` });
  const inconsistent = records.flatMap((rule) => rule.caseIds.filter((caseId) => !caseById.get(caseId)?.ruleIds.includes(rule.ruleId)).map((caseId) => `${rule.ruleId} → ${caseId}`))
    .concat(cases.flatMap((item) => item.ruleIds.filter((ruleId) => !ruleById.get(ruleId)?.caseIds.includes(item.caseId)).map((ruleId) => `${item.caseId} → ${ruleId}`)));
  if (inconsistent.length) issues.push({ name: "RULE ↔ caseId 双向追溯", detail: `规则台账和用例字段不一致：${unique(inconsistent).join("、")}。` });
  return issues;
}

export function summarizeRuleCoverage(plan: string): string {
  const records = parseRuleRecords(plan);
  const count = (predicate: (rule: RuleRecord) => boolean) => records.filter(predicate).length;
  const typeSummary = RULE_TYPES.map((type) => {
    const applicable = records.filter((rule) => rule.type === type && rule.applicability === "适用");
    const gaps = applicable.filter((rule) => rule.caseIds.length === 0 || !evidenceIsValid(rule)).length;
    return `${type}:适用${applicable.length}/缺口${gaps}`;
  }).join("，");
  return `适用规则 ${count((rule) => rule.applicability === "适用")}；已覆盖 ${count((rule) => rule.coverageStatus === "已覆盖")}；受控执行 ${count((rule) => rule.coverageStatus === "受控执行")}；待用户裁决 ${count((rule) => rule.coverageStatus === "待用户裁决")}；不适用 ${count((rule) => rule.coverageStatus === "不适用")}；无映射规则 ${count((rule) => ["适用", "受控执行"].includes(rule.applicability) && rule.caseIds.length === 0)}；按规则类型：${typeSummary}。`;
}
