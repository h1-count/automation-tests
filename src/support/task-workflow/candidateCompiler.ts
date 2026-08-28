import { createHash } from "node:crypto";
import { canonicalJson } from "./canonicalJson.js";
import {
  CANDIDATE_FRAGMENT_MANIFEST_SCHEMA_VERSION,
  type CandidateFragmentManifest,
  type CandidateFragmentModule
} from "./candidateFragments.js";
import { parseCandidatePlanClauses, type CandidatePlanClause } from "./candidatePreflight.js";
import { parseRuleCaseRecords } from "../testcase/relationProjection.js";
import { markdownSection, markdownTableRows } from "../testcase/relationProjection.js";
import { parseRuleLedger } from "../test-suite/designSuite.js";
import type { SafeJsonValue } from "./types.js";

export const CANDIDATE_COMPILER_SPEC_SCHEMA_VERSION = "candidate-compiler-spec-v1" as const;
export const COMPILABLE_ARCHETYPES = [
  "required_field", "format", "range", "enum", "conditional_enum", "permission",
  "page_structure", "selection_constraint", "display", "pagination"
] as const;
export type CompilableArchetype = (typeof COMPILABLE_ARCHETYPES)[number];
export type CandidateClauseMode = "deterministic" | "model";

export interface CandidateCompilerExample { dataId: string; data: string; expected: string; }
export interface CandidateCompilerClause {
  clauseId: string;
  generationMode: CandidateClauseMode;
  archetype?: CompilableArchetype;
  title?: string;
  priority?: "P0" | "P1" | "P2";
  risk?: "低" | "中" | "高";
  preconditions?: string;
  field?: string;
  triggerAction?: string;
  validData?: string;
  validExpected?: string;
  examples?: CandidateCompilerExample[];
}
export interface CandidateCompilerSpec {
  schemaVersion: typeof CANDIDATE_COMPILER_SPEC_SCHEMA_VERSION;
  scope: "full" | "affected";
  clauses: CandidateCompilerClause[];
  impactClosureDigest?: string;
  designDeltaDigest?: string;
  baselineVersion?: string;
}

const clausePattern = /^CLAUSE-[A-Z0-9]+(?:-[A-Z0-9]+)+$/u;
const digestPattern = /^[a-f0-9]{64}$/u;
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const concrete = (value: string): boolean => Boolean(value) && !/(?:待填写|待补充|<[^>]+>)/u.test(value);
const safeData = (value: string): boolean => !/(?:-----BEGIN|\bsk-[A-Za-z0-9_-]{12,}|\b(?:token|secret|password)\s*[:=])/iu.test(value);

function example(value: unknown): CandidateCompilerExample {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Compiler clause examples must be objects.");
  const item = value as Record<string, unknown>;
  const result = { dataId: text(item.dataId), data: text(item.data), expected: text(item.expected) };
  if (!/^D(?:0[1-9]|[1-9]\d)$/u.test(result.dataId) || !concrete(result.data) || !concrete(result.expected) || !safeData(result.data)) {
    throw new Error("Compiler clause examples require safe D01-D99 data and observable expectations.");
  }
  return result;
}

