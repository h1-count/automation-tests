/**
 * Design-tier stable suite registration and assessment (manifest v2).
 *
 * A testcase_only request whose case-confirmation the user accepted can be
 * registered as a design-tier stable suite. The registration freezes the
 * design evidence (design.md + case packages + per-source digests from the
 * ledger's source registry) so later requests for the same suite can be
 * assessed deterministically:
 *
 * - zero drift on every frozen identity      -> design_reconfirm
 * - source-file drift with a complete
 *   SRC -> RULE -> caseIds closure           -> affected_rebuild
 * - suite asset drift or an incomplete map   -> full_replan (fail closed)
 *
 * Design-tier suites never authorize execution: they carry no scripts, no
 * formal manifest and no execution evidence. Promotion to the execution tier
 * still requires a full_run request through the v1 promotion path.
 * @module designSuite
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { atomicWrite } from "../test-data/ledgerStore.js";
import { canonicalJson, sha256Canonical } from "../task-workflow/canonicalJson.js";
import type { SafeJsonValue } from "../task-workflow/types.js";
import {
  markdownSection,
  markdownTableRows,
  splitMarkdownTableRow
} from "../testcase/relationProjection.js";
import {
  isStructuredTestcaseDocumentVersion,
  parseTestcaseDocument
} from "../testcase/testcaseDocument.js";
import type { StableTestSuiteFileIdentity } from "./stableSuite.js";

export const STABLE_DESIGN_SUITE_SCHEMA_VERSION = "stable-test-suite-manifest-v2" as const;
export const DESIGN_TIER = "design" as const;
export const EXECUTION_TIER = "execution" as const;

export type StableSuiteTier = typeof DESIGN_TIER | typeof EXECUTION_TIER;

export interface StableDesignSourceRegistration {
  sourceId: string;
  /** Ledger-registered SHA-256 (the backticked digest in the source row; the primary artifact). */
  digest: string;
  /** Workspace-relative source file paths parsed from the row's markdown links. */
  sourcePaths: string[];
  /**
   * Frozen per-file baseline. A source row may reference several files
   * (page html + data.js + design screenshot); the ledger digest only pins
   * the primary artifact, so the manifest freezes every referenced file.
   */
  fileDigests: Array<{ path: string; digest: string }>;
}

export interface StableDesignSuiteManifest {
  schemaVersion: typeof STABLE_DESIGN_SUITE_SCHEMA_VERSION;
  tier: typeof DESIGN_TIER;
  suiteId: string;
  suiteVersion: string;
  status: "stable";
  /** The testcase_only request whose case-confirmation was accepted. */
  sourceRequestId: string;
  designLedger: StableTestSuiteFileIdentity;
  casePackages: StableTestSuiteFileIdentity[];
  caseIds: string[];
  profiles: {
    full_feature: string[];
    smoke: string[];
    failed_or_blocked: string[];
  };
  sourceRegistry: StableDesignSourceRegistration[];
  allowedEnvironments: Array<"test" | "pre">;
  acceptance: {
    /** Workflow history head digest at acceptance time. */
    workflowHeadDigest: string;
    /** Digest of the accepted CallbackResolved event payload. */
    confirmationDigest: string;
    acceptedAt: string;
  };
}

export type DesignSuiteReuseDecision =
  | "design_reconfirm"
  | "affected_rebuild"
  | "full_replan";

export interface DesignSuiteAssessment {
  decision: DesignSuiteReuseDecision;
  selectedCaseIds: string[];
  affectedCaseIds: string[];
  reasons: string[];
}

const sourceIdPattern = /^SRC-[A-Z0-9]+(?:-[A-Z0-9]+)+$/u;
const digestPattern = /^[a-f0-9]{64}$/u;
const ruleIdPattern = /^RULE-[A-Z0-9]+(?:-[A-Z0-9]+)+$/u;

