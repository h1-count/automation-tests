import { createHash } from "node:crypto";
import { canonicalJson } from "./canonicalJson.js";
import type { SafeJsonValue } from "./types.js";
import {
  isCurrentTestcaseDocumentVersion,
  parseTestcaseDocument,
  projectTestcaseV6DerivedView,
  validateTestcaseV6Layered
} from "../testcase/testcaseDocument.js";

export const CANDIDATE_FRAGMENT_MANIFEST_SCHEMA_VERSION = "candidate-fragment-manifest-v1" as const;
export type CandidateFragmentGenerationMode = "deterministic" | "model" | "mixed";

export interface CandidateFragmentModule {
  id: string;
  title: string;
  ruleIds: string[];
  caseIds: string[];
  ruleCaseIds: Array<{ ruleId: string; caseIds: string[] }>;
  casePrefix: string;
  sourceRefs: string[];
  generationMode: CandidateFragmentGenerationMode;
  deterministicRuleIds: string[];
  modelRuleIds: string[];
  caseGeneration?: Array<{ caseId: string; clauseIds: string[]; mode: "deterministic" | "model" }>;
  deterministicCaseIds?: string[];
  modelCaseIds?: string[];
  deterministicClauseIds?: string[];
  modelClauseIds?: string[];
}

export interface CandidateFragmentManifest {
  schemaVersion: typeof CANDIDATE_FRAGMENT_MANIFEST_SCHEMA_VERSION;
  scope: "full" | "affected";
  modules: CandidateFragmentModule[];
}

export interface CandidateAssemblyDefaults {
  testType: string;
  environment: string;
  dataStrategy: string;
}

const moduleIdPattern = /^[a-z0-9][a-z0-9-]*$/u;
const ruleIdPattern = /^RULE-[A-Z0-9]+(?:-[A-Z0-9]+)+$/u;
const casePrefixPattern = /^[A-Z][A-Z0-9-]*$/u;