export function parseCandidateCompilerSpec(content: string): CandidateCompilerSpec {
  let raw: unknown;
  try { raw = JSON.parse(content); } catch { throw new Error("Candidate compiler spec must be valid JSON."); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Candidate compiler spec must be an object.");
  const root = raw as Record<string, unknown>;
  if (root.schemaVersion !== CANDIDATE_COMPILER_SPEC_SCHEMA_VERSION || (root.scope !== "full" && root.scope !== "affected")) {
    throw new Error(`Candidate compiler spec must use ${CANDIDATE_COMPILER_SPEC_SCHEMA_VERSION} and a valid scope.`);
  }
  if (["rules", "ruleId", "caseId", "caseIds", "sourceRef", "sourceRefs", "moduleId", "modules", "fragmentPath"].some((key) => root[key] !== undefined)) {
    throw new Error("Candidate compiler spec may not declare RULE, case, source, module, or path ownership.");
  }
  if (!Array.isArray(root.clauses) || !root.clauses.length) throw new Error("Candidate compiler spec requires clauses.");
  const seen = new Set<string>();
  const clauses = root.clauses.map((value): CandidateCompilerClause => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Compiler clause must be an object.");
    const item = value as Record<string, unknown>;
    if (["ruleId", "caseId", "caseIds", "sourceRef", "sourceRefs", "moduleId", "fragmentPath"].some((key) => item[key] !== undefined)) {
      throw new Error("Compiler clause may not declare derived RULE, case, source, module, or path ownership.");
    }
    const generationMode = text(item.generationMode) as CandidateClauseMode;
    const examples = item.examples === undefined ? undefined : Array.isArray(item.examples) ? item.examples.map(example) : (() => { throw new Error("Compiler clause examples must be an array."); })();
    const clause: CandidateCompilerClause = {
      clauseId: text(item.clauseId), generationMode,
      ...(text(item.archetype) ? { archetype: text(item.archetype) as CompilableArchetype } : {}),
      ...(text(item.title) ? { title: text(item.title) } : {}),
      ...(text(item.priority) ? { priority: text(item.priority) as CandidateCompilerClause["priority"] } : {}),
      ...(text(item.risk) ? { risk: text(item.risk) as CandidateCompilerClause["risk"] } : {}),
      ...(text(item.preconditions) ? { preconditions: text(item.preconditions) } : {}),
      ...(text(item.field) ? { field: text(item.field) } : {}),
      ...(text(item.triggerAction) ? { triggerAction: text(item.triggerAction) } : {}),
      ...(text(item.validData) ? { validData: text(item.validData) } : {}),
      ...(text(item.validExpected) ? { validExpected: text(item.validExpected) } : {}),
      ...(examples ? { examples } : {})
    };
    if (!clausePattern.test(clause.clauseId) || seen.has(clause.clauseId) || !["deterministic", "model"].includes(generationMode)) {
      throw new Error(`Compiler clause ${clause.clauseId || "<unknown>"} has invalid ownership.`);
    }
    seen.add(clause.clauseId);
    if (generationMode === "model") {
      if (clause.archetype || clause.examples) throw new Error(`Model clause ${clause.clauseId} cannot contain compiler-only content.`);
      return clause;
    }
    if (!clause.archetype || !COMPILABLE_ARCHETYPES.includes(clause.archetype)
      || !clause.title || !["P0", "P1", "P2"].includes(clause.priority ?? "") || !["低", "中", "高"].includes(clause.risk ?? "")
      || !concrete(clause.preconditions ?? "") || !concrete(clause.field ?? "") || !concrete(clause.triggerAction ?? "")
      || !clause.examples?.length || !concrete(clause.validData ?? "") || !concrete(clause.validExpected ?? "") || !safeData(clause.validData ?? "")) {
      throw new Error(`Deterministic compiler clause ${clause.clauseId} is missing required semantic bindings.`);
    }
    return clause;
  });
  for (const key of ["impactClosureDigest", "designDeltaDigest"] as const) {
    if (root[key] !== undefined && !digestPattern.test(text(root[key]))) throw new Error(`${key} must be a SHA-256 digest.`);
  }
  if (root.scope === "affected" && (!digestPattern.test(text(root.impactClosureDigest)) || !digestPattern.test(text(root.designDeltaDigest)) || !concrete(text(root.baselineVersion)))) {
    throw new Error("Affected compiler specs require closure, delta, and baseline bindings.");
  }
  return { schemaVersion: CANDIDATE_COMPILER_SPEC_SCHEMA_VERSION, scope: root.scope, clauses,
    ...(root.impactClosureDigest === undefined ? {} : { impactClosureDigest: text(root.impactClosureDigest) }),
    ...(root.designDeltaDigest === undefined ? {} : { designDeltaDigest: text(root.designDeltaDigest) }),
    ...(root.baselineVersion === undefined ? {} : { baselineVersion: text(root.baselineVersion) }) };
}