/** Parse the ledger's source registry section (`## 请求内来源`). */
export function parseSourceRegistry(designLedger: string): StableDesignSourceRegistration[] {
  const section = markdownSection(designLedger, "请求内来源");
  if (!section) return [];
  const rows = markdownTableRows(section)
    .filter((row) => row.length >= 3 && sourceIdPattern.test((row[0] ?? "").trim()));
  const seen = new Set<string>();
  const registrations: StableDesignSourceRegistration[] = [];
  for (const row of rows) {
    const sourceId = (row[0] ?? "").trim();
    if (seen.has(sourceId)) continue;
    seen.add(sourceId);
    const digestMatch = (row[2] ?? "").match(/`([a-f0-9]{64})`/u);
    const registeredDigest = digestMatch?.[1];
    if (!registeredDigest) {
      throw new Error(`Design ledger source row ${sourceId} has no registered SHA-256 digest.`);
    }
    const sourcePaths = [...(row[1] ?? "").matchAll(/\]\(([^)]+)\)/gu)]
      .map((match) => match[1]!.trim())
      .filter((path) => path.startsWith("../../../") || path.startsWith("../../../../"))
      .map((path) => normalizeSourcePath(path));
    registrations.push({ sourceId, digest: registeredDigest, sourcePaths, fileDigests: [] });
  }
  return registrations;
}

/** Resolve a ledger-relative markdown link against the suite design.md location. */
function normalizeSourcePath(link: string): string {
  // Links are relative to testcases/<type>/<project>/suites/<feature>/design.md
  const segments = link.split("/").filter((segment) => segment.length > 0);
  while (segments.length && [".."].includes(segments[0]!)) segments.shift();
  return segments.join("/");
}

/** Parse RULE ledger rows into RULE -> { sourceRefs, caseIds } pairs. */
export function parseRuleLedger(designLedger: string): Array<{
  ruleId: string;
  sourceRefs: string[];
  caseIds: string[];
}> {
  const section = markdownSection(designLedger, "规则设计台账");
  if (!section) return [];
  const rows = markdownTableRows(section);
  const header = rows.find((row) => (row[0] ?? "").trim() === "RULE");
  if (!header) return [];
  const ruleIndex = header.indexOf("RULE");
  const sourceIndex = header.indexOf("sourceRef");
  const caseIdsIndex = header.indexOf("caseIds");
  if (ruleIndex < 0 || sourceIndex < 0 || caseIdsIndex < 0) {
    throw new Error("Design ledger rule table is missing RULE/sourceRef/caseIds columns.");
  }
  return rows
    .filter((row) => ruleIdPattern.test((row[ruleIndex] ?? "").trim()))
    .map((row) => ({
      ruleId: (row[ruleIndex] ?? "").trim(),
      sourceRefs: [...(row[sourceIndex] ?? "").matchAll(/\bSRC-[A-Z0-9]+(?:-[A-Z0-9]+)+\b/gu)]
        .map((match) => match[0]),
      caseIds: (row[caseIdsIndex] ?? "")
        .split(/[、,，;；\s]+/u)
        .map((value) => value.trim())
        .filter((value) => /^OPEN-[A-Z0-9]+(?:-[A-Z0-9]+)+$/u.test(value))
    }));
}

function fileIdentity(workspaceRoot: string, path: string): StableTestSuiteFileIdentity {
  const absolute = resolve(workspaceRoot, path);
  if (!existsSync(absolute)) {
    throw new Error(`Design suite file is missing: ${path}.`);
  }
  return {
    path,
    digest: createHash("sha256").update(readFileSync(absolute)).digest("hex")
  };
}

function digestDesignSuiteEvidence(value: {
  profiles: StableDesignSuiteManifest["profiles"];
  [key: string]: unknown;
}): string {
  const versioned = {
    ...value,
    profiles: {
      full_feature: [...value.profiles.full_feature].sort(),
      smoke: [...value.profiles.smoke].sort()
    }
  };
  return sha256Canonical(versioned as unknown as SafeJsonValue);
}

export function designSuiteManifestPath(
  suiteId: string,
  workspaceRoot = process.cwd()
): string {
  const segments = suiteId.split("/");
  if (segments.length !== 3) {
    throw new Error("suiteId must use <type>/<project>/<feature>.");
  }
  const [type, project, feature] = segments;
  return resolve(
    workspaceRoot,
    "testcases",
    type!,
    project!,
    "suites",
    feature!,
    "suite.manifest.json"
  );
}

interface WorkflowAcceptanceEvidence {
  workflowHeadDigest: string;
  confirmationDigest: string;
  acceptedAt: string;
}

