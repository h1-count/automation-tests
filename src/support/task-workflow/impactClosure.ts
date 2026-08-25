import { createHash } from "node:crypto";
import { canonicalJson } from "./canonicalJson.js";
import type { SafeJsonValue } from "./types.js";

export const IMPACT_CLOSURE_SCHEMA_VERSION = "impact-closure-v1" as const;
export const DESIGN_DELTA_SCHEMA_VERSION = "design-delta-v1" as const;

export interface ImpactClosure {
  schemaVersion: typeof IMPACT_CLOSURE_SCHEMA_VERSION;
  suiteId: string;
  baselineVersion: string;
  caseIds: string[];
  ruleIds: string[];
  sourceRefs: string[];
  moduleIds: string[];
}

export interface DesignDelta {
  schemaVersion: typeof DESIGN_DELTA_SCHEMA_VERSION;
  baselineVersion: string;
  caseIds: string[];
  ruleIds: string[];
  moduleIds: string[];
}

export function impactClosureDigest(value: ImpactClosure): string {
  return createHash("sha256")
    .update(canonicalJson(value as unknown as SafeJsonValue), "utf8")
    .digest("hex");
}

/** Fail closed before any delta model work: a closure without semantic cases,
 * an unknown baseline or an oversized scope must restart as full_replan. */
export function buildImpactClosure(input: {
  suiteId: string;
  baselineVersion?: string;
  caseIds: string[];
  ruleIds?: string[];
  sourceRefs?: string[];
  moduleIds?: string[];
}): ImpactClosure {
  const caseIds = [...new Set(input.caseIds)].sort();
  if (!input.baselineVersion || !/^[a-f0-9]{64}$/u.test(input.baselineVersion)) {
    throw new Error("affected_rebuild must fall back to full_replan: baseline version is unavailable.");
  }
  if (!caseIds.length || caseIds.length > 8) {
    throw new Error("affected_rebuild must fall back to full_replan: impact closure is empty or exceeds 8 semantic cases.");
  }
  const ruleIds = [...new Set(input.ruleIds ?? [])].sort();
  const sourceRefs = [...new Set(input.sourceRefs ?? [])].sort();
  const moduleIds = [...new Set(input.moduleIds ?? [])].sort();
  if (!ruleIds.length || !sourceRefs.length || !moduleIds.length) {
    throw new Error("affected_rebuild must fall back to full_replan: the impact mapping cannot prove RULE, source and module ownership.");
  }
  return {
    schemaVersion: IMPACT_CLOSURE_SCHEMA_VERSION,
    suiteId: input.suiteId,
    baselineVersion: input.baselineVersion,
    caseIds,
    ruleIds,
    sourceRefs,
    moduleIds
  };
}

export function parseDesignDelta(text: string, closure: ImpactClosure): DesignDelta {
  const raw = JSON.parse(text) as Partial<DesignDelta>;
  if (raw.schemaVersion !== DESIGN_DELTA_SCHEMA_VERSION
    || raw.baselineVersion !== closure.baselineVersion
    || !Array.isArray(raw.caseIds)
    || !Array.isArray(raw.ruleIds)
    || !Array.isArray(raw.moduleIds)) {
    throw new Error("design-delta-v1 must bind the frozen closure baseline, caseIds and ruleIds.");
  }
  const caseIds = [...new Set(raw.caseIds.filter((value): value is string => typeof value === "string"))].sort();
  const ruleIds = [...new Set(raw.ruleIds.filter((value): value is string => typeof value === "string"))].sort();
  const moduleIds = [...new Set(raw.moduleIds.filter((value): value is string => typeof value === "string"))].sort();
  const allowedCases = new Set(closure.caseIds);
  const allowedRules = new Set(closure.ruleIds);
  const allowedModules = new Set(closure.moduleIds);
  if (!caseIds.length || !ruleIds.length || !moduleIds.length
    || caseIds.some((caseId) => !allowedCases.has(caseId))
    || ruleIds.some((ruleId) => !allowedRules.has(ruleId))
    || moduleIds.some((moduleId) => !allowedModules.has(moduleId))) {
    throw new Error("design-delta-v1 exceeds the frozen impact closure.");
  }
  if (caseIds.length !== closure.caseIds.length || ruleIds.length !== closure.ruleIds.length
    || moduleIds.length !== closure.moduleIds.length) {
    throw new Error("design-delta-v1 must cover the complete frozen impact closure.");
  }
  return { schemaVersion: DESIGN_DELTA_SCHEMA_VERSION, baselineVersion: closure.baselineVersion, caseIds, ruleIds, moduleIds };
}

export function designDeltaDigest(value: DesignDelta): string {
  return createHash("sha256")
    .update(canonicalJson(value as unknown as SafeJsonValue), "utf8")
    .digest("hex");
}