export function candidateCompilerSpecDigest(spec: CandidateCompilerSpec): string {
  return createHash("sha256").update(canonicalJson(spec as unknown as SafeJsonValue), "utf8").digest("hex");
}

export function validateCandidateCompilerSpecAgainstPlan(spec: CandidateCompilerSpec, plan: string): CandidatePlanClause[] {
  const clauses = parseCandidatePlanClauses(plan);
  if (clauses.length !== spec.clauses.length || new Set(clauses.map((item) => item.clauseId)).size !== clauses.length
    || spec.clauses.some((item) => !clauses.some((clause) => clause.clauseId === item.clauseId))) {
    throw new Error("Candidate compiler spec must propose every frozen clause exactly once.");
  }
  const byClause = new Map(spec.clauses.map((item) => [item.clauseId, item]));
  const modesByCase = new Map<string, Set<CandidateClauseMode>>();
  for (const clause of clauses) {
    const modes = modesByCase.get(clause.caseId) ?? new Set<CandidateClauseMode>();
    modes.add(byClause.get(clause.clauseId)!.generationMode);
    modesByCase.set(clause.caseId, modes);
  }
  if ([...modesByCase.values()].some((modes) => modes.size !== 1)) throw new Error("Frozen caseId cannot mix deterministic and model clauses.");
  const rows = markdownTableRows(markdownSection(plan, "## 规则设计台账"));
  const header = rows.find((row) => row.includes("RULE") && row.includes("风险 / 门禁"));
  const rulePolicy = new Map(header ? rows.slice(rows.indexOf(header) + 1)
    .filter((row) => /^RULE-/u.test((row[header.indexOf("RULE")] ?? "").trim()))
    .map((row) => [row[header.indexOf("RULE")]!.trim(), (row[header.indexOf("风险 / 门禁")] ?? "").trim()]) : []);
  const observation = new Set<CompilableArchetype>(["page_structure", "selection_constraint", "display", "pagination"]);
  for (const proposal of spec.clauses) {
    if (proposal.generationMode !== "deterministic" || !proposal.archetype || !observation.has(proposal.archetype)) continue;
    const clause = clauses.find((item) => item.clauseId === proposal.clauseId)!;
    if (!/(?:^|；|\s)no_write(?:$|；|\s)/u.test(rulePolicy.get(clause.ruleId) ?? "")) {
      throw new Error(`Observation compiler clause ${proposal.clauseId} requires a no_write RULE policy.`);
    }
  }
  return clauses;
}

function casePrefix(caseIds: string[]): string {
  const parts = caseIds[0]!.split("-"); let count = 0;
  for (const [index, part] of parts.entries()) { if (!caseIds.every((caseId) => caseId.split("-")[index] === part)) break; count = index + 1; }
  const common = parts.slice(0, count); return (caseIds.some((caseId) => caseId.split("-").length === common.length) ? common.slice(0, -1) : common).join("-");
}

