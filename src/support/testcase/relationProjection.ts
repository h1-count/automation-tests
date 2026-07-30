export const CASE_RELATION_PROJECTION_MARKER = "结构版本：case-relation-projection-v1";
export const RULE_DESIGN_MATRIX_MARKER = "结构版本：rule-design-matrix-v1";

export type RelationIssue = { name: string; detail: string };
export type RuleCaseRecord = { id: string; reqIds: string[]; type: string; applicability: string; caseIds: string[] };
export type RuleDesignRecord = { id: string; caseIds: string[]; rawCaseIds: string };
export type RuleDesignDetail = RuleDesignRecord & { fieldOrState: string; requiredness: string; inputs: string; observableExpectation: string; dataPrecondition: string; executionGate: string; conclusion: string };
export type RelationProjection = { plan: string; packages: Record<string, string>; issues: RelationIssue[] };

const casePattern = /\b[A-Z][A-Z0-9]+(?:-[A-Z0-9]+){2,}\b/g;
const rulePattern = /\bRULE-[A-Z0-9]+(?:-[A-Z0-9]+)+\b/g;
const reqPattern = /\bREQ-[A-Z0-9]+(?:-[A-Z0-9]+)+\b/g;

function ids(value: string, pattern: RegExp): string[] {
  pattern.lastIndex = 0;
  return [...new Set(value.match(pattern) ?? [])].sort();
}

export function parseCaseIds(value: string): string[] {
  return ids(value, casePattern).filter((id) => !/^(?:REQ|RULE)-/.test(id));
}

export function markdownSection(content: string, heading: string): string {
  const start = content.indexOf(heading);
  if (start < 0) return "";
  const end = content.indexOf("\n## ", start + heading.length);
  return content.slice(start, end < 0 ? undefined : end);
}

export function markdownTableRows(content: string): string[][] {
  return content.split("\n")
    .filter((line) => line.trim().startsWith("|") && !/^\|\s*:?-{3,}/.test(line.trim()))
    .map(splitMarkdownTableRow);
}

/** Splits a Markdown table row while preserving escaped pipes in cell content. */
export function splitMarkdownTableRow(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  for (const character of line.trim()) {
    if (escaped) { cell += character; escaped = false; continue; }
    if (character === "\\") { cell += character; escaped = true; continue; }
    if (character === "|") { cells.push(cell.trim()); cell = ""; continue; }
    cell += character;
  }
  cells.push(cell.trim());
  return cells.slice(1, -1);
}

export function parseRuleCaseRecords(plan: string): RuleCaseRecord[] {
  return markdownTableRows(markdownSection(plan, "## 规则覆盖台账"))
    .filter((cells) => /^RULE-/.test(cells[0] ?? ""))
    .map((cells) => ({ id: ids(cells[0] ?? "", rulePattern)[0] ?? "", reqIds: ids(cells[1] ?? "", reqPattern), type: cells[3] ?? "", applicability: cells[7] ?? "", caseIds: parseCaseIds(cells[9] ?? "") }));
}

export function parseRuleDesignRecords(plan: string): RuleDesignRecord[] {
  return markdownTableRows(markdownSection(plan, "## 规则设计矩阵"))
    .filter((cells) => /^RULE-/.test(cells[0] ?? ""))
    .map((cells) => ({ id: ids(cells[0] ?? "", rulePattern)[0] ?? "", caseIds: parseCaseIds(cells[7] ?? ""), rawCaseIds: (cells[7] ?? "").trim() }));
}

export function parseRuleDesignDetails(plan: string): RuleDesignDetail[] {
  return markdownTableRows(markdownSection(plan, "## 规则设计矩阵"))
    .filter((cells) => /^RULE-/.test(cells[0] ?? ""))
    .map((cells) => ({ id: ids(cells[0] ?? "", rulePattern)[0] ?? "", fieldOrState: cells[1] ?? "", requiredness: cells[2] ?? "", inputs: cells[3] ?? "", observableExpectation: cells[4] ?? "", dataPrecondition: cells[5] ?? "", executionGate: cells[6] ?? "", caseIds: parseCaseIds(cells[7] ?? ""), rawCaseIds: (cells[7] ?? "").trim(), conclusion: cells[8] ?? "" }));
}

