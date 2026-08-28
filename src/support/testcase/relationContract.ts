export const CURRENT_RULE_LEDGER_MARKER = "rule-design-ledger-v1" as const;
export const CURRENT_RELATION_PROJECTION_MARKER = "case-relation-projection-v1" as const;

const ruleLedgerPattern = /\b(?:rule-coverage|rule-design-ledger)-v\d+(?:-[a-z0-9]+)*\b/gu;
const relationProjectionPattern = /\bcase-relation-projection-v\d+(?:-[a-z0-9]+)*\b/gu;

function uniqueMatches(value: string, pattern: RegExp): string[] {
  pattern.lastIndex = 0;
  return [...new Set(value.match(pattern) ?? [])];
}

export function declaredRuleLedgerMarkers(plan: string): string[] {
  return uniqueMatches(plan, ruleLedgerPattern);
}

export function declaredRelationProjectionMarkers(plan: string): string[] {
  return uniqueMatches(plan, relationProjectionPattern);
}

export function ruleLedgerContractIssues(plan: string): string[] {
  const declared = declaredRuleLedgerMarkers(plan);
  if (declared.length === 0) return [`缺少 ${CURRENT_RULE_LEDGER_MARKER}；当前请求必须使用唯一规则台账契约。`];
  if (declared.length > 1) return [`规则台账契约不唯一：${declared.join("、")}。`];
  return declared[0] === CURRENT_RULE_LEDGER_MARKER
    ? []
    : [`不支持规则台账契约 ${declared[0]}；当前请求必须使用 ${CURRENT_RULE_LEDGER_MARKER}。`];
}

export function relationProjectionContractIssues(plan: string): string[] {
  const declared = declaredRelationProjectionMarkers(plan);
  if (declared.length === 0) return [`缺少 ${CURRENT_RELATION_PROJECTION_MARKER}；当前请求必须使用唯一关系投影契约。`];
  if (declared.length > 1) return [`关系投影契约不唯一：${declared.join("、")}。`];
  return declared[0] === CURRENT_RELATION_PROJECTION_MARKER
    ? []
    : [`不支持关系投影契约 ${declared[0]}；当前请求必须使用 ${CURRENT_RELATION_PROJECTION_MARKER}。`];
}