export function candidateCompilerManifest(spec: CandidateCompilerSpec, plan: string): CandidateFragmentManifest {
  const clauses = validateCandidateCompilerSpecAgainstPlan(spec, plan);
  const specByClause = new Map(spec.clauses.map((item) => [item.clauseId, item]));
  const casesByRule = new Map(parseRuleCaseRecords(plan).map((item) => [item.id, [...item.caseIds].sort()]));
  const sourcesByRule = new Map(parseRuleLedger(plan).map((item) => [item.ruleId, item.sourceRefs]));
  // A case-only connected component turns a suite with one RULE per case into
  // one model activity per case. Keep each stable case-prefix domain together
  // (OPEN-LOGIN, OPEN-REG, ...); multi-domain rules stay isolated.
  const grouped = new Map<string, string[]>();
  for (const ruleId of [...casesByRule.keys()].sort()) {
    const prefixes = [...new Set((casesByRule.get(ruleId) ?? []).map((caseId) => casePrefix([caseId])))];
    const key = prefixes.length === 1 ? `domain:${prefixes[0]}` : `rule:${ruleId}`;
    grouped.set(key, [...(grouped.get(key) ?? []), ruleId]);
  }
  const groups = [...grouped.values()].map((ruleIds) => ruleIds.sort())
    .sort((left, right) => casePrefix([...new Set(left.flatMap((ruleId) => casesByRule.get(ruleId) ?? []))])
      .localeCompare(casePrefix([...new Set(right.flatMap((ruleId) => casesByRule.get(ruleId) ?? []))])));
  const modules = groups.map((ruleIds): CandidateFragmentModule => {
    const caseIds = [...new Set(ruleIds.flatMap((ruleId) => casesByRule.get(ruleId) ?? []))].sort();
    const localClauses = clauses.filter((clause) => ruleIds.includes(clause.ruleId));
    const caseGeneration = caseIds.map((caseId) => {
      const entries = localClauses.filter((clause) => clause.caseId === caseId);
      const mode = specByClause.get(entries[0]!.clauseId)!.generationMode;
      return { caseId, clauseIds: entries.map((entry) => entry.clauseId).sort(), mode };
    });
    const deterministicCaseIds = caseGeneration.filter((item) => item.mode === "deterministic").map((item) => item.caseId);
    const modelCaseIds = caseGeneration.filter((item) => item.mode === "model").map((item) => item.caseId);
    const deterministicClauseIds = caseGeneration.filter((item) => item.mode === "deterministic").flatMap((item) => item.clauseIds).sort();
    const modelClauseIds = caseGeneration.filter((item) => item.mode === "model").flatMap((item) => item.clauseIds).sort();
    const prefix = casePrefix(caseIds);
    return {
      id: `module-${createHash("sha256").update(canonicalJson(ruleIds as unknown as SafeJsonValue)).digest("hex").slice(0, 12)}`,
      title: `模块 ${prefix}`, ruleIds, caseIds,
      ruleCaseIds: ruleIds.map((ruleId) => ({ ruleId, caseIds: casesByRule.get(ruleId)! })), casePrefix: prefix,
      sourceRefs: [...new Set(ruleIds.flatMap((ruleId) => sourcesByRule.get(ruleId) ?? []))].sort(),
      generationMode: deterministicCaseIds.length && modelCaseIds.length ? "mixed" : deterministicCaseIds.length ? "deterministic" : "model",
      deterministicRuleIds: ruleIds.filter((ruleId) => clauses.filter((item) => item.ruleId === ruleId).every((item) => specByClause.get(item.clauseId)!.generationMode === "deterministic")),
      modelRuleIds: ruleIds.filter((ruleId) => clauses.filter((item) => item.ruleId === ruleId).every((item) => specByClause.get(item.clauseId)!.generationMode === "model")),
      caseGeneration, deterministicCaseIds, modelCaseIds, deterministicClauseIds, modelClauseIds
    };
  });
  return { schemaVersion: CANDIDATE_FRAGMENT_MANIFEST_SCHEMA_VERSION, scope: spec.scope, modules };
}

