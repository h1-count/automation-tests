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

export interface CandidateFragmentModule {
  id: string;
  title: string;
  ruleIds: string[];
  casePrefix: string;
  sourceRefs: string[];
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
    const sourceRefs = Array.isArray(module.sourceRefs) && module.sourceRefs.every((item) => typeof item === "string")
      ? [...new Set(module.sourceRefs)].sort()
      : [];
    if (!moduleIdPattern.test(id) || ids.has(id) || !title || !casePrefixPattern.test(casePrefix)) {
      throw new Error(`Candidate fragment module ${id || "<unknown>"} has invalid identity.`);
    }
    if (!ruleIds.length || ruleIds.some((ruleId) => !ruleIdPattern.test(ruleId) || rules.has(ruleId))) {
      throw new Error(`Candidate fragment module ${id} has missing, invalid, or cross-module RULE ownership.`);
    }
    if (!sourceRefs.length || sourceRefs.some((source) => !source.trim())) {
      throw new Error(`Candidate fragment module ${id} requires frozen source references.`);
    }
    ids.add(id);
    ruleIds.forEach((ruleId) => rules.add(ruleId));
    return { id, title, ruleIds, casePrefix, sourceRefs };
  });
  return { schemaVersion: CANDIDATE_FRAGMENT_MANIFEST_SCHEMA_VERSION, scope: record.scope, modules };
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
  if (!caseIds.length || caseIds.some((caseId) => !caseId.startsWith(`${module.casePrefix}-`))) {
    throw new Error(`Candidate fragment ${module.id} has a caseId outside its frozen prefix.`);
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
    "> 结构版本：testcase-v6-layered。",
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
    throw new Error(`Candidate assembly produced invalid testcase-v6-layered content: ${issues.join(" ")}`);
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
    throw new Error("Delta assembly requires a testcase-v6-layered stable baseline.");
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
  if (issues.length) throw new Error(`Delta assembly produced invalid testcase-v6-layered content: ${issues.join(" ")}`);
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