/** Read the run's workflow history and verify a user-accepted testcase_only terminal state. */
async function readAcceptedConfirmation(
  workspaceRoot: string,
  requestId: string
): Promise<WorkflowAcceptanceEvidence> {
  const historyPath = resolve(
    workspaceRoot,
    ".local/test-runs",
    requestId,
    "workflow-history.ndjson"
  );
  if (!existsSync(historyPath)) {
    throw new Error(`Request has no workflow history: ${requestId}.`);
  }
  const events = (await readFile(historyPath, "utf8"))
    .trim()
    .split(/\r?\n/u)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as {
      type?: string;
      occurredAt?: string;
      digest?: string;
      payload?: Record<string, unknown>;
    });
  const resolved = events.filter((event) =>
    event.type === "CallbackResolved"
    && event.payload?.activityId === "case-confirmation"
    && event.payload?.resolution === "accepted");
  if (!resolved.length) {
    throw new Error(
      `Request ${requestId} has no user-accepted case-confirmation; design-tier registration is refused.`
    );
  }
  const terminal = events.filter((event) => event.type === "WorkflowCompleted");
  if (!terminal.length) {
    throw new Error(
      `Request ${requestId} has not reached its terminal state; design-tier registration is refused.`
    );
  }
  const accepted = resolved[resolved.length - 1]!;
  const confirmationDigest = sha256Canonical(accepted.payload as SafeJsonValue);
  return {
    workflowHeadDigest: events.filter((event) => event.digest).at(-1)?.digest
      ?? confirmationDigest,
    confirmationDigest,
    acceptedAt: accepted.occurredAt ?? new Date().toISOString()
  };
}

export async function registerStableDesignSuite(input: {
  suiteId: string;
  requestId: string;
  workspaceRoot?: string;
}): Promise<{ path: string; manifest: StableDesignSuiteManifest; created: boolean }> {
  const root = resolve(input.workspaceRoot ?? process.cwd());
  const [requestScope, suiteScope] = [
    input.requestId.split("/").slice(0, 2).join("/"),
    input.suiteId.split("/").slice(0, 2).join("/")
  ];
  if (requestScope !== suiteScope) {
    throw new Error("Design suite and source request must use the same type/project scope.");
  }
  const acceptance = await readAcceptedConfirmation(root, input.requestId);
  const [type, project, feature] = input.suiteId.split("/");
  const suiteDir = ["testcases", type, project, "suites", feature].join("/");
  const designLedgerPath = `${suiteDir}/design.md`;
  const designLedger = await readFile(resolve(root, designLedgerPath), "utf8");
  const casePackageNames = (await readdir(resolve(root, suiteDir)))
    .filter((name) => name === "cases.md" || /^cases-[a-z0-9][a-z0-9-]*\.md$/u.test(name))
    .sort();
  const casePackages = casePackageNames.map((name) => fileIdentity(root, `${suiteDir}/${name}`));
  if (!casePackages.length) {
    throw new Error("Design suite registration requires at least one case package.");
  }
  const sourceRegistry = parseSourceRegistry(designLedger);
  if (!sourceRegistry.length) {
    throw new Error("Design suite registration requires a non-empty source registry.");
  }
  for (const registration of sourceRegistry) {
    if (!digestPattern.test(registration.digest)) {
      throw new Error(`Source ${registration.sourceId} has an invalid registered digest.`);
    }
    if (!registration.sourcePaths.length) {
      throw new Error(`Source ${registration.sourceId} has no resolvable workspace path.`);
    }
    const fileDigests: Array<{ path: string; digest: string }> = [];
    for (const sourcePath of registration.sourcePaths) {
      const currentDigest = createHash("sha256")
        .update(await readFile(resolve(root, sourcePath)))
        .digest("hex");
      fileDigests.push({ path: sourcePath, digest: currentDigest });
    }
    if (!fileDigests.some((entry) => entry.digest === registration.digest)) {
      throw new Error(
        `Source ${registration.sourceId} ledger digest matches none of its referenced files; `
        + `the design ledger must be reconciled before design-tier registration.`
      );
    }
    registration.fileDigests = fileDigests.sort((left, right) => left.path.localeCompare(right.path));
  }
  const caseIds: string[] = [];
  const smokeCaseIds: string[] = [];
  for (const identity of casePackages) {
    const document = parseTestcaseDocument(
      await readFile(resolve(root, identity.path), "utf8")
    );
    if (!isStructuredTestcaseDocumentVersion(document.version)) {
      throw new Error(`Design suite case package must use testcase-v6-layered: ${identity.path}.`);
    }
    for (const testcase of document.cases) {
      caseIds.push(testcase.caseId);
      if (testcase.priority === "P0") smokeCaseIds.push(testcase.caseId);
    }
  }
  if (!caseIds.length || new Set(caseIds).size !== caseIds.length) {
    throw new Error("Design suite registration requires unique non-empty caseIds.");
  }
  const immutable = {
    schemaVersion: STABLE_DESIGN_SUITE_SCHEMA_VERSION,
    tier: DESIGN_TIER,
    suiteId: input.suiteId,
    designLedger: fileIdentity(root, designLedgerPath),
    casePackages: casePackages.sort((left, right) => left.path.localeCompare(right.path)),
    caseIds: [...caseIds].sort(),
    profiles: {
      full_feature: [...caseIds].sort(),
      smoke: (smokeCaseIds.length ? smokeCaseIds : caseIds).sort(),
      failed_or_blocked: []
    },
    sourceRegistry: sourceRegistry
      .map((registration) => ({
        sourceId: registration.sourceId,
        digest: registration.digest,
        sourcePaths: [...registration.sourcePaths].sort(),
        fileDigests: registration.fileDigests
          .map((entry) => ({ path: entry.path, digest: entry.digest }))
          .sort((left, right) => left.path.localeCompare(right.path))
      }))
      .sort((left, right) => left.sourceId.localeCompare(right.sourceId)),
    allowedEnvironments: ["test", "pre"] as Array<"test" | "pre">
  };
  const manifest: StableDesignSuiteManifest = {
    ...immutable,
    suiteVersion: digestDesignSuiteEvidence(immutable),
    status: "stable",
    sourceRequestId: input.requestId,
    acceptance
  };
  const path = designSuiteManifestPath(input.suiteId, root);
  await mkdir(dirname(path), { recursive: true });
  const existing = existsSync(path)
    ? JSON.parse(await readFile(path, "utf8")) as StableDesignSuiteManifest
    : undefined;
  if (existing?.suiteVersion === manifest.suiteVersion
    && existing.acceptance?.confirmationDigest === acceptance.confirmationDigest) {
    return { path, manifest: existing, created: false };
  }
  await atomicWrite(path, manifest);
  return { path, manifest, created: existing === undefined };
}