function expectedRules(module: CandidateFragmentModule, caseId: string): string[] {
  return module.ruleCaseIds.filter((item) => item.caseIds.includes(caseId)).map((item) => item.ruleId).sort();
}
function rows(clause: CandidateCompilerClause): Array<CandidateCompilerExample & { action: string }> {
  const action = ["page_structure", "selection_constraint", "display", "pagination"].includes(clause.archetype!)
    ? `查看${clause.field}并${clause.triggerAction}` : clause.archetype === "conditional_enum"
      ? `在${clause.field}执行条件选择并${clause.triggerAction}` : `在${clause.field}输入测试数据并${clause.triggerAction}`;
  return [{ dataId: "D01", data: clause.validData!, expected: clause.validExpected! }, ...clause.examples!]
    .map((item, index) => ({ ...item, dataId: `D${String(index + 1).padStart(2, "0")}`, expected: item.expected, data: item.data, action }));
}
function details(module: CandidateFragmentModule, caseId: string, clauses: CandidateCompilerClause[]): string {
  const primary = clauses[0]!; const renderedRows = clauses.flatMap(rows);
  return ["<details>", `<summary>${caseId}｜${primary.title}｜${primary.priority}｜${primary.risk}风险</summary>`, "",
    `> 规则：${expectedRules(module, caseId).join("、")}`, `> 前置条件：${primary.preconditions}`, `> 差异：来源=${module.sourceRefs.join("、")}`, "",
    "| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |", "| --- | --- | --- | --- | --- |",
    ...renderedRows.map((row) => `| ${renderedRows.length === 1 ? "—" : row.dataId} | 1 | ${row.action} | ${row.data} | ${row.expected} |`), "", "</details>"].join("\n");
}

export function renderDeterministicCandidateFragment(spec: CandidateCompilerSpec, manifest: CandidateFragmentManifest, moduleId: string): string {
  const module = manifest.modules.find((item) => item.id === moduleId);
  if (!module?.deterministicCaseIds?.length) throw new Error(`Compiler module ${moduleId} has no deterministic cases.`);
  const planClauses = new Map(spec.clauses.map((item) => [item.clauseId, item]));
  const blocks = module.deterministicCaseIds.map((caseId) => {
    const clauseIds = module.caseGeneration!.find((item) => item.caseId === caseId)!.clauseIds;
    return details(module, caseId, clauseIds.map((id) => planClauses.get(id)!));
  });
  return `## 模块：${module.title}\n\n${blocks.join("\n\n")}\n`;
}

function caseBlocks(content: string): Array<{ caseId: string; block: string }> {
  return [...content.matchAll(/<details(?:\s+open)?>([\s\S]*?)<\/details>/gu)].map((match) => ({
    caseId: /<summary>\s*([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\s*｜/u.exec(match[1] ?? "")?.[1] ?? "", block: match[0]
  }));
}
export function mergeCandidateCompilerFragment(spec: CandidateCompilerSpec, manifest: CandidateFragmentManifest, moduleId: string, modelContent: string): string {
  const module = manifest.modules.find((item) => item.id === moduleId);
  if (!module?.modelCaseIds?.length) throw new Error(`Compiler module ${moduleId} has no model cases.`);
  const heading = new RegExp(`^##\\s+模块[：:]\\s*${module.title.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*$`, "mu");
  if (!heading.test(modelContent) || (modelContent.match(/^##\s+模块[：:]/gmu) ?? []).length !== 1) throw new Error(`Model fragment ${moduleId} must contain exactly one frozen module heading.`);
  const blocks = caseBlocks(modelContent); const ids = blocks.map((item) => item.caseId).sort();
  if (ids.length !== module.modelCaseIds.length || ids.some((id, index) => id !== module.modelCaseIds![index])) throw new Error(`Model fragment ${moduleId} may publish only frozen model caseIds.`);
  for (const item of blocks) {
    const line = /^>\s*规则：([^\n]+)$/mu.exec(item.block)?.[1] ?? "";
    const actual = line.split("、").map((value) => value.trim()).filter(Boolean).sort();
    const expected = expectedRules(module, item.caseId);
    if (actual.join("|") !== expected.join("|")) throw new Error(`Model fragment ${moduleId} changed frozen RULE/case relations.`);
  }
  const deterministic = module.deterministicCaseIds?.length ? renderDeterministicCandidateFragment(spec, manifest, moduleId).replace(/^##[^\n]+\n*/u, "").trim() : "";
  const modelDetails = modelContent.replace(/^##[^\n]+\n*/u, "").trim();
  return `## 模块：${module.title}\n\n${[deterministic, modelDetails].filter(Boolean).join("\n\n")}\n`;
}