export function parseCandidateFragmentManifest(content: string): CandidateFragmentManifest {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error("Candidate fragment manifest must be valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Candidate fragment manifest must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== CANDIDATE_FRAGMENT_MANIFEST_SCHEMA_VERSION) {
    throw new Error(`Candidate fragment manifest must use ${CANDIDATE_FRAGMENT_MANIFEST_SCHEMA_VERSION}.`);
  }
  if (record.scope !== "full" && record.scope !== "affected") {
    throw new Error("Candidate fragment manifest scope must be full or affected.");
  }
  if (!Array.isArray(record.modules) || record.modules.length === 0) {
    throw new Error("Candidate fragment manifest requires at least one module.");
  }
  const ids = new Set<string>();
  const rules = new Set<string>();
  const cases = new Set<string>();
  const modules = record.modules.map((raw): CandidateFragmentModule => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Candidate fragment module must be an object.");
    }
    const module = raw as Record<string, unknown>;
    const id = typeof module.id === "string" ? module.id : "";
    const title = typeof module.title === "string" ? module.title.trim() : "";
    const casePrefix = typeof module.casePrefix === "string" ? module.casePrefix : "";
    const ruleIds = Array.isArray(module.ruleIds) && module.ruleIds.every((item) => typeof item === "string")
      ? [...new Set(module.ruleIds)].sort()
      : [];
    const caseIds = Array.isArray(module.caseIds) && module.caseIds.every((item) => typeof item === "string")
      ? [...new Set(module.caseIds)].sort()
      : [];
    const ruleCaseIds = Array.isArray(module.ruleCaseIds) ? module.ruleCaseIds.map((item) => {
      const value = item as Record<string, unknown>;
      return {
        ruleId: typeof value?.ruleId === "string" ? value.ruleId : "",
        caseIds: Array.isArray(value?.caseIds) && value.caseIds.every((caseId) => typeof caseId === "string")
          ? [...new Set(value.caseIds)].sort() : []
      };
    }).sort((left, right) => left.ruleId.localeCompare(right.ruleId)) : [];
    const sourceRefs = Array.isArray(module.sourceRefs) && module.sourceRefs.every((item) => typeof item === "string")
      ? [...new Set(module.sourceRefs)].sort()
      : [];
    if (!moduleIdPattern.test(id) || ids.has(id) || !title || !casePrefixPattern.test(casePrefix)) {
      throw new Error(`Candidate fragment module ${id || "<unknown>"} has invalid identity.`);
    }
    if (!ruleIds.length || ruleIds.some((ruleId) => !ruleIdPattern.test(ruleId) || rules.has(ruleId))) {
      throw new Error(`Candidate fragment module ${id} has missing, invalid, or cross-module RULE ownership.`);
    }
    if (!caseIds.length || caseIds.some((caseId) => !caseId.startsWith(`${casePrefix}-`) || cases.has(caseId))
      || ruleCaseIds.length !== ruleIds.length
      || ruleCaseIds.some((entry) => !ruleIds.includes(entry.ruleId) || !entry.caseIds.length
        || entry.caseIds.some((caseId) => !caseIds.includes(caseId)))) {
      throw new Error(`Candidate fragment module ${id} has invalid derived case ownership.`);
    }
    if (!sourceRefs.length || sourceRefs.some((source) => !source.trim())) {
      throw new Error(`Candidate fragment module ${id} requires frozen source references.`);
    }
    const generationMode = module.generationMode;
    const deterministicRuleIds = Array.isArray(module.deterministicRuleIds) && module.deterministicRuleIds.every((item) => typeof item === "string")
      ? [...new Set(module.deterministicRuleIds)].sort()
      : [];
    const modelRuleIds = Array.isArray(module.modelRuleIds) && module.modelRuleIds.every((item) => typeof item === "string")
      ? [...new Set(module.modelRuleIds)].sort()
      : [];
    const hasCaseGeneration = true;
    if (!["deterministic", "model", "mixed"].includes(generationMode as string)
      || deterministicRuleIds.some((ruleId) => !ruleIds.includes(ruleId))
      || modelRuleIds.some((ruleId) => !ruleIds.includes(ruleId))
      || new Set([...deterministicRuleIds, ...modelRuleIds]).size !== ruleIds.length
      || deterministicRuleIds.some((ruleId) => modelRuleIds.includes(ruleId))
      || (generationMode === "deterministic" && modelRuleIds.length)
      || (generationMode === "model" && deterministicRuleIds.length)
      || (generationMode === "mixed" && (!deterministicRuleIds.length || !modelRuleIds.length))) {
      throw new Error(`Candidate fragment module ${id} has invalid compiler generation ownership.`);
    }
    const caseGeneration = Array.isArray(module.caseGeneration) ? module.caseGeneration.map((raw) => {
      const entry = raw as Record<string, unknown>;
      return {
        caseId: typeof entry?.caseId === "string" ? entry.caseId : "",
        clauseIds: Array.isArray(entry?.clauseIds) && entry.clauseIds.every((item) => typeof item === "string")
          ? [...new Set(entry.clauseIds)].sort() : [],
        mode: entry?.mode === "deterministic" || entry?.mode === "model" ? entry.mode : ""
      };
    }).sort((left, right) => left.caseId.localeCompare(right.caseId)) : [];
    const deterministicCaseIds = Array.isArray(module.deterministicCaseIds) && module.deterministicCaseIds.every((item) => typeof item === "string")
      ? [...new Set(module.deterministicCaseIds)].sort() : [];
    const modelCaseIds = Array.isArray(module.modelCaseIds) && module.modelCaseIds.every((item) => typeof item === "string")
      ? [...new Set(module.modelCaseIds)].sort() : [];
    const deterministicClauseIds = Array.isArray(module.deterministicClauseIds) && module.deterministicClauseIds.every((item) => typeof item === "string")
      ? [...new Set(module.deterministicClauseIds)].sort() : [];
    const modelClauseIds = Array.isArray(module.modelClauseIds) && module.modelClauseIds.every((item) => typeof item === "string")
      ? [...new Set(module.modelClauseIds)].sort() : [];
    const allGeneratedCases = [...deterministicCaseIds, ...modelCaseIds].sort();
    const allGeneratedClauses = caseGeneration.flatMap((entry) => entry.clauseIds);
    const partitionedClauses = [...deterministicClauseIds, ...modelClauseIds].sort();
    if (hasCaseGeneration && (caseGeneration.length !== caseIds.length
      || caseGeneration.some((entry) => !caseIds.includes(entry.caseId) || !entry.clauseIds.length || !["deterministic", "model"].includes(entry.mode))
      || new Set(allGeneratedClauses).size !== allGeneratedClauses.length
      || allGeneratedCases.join("|") !== caseIds.join("|")
      || caseGeneration.some((entry) => entry.mode === "deterministic" ? !deterministicCaseIds.includes(entry.caseId) : !modelCaseIds.includes(entry.caseId))
      || partitionedClauses.length !== allGeneratedClauses.length
      || partitionedClauses.join("|") !== [...allGeneratedClauses].sort().join("|")
      || deterministicCaseIds.length > 0 && !deterministicClauseIds.length
      || modelCaseIds.length > 0 && !modelClauseIds.length)) {
      throw new Error(`Candidate fragment module ${id} has invalid v11 case generation ownership.`);
    }
    ids.add(id);
    ruleIds.forEach((ruleId) => rules.add(ruleId));
    caseIds.forEach((caseId) => cases.add(caseId));
    return {
      id,
      title,
      ruleIds,
      caseIds,
      ruleCaseIds,
      casePrefix,
      sourceRefs,
      generationMode: generationMode as CandidateFragmentGenerationMode,
      deterministicRuleIds,
      modelRuleIds,
      ...(hasCaseGeneration ? {
        caseGeneration: caseGeneration as CandidateFragmentModule["caseGeneration"],
        deterministicCaseIds,
        modelCaseIds,
        deterministicClauseIds,
        modelClauseIds
      } : {})
    };
  });
  return {
    schemaVersion: record.schemaVersion as CandidateFragmentManifest["schemaVersion"],
    scope: record.scope,
    modules
  };
}