export function parseStableDesignSuiteManifest(
  value: unknown,
  expectedSuiteId: string
): StableDesignSuiteManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Stable design suite manifest must be an object.");
  }
  const manifest = value as StableDesignSuiteManifest;
  if (manifest.schemaVersion !== STABLE_DESIGN_SUITE_SCHEMA_VERSION
    || manifest.tier !== DESIGN_TIER
    || manifest.suiteId !== expectedSuiteId
    || manifest.status !== "stable") {
    throw new Error("Stable design suite manifest identity is invalid.");
  }
  if (typeof manifest.sourceRequestId !== "string" || !manifest.sourceRequestId) {
    throw new Error("Stable design suite manifest requires a sourceRequestId.");
  }
  if (!digestPattern.test(manifest.suiteVersion ?? "")) {
    throw new Error("Stable design suite suiteVersion must be a lowercase SHA-256 digest.");
  }
  if (!manifest.caseIds?.length || new Set(manifest.caseIds).size !== manifest.caseIds.length) {
    throw new Error("Stable design suite manifest requires unique caseIds.");
  }
  const [type, project, feature] = expectedSuiteId.split("/");
  const suitePrefix = `testcases/${type}/${project}/suites/${feature}/`;
  if (manifest.designLedger?.path !== `${suitePrefix}design.md`
    || !manifest.casePackages?.length
    || manifest.casePackages.some((item) =>
      typeof item?.path !== "string"
      || !item.path.startsWith(suitePrefix)
      || !digestPattern.test(item.digest ?? ""))) {
    throw new Error("Stable design suite assets must live in the suite directory with digests.");
  }
  if (!digestPattern.test(manifest.designLedger.digest ?? "")) {
    throw new Error("Stable design suite designLedger digest is invalid.");
  }
  if (!Array.isArray(manifest.sourceRegistry) || !manifest.sourceRegistry.length) {
    throw new Error("Stable design suite requires a non-empty sourceRegistry.");
  }
  const sourceIds = new Set<string>();
  for (const registration of manifest.sourceRegistry) {
    if (!sourceIdPattern.test(registration?.sourceId ?? "")) {
      throw new Error("Stable design suite sourceRegistry has an invalid sourceId.");
    }
    if (sourceIds.has(registration.sourceId)) {
      throw new Error(`Stable design suite sourceRegistry duplicates ${registration.sourceId}.`);
    }
    sourceIds.add(registration.sourceId);
    if (!digestPattern.test(registration.digest ?? "")) {
      throw new Error(`Stable design suite source digest is invalid: ${registration.sourceId}.`);
    }
    if (!Array.isArray(registration.sourcePaths)
      || !registration.sourcePaths.length
      || registration.sourcePaths.some((path) =>
        typeof path !== "string"
        || path.startsWith(".local/")
        || path.startsWith("artifacts/")
        || path.startsWith("../"))) {
      throw new Error(`Stable design suite source paths are invalid: ${registration.sourceId}.`);
    }
    if (!Array.isArray(registration.fileDigests)
      || !registration.fileDigests.length
      || registration.fileDigests.some((entry) =>
        typeof entry?.path !== "string"
        || !registration.sourcePaths.includes(entry.path)
        || !digestPattern.test(entry.digest ?? ""))) {
      throw new Error(`Stable design suite source fileDigests are invalid: ${registration.sourceId}.`);
    }
  }
  if (!Array.isArray(manifest.allowedEnvironments)
    || !manifest.allowedEnvironments.length
    || manifest.allowedEnvironments.some((environment) => !["test", "pre"].includes(environment))) {
    throw new Error("Stable design suite allowedEnvironments must contain test/pre values.");
  }
  if (!manifest.acceptance
    || !digestPattern.test(manifest.acceptance.workflowHeadDigest ?? "")
    || !digestPattern.test(manifest.acceptance.confirmationDigest ?? "")
    || !Number.isFinite(Date.parse(manifest.acceptance.acceptedAt ?? ""))) {
    throw new Error("Stable design suite acceptance evidence is invalid.");
  }
  const { suiteVersion: _v, status: _s, sourceRequestId: _r, acceptance: _a, ...rest } = manifest;
  if (digestDesignSuiteEvidence(rest) !== manifest.suiteVersion) {
    throw new Error("Stable design suite suiteVersion does not match its frozen design evidence.");
  }
  return structuredClone(manifest);
}

