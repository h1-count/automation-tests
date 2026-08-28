import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { canonicalJson, sha256Canonical } from "../task-workflow/canonicalJson.js";
import type { SafeJsonValue } from "../task-workflow/types.js";

export const STABLE_SCRIPT_ASSETS_SCHEMA_VERSION = "stable-script-assets-v1" as const;
export type StableScriptLevel = "reviewed" | "verified";

export interface StableScriptIdentity {
  path: string;
  digest: string;
}

/** One case is bound to one reviewed entry script and its exact closure. */
export interface StableScriptCaseBinding {
  caseId: string;
  entryScript: StableScriptIdentity;
  closureDigest: string;
  reviewDigest: string;
  /** Coverage rows and compiler behavior that the reviewed script proved. */
  coveragePlanDigest?: string;
  compilerVersion?: string;
  level: StableScriptLevel;
  /** Required only when the script has completed a sealed formal execution. */
  verificationDigest?: string;
}

export interface StableScriptAssets {
  schemaVersion: typeof STABLE_SCRIPT_ASSETS_SCHEMA_VERSION;
  formalManifest: StableScriptIdentity;
  scriptClosure: StableScriptIdentity[];
  caseBindings: StableScriptCaseBinding[];
}

const digestPattern = /^[a-f0-9]{64}$/u;

export function scriptAssetCoverage(
  assets: StableScriptAssets | undefined,
  selectedCaseIds: string[]
): { reusable: boolean; directlyExecutable: boolean; reason?: string } {
  if (!assets) return { reusable: false, directlyExecutable: false, reason: "stable_scripts_missing" };
  const selected = [...new Set(selectedCaseIds)].sort();
  const bindings = new Map(assets.caseBindings.map((binding) => [binding.caseId, binding]));
  const missing = selected.filter((caseId) => !bindings.has(caseId));
  if (missing.length) {
    return { reusable: false, directlyExecutable: false, reason: `stable_scripts_missing:${missing.join(",")}` };
  }
  const unverified = selected.filter((caseId) => bindings.get(caseId)!.level !== "verified");
  return {
    reusable: true,
    directlyExecutable: unverified.length === 0,
    ...(unverified.length ? { reason: `stable_scripts_reviewed_not_verified:${unverified.join(",")}` } : {})
  };
}

export function validateStableScriptAssets(
  value: unknown,
  caseIds: string[],
  workspaceRoot = process.cwd()
): StableScriptAssets {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Stable script assets must be an object.");
  }
  const assets = value as StableScriptAssets;
  if (assets.schemaVersion !== STABLE_SCRIPT_ASSETS_SCHEMA_VERSION) {
    throw new Error("Stable script assets schema is invalid.");
  }
  const knownCases = new Set(caseIds);
  const closurePaths = new Set<string>();
  if (!isIdentity(assets.formalManifest)
    || !Array.isArray(assets.scriptClosure)
    || !assets.scriptClosure.length
    || assets.scriptClosure.some((identity) => !isIdentity(identity) || closurePaths.has(identity.path) || !closurePaths.add(identity.path))
    || !closurePaths.has(assets.formalManifest.path)) {
    throw new Error("Stable script assets formal manifest or closure is invalid.");
  }
  const boundCases = new Set<string>();
  for (const binding of assets.caseBindings ?? []) {
    if (!binding || !knownCases.has(binding.caseId) || boundCases.has(binding.caseId)
      || !isIdentity(binding.entryScript)
      || !closurePaths.has(binding.entryScript.path)
      || !digestPattern.test(binding.closureDigest)
      || !digestPattern.test(binding.reviewDigest)
      || (binding.coveragePlanDigest !== undefined && !digestPattern.test(binding.coveragePlanDigest))
      || (binding.compilerVersion !== undefined
        && (typeof binding.compilerVersion !== "string" || !binding.compilerVersion.trim()))
      || !["reviewed", "verified"].includes(binding.level)
      || (binding.level === "verified" && !digestPattern.test(binding.verificationDigest ?? ""))
      || (binding.level === "reviewed" && binding.verificationDigest !== undefined)) {
      throw new Error("Stable script assets case binding is invalid.");
    }
    boundCases.add(binding.caseId);
  }
  const root = resolve(workspaceRoot);
  for (const identity of [assets.formalManifest, ...assets.scriptClosure]) {
    const absolute = resolve(root, identity.path);
    const relativePath = relative(root, absolute).split(sep).join("/");
    if (!relativePath || relativePath === ".." || relativePath.startsWith("../") || !existsSync(absolute)) {
      throw new Error(`Stable script asset is outside the workspace or missing: ${identity.path}`);
    }
    const digest = createHash("sha256").update(readFileSync(absolute)).digest("hex");
    if (digest !== identity.digest) throw new Error(`Stable script asset digest drifted: ${identity.path}`);
  }
  const actualClosureDigest = sha256Canonical(assets.scriptClosure
    .map((identity) => ({ path: identity.path, digest: identity.digest }))
    .sort((left, right) => left.path.localeCompare(right.path)) as unknown as SafeJsonValue);
  if (assets.caseBindings.some((binding) => binding.closureDigest !== actualClosureDigest)) {
    throw new Error("Stable script binding closure digest drifted.");
  }
  return structuredClone(assets);
}

export function digestStableScriptClosure(identities: StableScriptIdentity[]): string {
  return sha256Canonical(identities
    .map((identity) => ({ path: identity.path, digest: identity.digest }))
    .sort((left, right) => left.path.localeCompare(right.path)) as unknown as SafeJsonValue);
}

function isIdentity(value: unknown): value is StableScriptIdentity {
  return Boolean(value)
    && typeof value === "object"
    && typeof (value as StableScriptIdentity).path === "string"
    && (value as StableScriptIdentity).path.length > 0
    && digestPattern.test((value as StableScriptIdentity).digest ?? "");
}