export function candidateFragmentManifestDigest(manifest: CandidateFragmentManifest): string {
  return createHash("sha256")
    .update(canonicalJson(manifest as unknown as SafeJsonValue), "utf8")
    .digest("hex");
}

export function validateCandidateFragmentContent(
  content: string,
  module: CandidateFragmentModule
): void {
  const moduleHeadings = [...content.matchAll(/^##\s+模块[：:]\s*(.+?)\s*$/gmu)];
  if (!content.trim() || !/^##\s+模块[：:]\s*/u.test(content.trimStart())
    || moduleHeadings.length !== 1 || moduleHeadings[0]?.[1]?.trim() !== module.title) {
    throw new Error(`Candidate fragment ${module.id} must contain one module section.`);
  }
  const mentionedRules = [...content.matchAll(/\bRULE-[A-Z0-9]+(?:-[A-Z0-9]+)+\b/gu)].map((match) => match[0]!);
  if (!mentionedRules.length || mentionedRules.some((ruleId) => !module.ruleIds.includes(ruleId))) {
    throw new Error(`Candidate fragment ${module.id} references a RULE outside its frozen module.`);
  }
  if (!module.ruleIds.every((ruleId) => mentionedRules.includes(ruleId))) {
    throw new Error(`Candidate fragment ${module.id} does not cover every frozen RULE.`);
  }
  const caseIds = [...content.matchAll(/<summary>\s*([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\s*｜/gu)]
    .map((match) => match[1]!);
  if (!caseIds.length || new Set(caseIds).size !== caseIds.length
    || caseIds.some((caseId) => !module.caseIds.includes(caseId))) {
    throw new Error(`Candidate fragment ${module.id} has a caseId outside its frozen prefix.`);
  }
  if (caseIds.length !== module.caseIds.length || module.caseIds.some((caseId) => !caseIds.includes(caseId))) {
    throw new Error(`Candidate fragment ${module.id} does not cover every frozen caseId.`);
  }
  const expectedRulesByCase = new Map(module.caseIds.map((caseId) => [
    caseId,
    module.ruleCaseIds.filter((entry) => entry.caseIds.includes(caseId)).map((entry) => entry.ruleId).sort()
  ]));
  const details = [...content.matchAll(/<details(?:\s+open)?>([\s\S]*?)<\/details>/gu)];
  if (details.length !== caseIds.length) throw new Error(`Candidate fragment ${module.id} has malformed case blocks.`);
  for (const block of details) {
    const caseId = /<summary>\s*([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\s*｜/u.exec(block[1] ?? "")?.[1];
    const ruleLine = /^>\s*规则：([^\n]+)$/mu.exec(block[1] ?? "")?.[1];
    const actualRules = ruleLine ? [...new Set(ruleLine.split("、").map((ruleId) => ruleId.trim()).filter(Boolean))].sort() : [];
    const expectedRules = caseId ? expectedRulesByCase.get(caseId) : undefined;
    if (!caseId || !expectedRules || actualRules.length !== expectedRules.length
      || actualRules.some((ruleId, index) => ruleId !== expectedRules[index])) {
      throw new Error(`Candidate fragment ${module.id} has a case/RULE association outside its frozen relation.`);
    }
  }
}

/**
 * Merges verified module details in skeleton order. The derived summary and
 * index are rebuilt from the detail blocks, so candidate-assemble does not
 * need another model call or a second authoring surface.
 */
export function assembleCandidateFragments(input: {
  manifest: CandidateFragmentManifest;
  fragments: ReadonlyMap<string, string>;
  defaults: CandidateAssemblyDefaults;
}): string {
  const missing = [input.defaults.testType, input.defaults.environment, input.defaults.dataStrategy]
    .some((value) => !value.trim());
  if (missing) throw new Error("Candidate assembly requires complete request defaults.");
  const sections = input.manifest.modules.map((module) => {
    const fragment = input.fragments.get(module.id);
    if (!fragment) throw new Error(`Candidate assembly is missing fragment ${module.id}.`);
    validateCandidateFragmentContent(fragment, module);
    return fragment.trim();
  });
  const content = projectTestcaseV6DerivedView([
    "> 结构版本：testcase-v1-layered。",
    "",
    "# 用例集：候选测试设计",
    "",
    `> 测试类型：${input.defaults.testType} ｜ 默认环境：${input.defaults.environment} ｜ 默认数据策略：${input.defaults.dataStrategy}`,
    "> 本文档仅用于确认测试设计，不代表授权执行或业务写入。",
    "",
    sections.join("\n\n")
  ].join("\n"));
  const issues = validateTestcaseV6Layered(content);
  if (issues.length) {
    throw new Error(`Candidate assembly produced invalid testcase-v1-layered content: ${issues.join(" ")}`);
  }
  return `${content.trimEnd()}\n`;
}

/** Apply a verified affected delta without rewriting unrelated testcase
 * bodies. The final derived view is always regenerated; non-affected semantic
 * bodies must retain their exact digest-equivalent raw content. */
export function assembleCandidateDelta(input: {
  baseline: string;
  manifest: CandidateFragmentManifest;
  fragments: ReadonlyMap<string, string>;
  affectedRuleIds: string[];
  unaffectedCaseIds: string[];
}): string {
  const baselineDocument = parseTestcaseDocument(input.baseline);
  if (!isCurrentTestcaseDocumentVersion(baselineDocument.version)) {
    throw new Error("Delta assembly requires a testcase-v1-layered stable baseline.");
  }
  const affected = new Set(input.affectedRuleIds);
  const baselineRules = new Set(baselineDocument.cases.flatMap((testcase) => testcase.ruleIds));
  if ([...affected].some((ruleId) => !baselineRules.has(ruleId))) {
    throw new Error("Delta assembly references a RULE absent from the stable baseline.");
  }
  const fragmentSections = input.manifest.modules.map((module) => {
    const content = input.fragments.get(module.id);
    if (!content) throw new Error(`Candidate delta is missing fragment ${module.id}.`);
    validateCandidateFragmentContent(content, module);
    return content.trim();
  });
  const withoutAffected = input.baseline
    .replace(/^##\s+模块[：:]\s*.+?\s*\n\n(<details(?:\s+open)?>([\s\S]*?)<\/details>)\s*/gmu, (block) => {
      const rules = [...block.matchAll(/\bRULE-[A-Z0-9]+(?:-[A-Z0-9]+)+\b/gu)].map((match) => match[0]!);
      return rules.some((ruleId) => affected.has(ruleId)) ? "" : block;
    })
    .trimEnd();
  const candidate = projectTestcaseV6DerivedView(`${withoutAffected}\n\n${fragmentSections.join("\n\n")}\n`);
  const issues = validateTestcaseV6Layered(candidate);
  if (issues.length) throw new Error(`Delta assembly produced invalid testcase-v1-layered content: ${issues.join(" ")}`);
  const actual = parseTestcaseDocument(candidate);
  const before = new Map(baselineDocument.cases.map((testcase) => [testcase.caseId, testcase.rawBody]));
  for (const caseId of input.unaffectedCaseIds) {
    const after = actual.cases.find((testcase) => testcase.caseId === caseId)?.rawBody;
    if (!after || after !== before.get(caseId)) {
      throw new Error(`Delta assembly changed unaffected testcase semantics: ${caseId}.`);
    }
  }
  return `${candidate.trimEnd()}\n`;
}