export interface DesignSuiteValidation {
  manifest: StableDesignSuiteManifest;
  /** Suite-owned assets whose current digest differs from the registration. */
  driftedSuitePaths: string[];
  /** Sources whose current file digest differs from the ledger-registered digest. */
  driftedSourceIds: string[];
}

export async function validateStableDesignSuite(
  suiteId: string,
  workspaceRoot = process.cwd()
): Promise<DesignSuiteValidation> {
  const root = resolve(workspaceRoot);
  const path = designSuiteManifestPath(suiteId, root);
  if (!existsSync(path)) {
    throw new Error(`Stable design suite is not registered: ${suiteId}.`);
  }
  const manifest = parseStableDesignSuiteManifest(
    JSON.parse(await readFile(path, "utf8")) as unknown,
    suiteId
  );
  const driftedSuitePaths: string[] = [];
  for (const identity of [manifest.designLedger, ...manifest.casePackages]) {
    try {
      if (fileIdentity(root, identity.path).digest !== identity.digest) {
        driftedSuitePaths.push(identity.path);
      }
    } catch {
      driftedSuitePaths.push(identity.path);
    }
  }
  const driftedSourceIds: string[] = [];
  for (const registration of manifest.sourceRegistry) {
    const baseline = new Map(
      (registration.fileDigests ?? []).map((entry) => [entry.path, entry.digest])
    );
    for (const sourcePath of registration.sourcePaths) {
      let currentDigest: string;
      try {
        currentDigest = createHash("sha256")
          .update(readFileSync(resolve(root, sourcePath)))
          .digest("hex");
      } catch {
        driftedSourceIds.push(registration.sourceId);
        break;
      }
      if (currentDigest !== baseline.get(sourcePath)) {
        driftedSourceIds.push(registration.sourceId);
        break;
      }
    }
    // 注册基线中的文件被删除也视为来源漂移
    for (const entry of registration.fileDigests ?? []) {
      if (!registration.sourcePaths.includes(entry.path)) {
        driftedSourceIds.push(registration.sourceId);
        break;
      }
    }
  }
  return {
    manifest,
    driftedSuitePaths: [...new Set(driftedSuitePaths)].sort(),
    driftedSourceIds: [...new Set(driftedSourceIds)].sort()
  };
}