function isConcreteRuleDesignValue(value: string): boolean {
  const normalized = value.replace(/`/g, "").trim();
  return normalized.length > 0
    && !["无", "待填写", "待补充", "未知", "已定义校验", "符合预期", "功能正常"].includes(normalized);
}

/** Validates the auditability of all applicable/controlled rule designs. */
export function validateRuleDesignMatrix(plan: string): RelationIssue[] {
  if (!plan.includes(RULE_DESIGN_MATRIX_MARKER)) {
    return [{ name: "规则设计矩阵", detail: "缺少 rule-design-matrix-v1 规则设计矩阵。" }];
  }
  const designs = new Map(parseRuleDesignDetails(plan).map((record) => [record.id, record]));
  const rules = parseRuleCaseRecords(plan);
  const issues: RelationIssue[] = [];
  for (const rule of rules.filter((record) => ["适用", "受控执行"].includes(record.applicability))) {
    const design = designs.get(rule.id);
    if (!design) { issues.push({ name: "规则设计矩阵", detail: `${rule.id} 缺少规则设计矩阵记录。` }); continue; }
    if (!/必填|选填|不适用/.test(design.requiredness)) issues.push({ name: "规则设计矩阵", detail: `${rule.id} 未声明必填/选填性。` });
    if (!isConcreteRuleDesignValue(design.inputs) || !isConcreteRuleDesignValue(design.observableExpectation)) issues.push({ name: "规则设计矩阵", detail: `${rule.id} 缺少具体输入或可观察预期。` });
    if (!isConcreteRuleDesignValue(design.dataPrecondition)) issues.push({ name: "规则设计矩阵", detail: `${rule.id} 缺少数据前置。` });
    if (!isConcreteRuleDesignValue(design.executionGate)) issues.push({ name: "规则设计矩阵", detail: `${rule.id} 缺少执行门禁。` });
    if (!isConcreteRuleDesignValue(design.rawCaseIds)) issues.push({ name: "规则设计矩阵", detail: `${rule.id} 缺少关联 caseId 或阶段状态。` });
    if (design.rawCaseIds === "阶段二生成" && rule.caseIds.length > 0) issues.push({ name: "规则设计矩阵", detail: `${rule.id} 的 RULE 台账已有 caseId，规则设计矩阵不得保留阶段二生成。` });
    if (design.rawCaseIds !== "阶段二生成" && (design.caseIds.length !== rule.caseIds.length || design.caseIds.some((id, index) => id !== rule.caseIds[index]))) issues.push({ name: "规则设计矩阵", detail: `${rule.id} 的规则设计 caseId 与 RULE 台账不一致。` });
    if (!["已覆盖", "受控执行", "用户裁决", "不适用"].includes(design.conclusion)) issues.push({ name: "规则设计矩阵", detail: `${rule.id} 缺少有效设计结论。` });
  }
  return issues;
}

export function validateRelationProjection(plan: string, packages: Record<string, string>): RelationIssue[] {
  const rules = parseRuleCaseRecords(plan);
  const designs = new Map(parseRuleDesignRecords(plan).map((value) => [value.id, value]));
  const requestIds = new Set(markdownTableRows(markdownSection(plan, "## 需求追溯矩阵")).flatMap((row) => ids(row[0] ?? "", reqPattern)));
  const bodies = Object.values(packages).flatMap((content) => content.split(/^## 测试用例：/m).slice(1).flatMap((block) => {
    const match = block.match(/^\s*\|\s*用例编号\s*\|\s*(.*?)\s*\|\s*$/m);
    return parseCaseIds(match?.[1] ?? "");
  }));
  const caseSet = new Set(bodies);
  const issues: RelationIssue[] = [];
  const duplicates = [...new Set(bodies.filter((caseId, index) => bodies.indexOf(caseId) !== index))];
  if (duplicates.length) {
    issues.push({ name: "caseId 唯一性", detail: `重复 caseId：${duplicates.join("、")}` });
  }
  for (const rule of rules) {
    if (!rule.reqIds.length) issues.push({ name: "RULE 关系源", detail: `${rule.id} 没有关联任何 REQ。` });
    for (const reqId of rule.reqIds) if (!requestIds.has(reqId)) issues.push({ name: "RULE 关系源", detail: `${rule.id} 关联的 ${reqId} 不存在。` });
    if (bodies.length && ["适用", "受控执行"].includes(rule.applicability) && !rule.caseIds.length) issues.push({ name: "RULE 关系源", detail: `${rule.id} 在已生成原子用例后缺少有效 RULE → caseId。` });
    for (const caseId of rule.caseIds) if (!caseSet.has(caseId)) issues.push({ name: "RULE 关系源", detail: `${rule.id} → ${caseId} 不存在。` });
    const design = designs.get(rule.id);
    if (!design) { issues.push({ name: "规则设计关系源", detail: `${rule.id} 缺少规则设计矩阵记录。` }); continue; }
    if (bodies.length && design.rawCaseIds === "阶段二生成") issues.push({ name: "规则设计关系源", detail: `${rule.id} 在已生成原子用例后仍为阶段二生成。` });
    if (design.rawCaseIds !== "阶段二生成" && (design.caseIds.length !== rule.caseIds.length || design.caseIds.some((id, index) => id !== rule.caseIds[index]))) issues.push({ name: "规则设计关系源", detail: `${rule.id} 的规则设计 caseId 与唯一 RULE 台账不一致。` });
  }
  for (const caseId of caseSet) if (!rules.some((rule) => rule.caseIds.includes(caseId))) issues.push({ name: "RULE 关系源", detail: `${caseId} 没有任何 RULE → caseId 关系。` });
  return issues;
}

function renderCells(cells: string[]): string { return `| ${cells.join(" | ")} |`; }

function rewriteColumn(content: string, heading: string, column: string, derive: (cells: string[]) => string): string {
  const start = content.indexOf(heading);
  if (start < 0) return content;
  const end = content.indexOf("\n## ", start + heading.length);
  const before = content.slice(0, start);
  const lines = content.slice(start, end < 0 ? undefined : end).split("\n");
  const header = lines.findIndex((line) => line.includes(`| ${column} |`));
  if (header < 0) return content;
  const columns = splitMarkdownTableRow(lines[header]!);
  const target = columns.indexOf(column);
  if (target < 0) return content;
  for (let index = header + 2; index < lines.length && lines[index]!.trim().startsWith("|"); index += 1) {
    const cells = splitMarkdownTableRow(lines[index]!);
    if (cells.length === columns.length) { cells[target] = derive(cells); lines[index] = renderCells(cells); }
  }
  return before + lines.join("\n") + (end < 0 ? "" : content.slice(end));
}

function ruleDomains(type: string): string[] {
  return ({ "业务规则": ["业务功能与规则"], "分支/决策": ["业务功能与规则"], "输入边界": ["输入与数据校验"], "异常与恢复": ["异常、容错与恢复"], "状态流转": ["状态与生命周期"], "页面交互": ["交互、视觉与无障碍"], "权限/身份": ["权限、身份与审计"], "集成与数据一致性": ["数据完整性与一致性", "接口、集成与契约"] } as Record<string, string[]>)[type] ?? [];
}

function rewriteCaseFields(content: string, rules: Map<string, string[]>, requirements: Map<string, string[]>): string {
  const caseId = parseCaseIds(content.match(/^\|\s*用例编号\s*\|\s*(.*?)\s*\|\s*$/m)?.[1] ?? "")[0];
  if (!caseId) return content;
  const set = (value: string, label: string): string => {
    const pattern = new RegExp(`(\\|\\s*${label}\\s*\\|\\s*)(.*?)(\\s*\\|\\s*$)`, "gm");
    return pattern.test(value) ? value.replace(pattern, (_line, prefix, _old, suffix) => `${prefix}${label === "需求追溯编号" ? requirements.get(caseId)?.join("、") ?? "无" : rules.get(caseId)?.join("、") ?? "无"}${suffix}`) : value.replace(/^(\|\s*用例编号\s*\|.*\|\s*)$/m, `$1\n| ${label} | ${label === "需求追溯编号" ? requirements.get(caseId)?.join("、") ?? "无" : rules.get(caseId)?.join("、") ?? "无"} |`);
  };
  return set(set(content, "需求追溯编号"), "规则覆盖编号");
}

/** Projects every derived relation view without reading or writing files. */
export function projectRelationProjection(plan: string, packages: Record<string, string>): RelationProjection {
  const rules = parseRuleCaseRecords(plan);
  const rulesByReq = new Map<string, string[]>(), rulesByCase = new Map<string, string[]>(), reqsByCase = new Map<string, string[]>(), domains = new Map<string, string[]>();
  for (const rule of rules) {
    for (const req of rule.reqIds) rulesByReq.set(req, [...new Set([...(rulesByReq.get(req) ?? []), ...rule.caseIds])].sort());
    for (const caseId of rule.caseIds) { rulesByCase.set(caseId, [...new Set([...(rulesByCase.get(caseId) ?? []), rule.id])].sort()); reqsByCase.set(caseId, [...new Set([...(reqsByCase.get(caseId) ?? []), ...rule.reqIds])].sort()); }
    for (const domain of ruleDomains(rule.type)) domains.set(domain, [...new Set([...(domains.get(domain) ?? []), ...rule.caseIds])].sort());
  }
  const packageCases = new Map(
    Object.entries(packages).map(([name, value]) => [
      name,
      value.split(/^## 测试用例：/m).slice(1).flatMap((block) =>
        parseCaseIds(block.match(/^\s*\|\s*用例编号\s*\|\s*(.*?)\s*\|\s*$/m)?.[1] ?? "")
      ).sort()
    ])
  );
  let projected = rewriteColumn(plan, "## 需求追溯矩阵", "派生 caseId", (row) => rulesByReq.get(ids(row[0] ?? "", reqPattern)[0] ?? "")?.join("、") ?? "无");
  projected = rewriteColumn(projected, "## 覆盖矩阵", "派生 caseId", (row) => domains.get(row[0] ?? "")?.join("、") ?? "无");
  projected = rewriteColumn(projected, "## 用例包目录", "实际原子用例编号", (row) => packageCases.get((row[0] ?? "").replace(/`/g, ""))?.join("、") ?? "待阶段二生成");
  projected = rewriteColumn(projected, "## 规则设计矩阵", "关联 caseId", (row) => rules.find((rule) => rule.id === ids(row[0] ?? "", rulePattern)[0])?.caseIds.join("、") || "阶段二生成");
  for (const heading of ["### 基准资料与模块映射", "### 拆分清单", "### 测试设计技术与依据"]) {
    projected = rewriteColumn(projected, heading, "派生 caseId", (row) => ids(row.join(" | "), rulePattern).flatMap((ruleId) => rules.find((rule) => rule.id === ruleId)?.caseIds ?? []).filter((id, index, values) => values.indexOf(id) === index).sort().join("、") || "无");
  }
  const projectedPackages = Object.fromEntries(
    Object.entries(packages).map(([name, value]) => [
      name,
      value.replace(
        /(## 测试用例：[\s\S]*?)(?=\n## 测试用例：|$)/g,
        (block) => rewriteCaseFields(block, rulesByCase, reqsByCase)
      )
    ])
  );
  return { plan: projected, packages: projectedPackages, issues: validateRelationProjection(projected, projectedPackages) };
}