export async function assessStableDesignSuite(input: {
  suiteId: string;
  environment: string;
  workspaceRoot?: string;
}): Promise<DesignSuiteAssessment & { manifest: StableDesignSuiteManifest }> {
  const root = resolve(input.workspaceRoot ?? process.cwd());
  const validation = await validateStableDesignSuite(input.suiteId, root);
  const { manifest } = validation;
  if (!manifest.allowedEnvironments.includes(input.environment as "test" | "pre")) {
    return {
      manifest,
      decision: "full_replan",
      selectedCaseIds: [],
      affectedCaseIds: [],
      reasons: ["environment_outside_suite_policy"]
    };
  }
  if (validation.driftedSuitePaths.length) {
    return {
      manifest,
      decision: "full_replan",
      selectedCaseIds: [],
      affectedCaseIds: [],
      reasons: [
        "suite_design_drift_out_of_band",
        ...validation.driftedSuitePaths.map((path) => `asset_digest_drift:${path}`)
      ]
    };
  }
  if (!validation.driftedSourceIds.length) {
    return {
      manifest,
      decision: "design_reconfirm",
      selectedCaseIds: [...manifest.profiles.full_feature].sort(),
      affectedCaseIds: [],
      reasons: ["design_zero_drift"]
    };
  }
  const ledger = await readFile(resolve(root, manifest.designLedger.path), "utf8");
  const rules = parseRuleLedger(ledger);
  if (!rules.length) {
    return {
      manifest,
      decision: "full_replan",
      selectedCaseIds: [],
      affectedCaseIds: [],
      reasons: ["impact_mapping_incomplete_or_core_contract_drift"]
    };
  }
  const knownSources = new Set(manifest.sourceRegistry.map((item) => item.sourceId));
  const knownCases = new Set(manifest.caseIds);
  const affected = new Set<string>();
  let mappingComplete = true;
  for (const rule of rules) {
    const hitsDriftedSource = rule.sourceRefs.some((sourceId) =>
      validation.driftedSourceIds.includes(sourceId));
    if (!hitsDriftedSource) continue;
    if (rule.sourceRefs.some((sourceId) => !knownSources.has(sourceId))) {
      mappingComplete = false;
      break;
    }
    if (!rule.caseIds.length
      || rule.caseIds.some((caseId) => !knownCases.has(caseId))) {
      mappingComplete = false;
      break;
    }
    rule.caseIds.forEach((caseId) => affected.add(caseId));
  }
  if (!mappingComplete || !affected.size) {
    return {
      manifest,
      decision: "full_replan",
      selectedCaseIds: [],
      affectedCaseIds: [...affected].sort(),
      reasons: ["impact_mapping_incomplete_or_core_contract_drift"]
    };
  }
  return {
    manifest,
    decision: "affected_rebuild",
    selectedCaseIds: [...affected].sort(),
    affectedCaseIds: [...affected].sort(),
    reasons: [
      "complete_case_impact_mapping",
      ...validation.driftedSourceIds.map((sourceId) => `source_digest_drift:${sourceId}`)
    ]
  };
}

/** The tier recorded in a suite registration file, for routing shared assessment entry points. */
export function readStableSuiteTier(
  suiteId: string,
  workspaceRoot = process.cwd()
): "design" | "execution" | undefined {
  const root = resolve(workspaceRoot);
  const path = designSuiteManifestPath(suiteId, root);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      schemaVersion?: string;
      tier?: string;
    };
    if (parsed.schemaVersion === STABLE_DESIGN_SUITE_SCHEMA_VERSION) {
      return parsed.tier === DESIGN_TIER ? DESIGN_TIER : EXECUTION_TIER;
    }
    return EXECUTION_TIER;
  } catch {
    return EXECUTION_TIER;
  }
}

export function designSuiteCanonical(value: unknown): string {
  return canonicalJson(value as SafeJsonValue);
}
