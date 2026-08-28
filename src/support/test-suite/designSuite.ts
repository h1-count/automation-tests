/**
 * Design-tier stable suite registration and assessment (manifest v3).
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
 * - unbounded asset/boundary drift           -> full_replan (fail closed)
 *
 * Design-tier suites never authorize execution: they carry no scripts, no
 * formal manifest and no execution evidence. Promotion to the execution tier
 * still requires a full_run request through the v1 promotion path.
 * @module designSuite
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { atomicWrite, atomicWriteText } from "../test-data/ledgerStore.js";
import { canonicalJson, sha256Canonical } from "../task-workflow/canonicalJson.js";
import type { SafeJsonValue } from "../task-workflow/types.js";
import {
  markdownSection,
  markdownTableRows,
  splitMarkdownTableRow
} from "../testcase/relationProjection.js";
import {
  isStructuredTestcaseDocumentVersion,
  parseTestcaseDocument,
  type ParsedTestcase,
  type ParsedTestcaseDocument
} from "../testcase/testcaseDocument.js";
import type { StableTestSuiteFileIdentity } from "./stableSuite.js";
import { loadFormalExecutionManifestFromPath } from "../formal-execution/manifest.js";
import { resolveLocalScriptDependencyClosure } from "../formal-execution/scriptDependencyClosure.js";
import { FORMAL_WEB_SCRIPT_COMPILER_VERSION } from "../formal-execution/webScriptCompiler.js";
import { assertFormalWebCoveragePlan } from "../formal-execution/webScriptCoverage.js";
import {
  validateStableScriptAssets,
  type StableScriptAssets
} from "./scriptAssets.js";

export const STABLE_DESIGN_SUITE_SCHEMA_VERSION = "stable-test-suite-manifest-v1" as const;
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

/**
 * A compact, accepted baseline for one case package.  It deliberately stores
 * semantic and execution-boundary digests instead of testcase prose: the
 * stable suite remains the only reusable design asset, while a later request
 * can still prove that only a bounded set of existing case blocks changed.
 */
export interface StableDesignCasePackageBaseline {
  path: string;
  defaultsDigest: string;
  cases: Array<{
    caseId: string;
    semanticDigest: string;
    executionBoundaryDigest: string;
  }>;
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
  /** Canonical semantic projection of the design ledger, excluding formatting-only markers. */
  designLedgerSemanticDigest: string;
  casePackages: StableTestSuiteFileIdentity[];
  casePackageBaselines: StableDesignCasePackageBaseline[];
  caseIds: string[];
  profiles: {
    full_feature: string[];
    smoke: string[];
    failed_or_blocked: string[];
  };
  sourceRegistry: StableDesignSourceRegistration[];
  allowedEnvironments: Array<"test" | "pre">;
  /** Optional execution assets. Their case-level level controls script reuse. */
  scriptAssets?: StableScriptAssets;
  acceptance: {
    /** Workflow history head digest at acceptance time. */
    workflowHeadDigest: string;
    /** Digest of the accepted CallbackResolved event payload. */
    confirmationDigest: string;
    acceptedAt: string;
  };
}

export type DesignSuiteRefreshStatus =
  | "unchanged"
  | "refreshable_nonsemantic"
  | "semantic_drift"
  | "source_drift"
  | "missing_semantic_baseline";

export interface DesignSuiteRefreshReport {
  suiteId: string;
  status: DesignSuiteRefreshStatus;
  issues: string[];
  manifestPath: string;
  suiteVersion?: string;
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
const suiteIdPattern = /^(?:web|h5|app|api|mqtt|iot|iot-chain)\/[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/u;
const requestIdPattern = /^(?:web|h5|app|api|mqtt|iot|iot-chain)\/[a-z0-9][a-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9_-]*$/u;

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

/**
 * Accept only a real, workspace-contained source artifact.  A source that is
 * not already frozen in the stable design registry is new requirement input,
 * so callers must fail closed to a full replan instead of treating the suite
 * as zero-drift.
 */
export function normalizeControlledSourcePaths(
  sourcePaths: string[] | undefined,
  workspaceRoot = process.cwd()
): string[] {
  if (!sourcePaths?.length) return [];
  const root = realpathSync(resolve(workspaceRoot));
  const normalized = new Set<string>();
  for (const sourcePath of sourcePaths) {
    if (!sourcePath || sourcePath !== sourcePath.trim()) {
      throw new Error("Additional source paths must be non-empty workspace-relative paths.");
    }
    const resolved = resolve(root, sourcePath);
    if (!existsSync(resolved) || !statSync(resolved).isFile()) {
      throw new Error(`Additional source must be an existing file: ${sourcePath}`);
    }
    const actualPath = realpathSync(resolved);
    const workspacePath = relative(root, actualPath).split(sep).join("/");
    if (!workspacePath.startsWith("sources/")
      || workspacePath.startsWith("../")
      || workspacePath === "sources") {
      throw new Error("Additional sources must be workspace-contained files under sources/.");
    }
    normalized.add(workspacePath);
  }
  return [...normalized].sort();
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

function normalizedSectionRows(designLedger: string, section: string): string[][] {
  return markdownTableRows(markdownSection(designLedger, section))
    .map((row) => row.map((cell) => cell.replace(/\s+/gu, " ").trim()))
    .filter((row) => row.some(Boolean));
}

function normalizedSectionText(designLedger: string, section: string): string {
  return markdownSection(designLedger, section)
    .split(/\r?\n/gu)
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter((line) => line && !/^\|(?:\s*:?-+:?\s*\|)+$/u.test(line))
    .join("\n");
}

/** Stable semantic proof for a design ledger. Header-only contract renames do not affect it. */
export function digestDesignLedgerSemantics(designLedger: string): string {
  return sha256Canonical({
    requestDefaults: normalizedSectionRows(designLedger, "请求默认值"),
    scope: normalizedSectionText(designLedger, "测试范围"),
    sources: normalizedSectionRows(designLedger, "请求内来源"),
    requirements: normalizedSectionRows(designLedger, "需求索引"),
    rules: normalizedSectionRows(designLedger, "规则设计台账"),
    ambiguities: normalizedSectionText(designLedger, "需求歧义与未定义预期")
  } as unknown as SafeJsonValue);
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

function testcaseSemanticDigest(testcase: ParsedTestcase): string {
  return sha256Canonical({
    module: testcase.module,
    caseId: testcase.caseId,
    title: testcase.title,
    priority: testcase.priority,
    ruleIds: [...testcase.ruleIds].sort(),
    preconditions: testcase.preconditions,
    executionRows: testcase.executionRows.map((row) => ({
      ...(row.dataId ? { dataId: row.dataId } : {}),
      stepIndex: row.stepIndex,
      action: row.action,
      data: row.data,
      expected: row.expected
    })),
    overrides: {
      ...(testcase.overrides.environment ? { environment: testcase.overrides.environment } : {}),
      ...(testcase.overrides.dataStrategy ? { dataStrategy: testcase.overrides.dataStrategy } : {}),
      ...(testcase.overrides.risk ? { risk: testcase.overrides.risk } : {}),
      sourceRefs: [...testcase.overrides.sourceRefs].sort()
    }
  } as unknown as SafeJsonValue);
}

function testcaseExecutionBoundaryDigest(
  testcase: ParsedTestcase,
  defaults: ParsedTestcaseDocument["defaults"]
): string {
  return sha256Canonical({
    environment: testcase.overrides.environment ?? defaults.environment ?? "",
    dataStrategy: testcase.overrides.dataStrategy ?? defaults.dataStrategy ?? "",
    sourceRefs: [...testcase.overrides.sourceRefs].sort()
  } as unknown as SafeJsonValue);
}

function semanticCasePackageBaseline(
  path: string,
  content: string
): StableDesignCasePackageBaseline {
  const document = parseTestcaseDocument(content);
  if (!isStructuredTestcaseDocumentVersion(document.version)) {
    throw new Error(`Design suite case package must use testcase-v1-layered: ${path}.`);
  }
  const caseIds = document.cases.map((testcase) => testcase.caseId);
  if (new Set(caseIds).size !== caseIds.length) {
    throw new Error(`Design suite case package has duplicate caseIds: ${path}.`);
  }
  return {
    path,
    defaultsDigest: sha256Canonical({
      testType: document.defaults.testType ?? "",
      environment: document.defaults.environment ?? "",
      dataStrategy: document.defaults.dataStrategy ?? ""
    } as unknown as SafeJsonValue),
    cases: document.cases.map((testcase) => ({
      caseId: testcase.caseId,
      semanticDigest: testcaseSemanticDigest(testcase),
      executionBoundaryDigest: testcaseExecutionBoundaryDigest(testcase, document.defaults)
    })).sort((left, right) => left.caseId.localeCompare(right.caseId))
  };
}

function currentCasePackageBaseline(
  workspaceRoot: string,
  path: string
): StableDesignCasePackageBaseline {
  try {
    return semanticCasePackageBaseline(path, readFileSync(resolve(workspaceRoot, path), "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to establish the current case package baseline for ${path}: ${message}`);
  }
}

export function digestDesignSuiteEvidence(value: {
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
  if (!digestPattern.test(acceptance.workflowHeadDigest)
    || !digestPattern.test(acceptance.confirmationDigest)
    || !Number.isFinite(Date.parse(acceptance.acceptedAt))) {
    throw new Error("Current v1 design-suite acceptance evidence is malformed.");
  }
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
  const casePackageBaselines: StableDesignCasePackageBaseline[] = [];
  for (const identity of casePackages) {
    const content = await readFile(resolve(root, identity.path), "utf8");
    const document = parseTestcaseDocument(content);
    if (!isStructuredTestcaseDocumentVersion(document.version)) {
      throw new Error(`Design suite case package must use testcase-v1-layered: ${identity.path}.`);
    }
    casePackageBaselines.push(semanticCasePackageBaseline(identity.path, content));
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
    designLedgerSemanticDigest: digestDesignLedgerSemantics(designLedger),
    casePackages: casePackages.sort((left, right) => left.path.localeCompare(right.path)),
    casePackageBaselines: casePackageBaselines.sort((left, right) => left.path.localeCompare(right.path)),
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
  if (!digestPattern.test(manifest.designLedgerSemanticDigest ?? "")) {
    throw new Error("Stable design suite requires a designLedgerSemanticDigest; run test:suite:refresh-design -- --suite <suite> --seed-design-baseline --confirm-current-design --apply.");
  }
  if (!Array.isArray(manifest.casePackageBaselines)
    || manifest.casePackageBaselines.length !== manifest.casePackages.length
    || manifest.casePackageBaselines.some((baseline) =>
      typeof baseline?.path !== "string"
      || !manifest.casePackages.some((identity) => identity.path === baseline.path)
      || !digestPattern.test(baseline.defaultsDigest ?? "")
      || !Array.isArray(baseline.cases)
      || !baseline.cases.length
      || baseline.cases.some((testcase) =>
        typeof testcase?.caseId !== "string"
        || !digestPattern.test(testcase.semanticDigest ?? "")
        || !digestPattern.test(testcase.executionBoundaryDigest ?? "")))) {
    throw new Error("Stable design suite case package semantic baselines are invalid.");
  }
  const baselineCaseIds = manifest.casePackageBaselines.flatMap((baseline) =>
    baseline.cases.map((testcase) => testcase.caseId)
  );
  if (new Set(baselineCaseIds).size !== baselineCaseIds.length
    || canonicalJson([...baselineCaseIds].sort() as unknown as SafeJsonValue)
      !== canonicalJson([...manifest.caseIds].sort() as unknown as SafeJsonValue)) {
    throw new Error("Stable design suite case package baselines do not match manifest caseIds.");
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
  if (manifest.scriptAssets !== undefined) {
    validateStableScriptAssets(manifest.scriptAssets, manifest.caseIds);
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

function sourceRegistryDrift(
  root: string,
  registrations: StableDesignSourceRegistration[]
): string[] {
  const drifted: string[] = [];
  for (const registration of registrations) {
    const baseline = new Map(registration.fileDigests.map((entry) => [entry.path, entry.digest]));
    for (const sourcePath of registration.sourcePaths) {
      try {
        const current = fileIdentity(root, sourcePath).digest;
        if (current !== baseline.get(sourcePath)) {
          drifted.push(registration.sourceId);
          break;
        }
      } catch {
        drifted.push(registration.sourceId);
        break;
      }
    }
  }
  return [...new Set(drifted)].sort();
}

/**
 * Recomputes file identities only after proving that all durable design facts
 * remain unchanged.  Missing semantic baselines require an explicit one-time
 * seed; ordinary runtime loading never accepts them.
 */
export async function refreshStableDesignSuite(input: {
  suiteId: string;
  apply?: boolean;
  seedDesignBaseline?: boolean;
  confirmCurrentDesign?: boolean;
  workspaceRoot?: string;
}): Promise<DesignSuiteRefreshReport> {
  const root = resolve(input.workspaceRoot ?? process.cwd());
  const manifestPath = designSuiteManifestPath(input.suiteId, root);
  if (!existsSync(manifestPath)) throw new Error(`Stable design suite is not registered: ${input.suiteId}.`);
  const raw = JSON.parse(await readFile(manifestPath, "utf8")) as StableDesignSuiteManifest;
  if (raw.schemaVersion !== STABLE_DESIGN_SUITE_SCHEMA_VERSION || raw.tier !== DESIGN_TIER || raw.suiteId !== input.suiteId) {
    throw new Error("Stable design suite manifest identity is invalid.");
  }
  const designLedger = await readFile(resolve(root, raw.designLedger.path), "utf8");
  const currentSemanticDigest = digestDesignLedgerSemantics(designLedger);
  const currentPackages = raw.casePackages.map((identity) =>
    currentCasePackageBaseline(root, identity.path));
  const currentPackageIdentities = raw.casePackages.map((identity) => fileIdentity(root, identity.path));
  const sourceDrift = sourceRegistryDrift(root, raw.sourceRegistry ?? []);
  const issues: string[] = [];
  if (sourceDrift.length) issues.push(`来源摘要漂移：${sourceDrift.join("、")}`);
  const seedingBaseline = !digestPattern.test(raw.designLedgerSemanticDigest ?? "");
  if (seedingBaseline) {
    if (!input.seedDesignBaseline) {
      return { suiteId: input.suiteId, status: "missing_semantic_baseline", issues: ["缺少 designLedgerSemanticDigest；必须显式 seed 当前已确认设计基线。"], manifestPath };
    }
    if (!input.confirmCurrentDesign) {
      throw new Error("Seeding a design baseline requires --confirm-current-design.");
    }
  } else if (raw.designLedgerSemanticDigest !== currentSemanticDigest) {
    issues.push("设计台账语义摘要漂移。");
  }
  const baselineByPath = new Map(raw.casePackageBaselines?.map((baseline) => [baseline.path, baseline]));
  for (const current of currentPackages) {
    const baseline = baselineByPath.get(current.path);
    if (!seedingBaseline
      && (!baseline || canonicalJson(baseline as unknown as SafeJsonValue) !== canonicalJson(current as unknown as SafeJsonValue))) {
      issues.push(`用例语义或执行边界漂移：${current.path}`);
    }
  }
  if (sourceDrift.length) return { suiteId: input.suiteId, status: "source_drift", issues, manifestPath };
  if (issues.length) return { suiteId: input.suiteId, status: "semantic_drift", issues, manifestPath };
  const next: StableDesignSuiteManifest = {
    ...raw,
    designLedger: fileIdentity(root, raw.designLedger.path),
    designLedgerSemanticDigest: currentSemanticDigest,
    casePackages: currentPackageIdentities,
    casePackageBaselines: currentPackages
  };
  const { suiteVersion: _suiteVersion, status: _status, sourceRequestId: _sourceRequestId, acceptance: _acceptance, ...immutable } = next;
  next.suiteVersion = digestDesignSuiteEvidence(immutable);
  const changed = canonicalJson(next as unknown as SafeJsonValue) !== canonicalJson(raw as unknown as SafeJsonValue);
  if (changed && input.apply) await atomicWrite(manifestPath, next);
  return {
    suiteId: input.suiteId,
    status: changed ? "refreshable_nonsemantic" : "unchanged",
    issues: changed && !input.apply ? ["运行 --apply 后才会写入刷新后的冻结摘要。"] : [],
    manifestPath,
    suiteVersion: next.suiteVersion
  };
}

/**
 * Attach reviewed or verified script bindings without duplicating testcase
 * design.  The caller supplies assets that have already passed the workflow
 * gate; this function only validates identities and updates the frozen suite
 * version atomically.
 */
export async function updateStableDesignScriptAssets(input: {
  suiteId: string;
  scriptAssets: StableScriptAssets;
  workspaceRoot?: string;
}): Promise<StableDesignSuiteManifest> {
  const root = resolve(input.workspaceRoot ?? process.cwd());
  const path = designSuiteManifestPath(input.suiteId, root);
  const manifest = parseStableDesignSuiteManifest(
    JSON.parse(await readFile(path, "utf8")) as unknown,
    input.suiteId
  );
  const scriptAssets = validateStableScriptAssets(input.scriptAssets, manifest.caseIds, root);
  const { suiteVersion: _suiteVersion, status: _status, sourceRequestId: _sourceRequestId, acceptance: _acceptance, ...immutable } = manifest;
  const next: StableDesignSuiteManifest = {
    ...manifest,
    scriptAssets,
    suiteVersion: digestDesignSuiteEvidence({ ...immutable, scriptAssets })
  };
  await atomicWrite(path, next);
  return next;
}

/**
 * Promote a reviewed request-local script set into the suite without claiming
 * it has run.  The resulting assets are reusable as a build seed; only a
 * later sealed execution may create an execution-tier suite.
 */
export async function promoteReviewedDesignScripts(input: {
  suiteId: string;
  requestId: string;
  reviewDigest: string;
  caseScripts: Array<{ caseId: string; sourcePath: string }>;
  workspaceRoot?: string;
}): Promise<StableDesignSuiteManifest> {
  const root = resolve(input.workspaceRoot ?? process.cwd());
  const suite = await loadStableDesignSuite(input.suiteId, root);
  if (!digestPattern.test(input.reviewDigest)) throw new Error("Reviewed script promotion requires a script-review digest.");
  const candidatePrefix = `.local/test-runs/${input.requestId}/candidate-scripts/`;
  const [type, project, feature] = input.suiteId.split("/");
  const stablePrefix = `tests/${type}/${project}/suites/${feature}/`;
  const formalManifestPath = `${candidatePrefix}execution.manifest.ts`;
  const coveragePlanPath = `${candidatePrefix}web-script-coverage-plan.json`;
  if (!existsSync(resolve(root, formalManifestPath))) {
    throw new Error("Reviewed script promotion requires this request's candidate execution.manifest.ts.");
  }
  if (!existsSync(resolve(root, coveragePlanPath))) {
    throw new Error("Reviewed script promotion requires this request's frozen web coverage plan.");
  }
  const coveragePlan = JSON.parse(await readFile(resolve(root, coveragePlanPath), "utf8")) as unknown;
  assertFormalWebCoveragePlan(coveragePlan);
  const formalManifest = await loadFormalExecutionManifestFromPath(formalManifestPath, {
    workspaceRoot: root,
    expectedRequestId: input.requestId
  });
  const manifestCases = new Set(formalManifest.cases.map((item) => item.caseId));
  const coverageCases = new Set(coveragePlan.entries.map((entry) => entry.caseId));
  const bindings = input.caseScripts.map((binding) => ({ ...binding }));
  if (!bindings.length || new Set(bindings.map((binding) => binding.caseId)).size !== bindings.length
    || bindings.some((binding) => !suite.caseIds.includes(binding.caseId)
      || !manifestCases.has(binding.caseId)
      || !coverageCases.has(binding.caseId)
      || !binding.sourcePath.startsWith(candidatePrefix)
      || !binding.sourcePath.endsWith(".formal.spec.ts"))) {
    throw new Error("Reviewed script promotion requires one candidate formal spec binding for every promoted case.");
  }
  const entryPaths = [...new Set([formalManifestPath, ...bindings.map((binding) => binding.sourcePath)])].sort();
  const closure = resolveLocalScriptDependencyClosure({ workspaceRoot: root, entryPaths }).paths;
  const candidateFiles = closure.filter((path) => path.startsWith(candidatePrefix));
  if (!candidateFiles.includes(formalManifestPath)) {
    throw new Error("Reviewed script promotion could not prove the candidate formal manifest closure.");
  }
  const rehome = (path: string) => path.startsWith(candidatePrefix)
    ? `${stablePrefix}${path.slice(candidatePrefix.length)}`
    : path;
  const rewrite = (source: string, targetPath: string): string => source
    .split(candidatePrefix).join(stablePrefix)
    .replace(/(["'])(?:\.\.\/)+src\//gu, (_match, quote: string) => {
      const toSource = relative(dirname(resolve(root, targetPath)), resolve(root, "src")).split(sep).join("/");
      return `${quote}${toSource.startsWith(".") ? toSource : `./${toSource}`}/`;
    });
  for (const path of candidateFiles.filter((path) => path !== formalManifestPath)) {
    const targetPath = rehome(path);
    await atomicWriteText(resolve(root, targetPath), rewrite(await readFile(resolve(root, path), "utf8"), targetPath));
  }
  const buildEvidence = formalManifest.buildEvidence ?? [];
  for (const evidence of buildEvidence) {
    if (!evidence.path.startsWith(candidatePrefix)) {
      throw new Error("Reviewed script promotion only accepts request-local build evidence.");
    }
    if (!digestPattern.test(evidence.sha256 ?? "")) {
      throw new Error("Reviewed script promotion requires SHA-256 build evidence.");
    }
    const targetPath = rehome(evidence.path);
    await atomicWriteText(resolve(root, targetPath), rewrite(await readFile(resolve(root, evidence.path), "utf8"), targetPath));
  }
  const sourceManifest = await readFile(resolve(root, formalManifestPath), "utf8");
  let rewrittenManifest = rewrite(sourceManifest, rehome(formalManifestPath));
  for (const evidence of buildEvidence) {
    const targetPath = rehome(evidence.path);
    const newDigest = fileIdentity(root, targetPath).digest;
    rewrittenManifest = rewrittenManifest.split(evidence.sha256 ?? "").join(newDigest);
  }
  await atomicWriteText(resolve(root, rehome(formalManifestPath)), rewrittenManifest);
  const stableEntryPaths = entryPaths.map(rehome);
  const stableClosure = resolveLocalScriptDependencyClosure({
    workspaceRoot: root,
    entryPaths: stableEntryPaths
  }).paths.map((path) => fileIdentity(root, path));
  const closureDigest = sha256Canonical(stableClosure
    .map((identity) => ({ path: identity.path, digest: identity.digest }))
    .sort((left, right) => left.path.localeCompare(right.path)) as unknown as SafeJsonValue);
  return updateStableDesignScriptAssets({
    suiteId: input.suiteId,
    workspaceRoot: root,
    scriptAssets: {
      schemaVersion: "stable-script-assets-v1",
      formalManifest: fileIdentity(root, rehome(formalManifestPath)),
      scriptClosure: stableClosure,
      caseBindings: bindings.map((binding) => ({
        caseId: binding.caseId,
        entryScript: fileIdentity(root, rehome(binding.sourcePath)),
        closureDigest,
        reviewDigest: input.reviewDigest,
        coveragePlanDigest: coveragePlan.digest,
        compilerVersion: FORMAL_WEB_SCRIPT_COMPILER_VERSION,
        level: "reviewed" as const
      })).sort((left, right) => left.caseId.localeCompare(right.caseId))
    }
  });
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

interface BoundedCasePackageDrift {
  kind: "format_only" | "scoped" | "unsafe";
  affectedCaseIds: string[];
  reasons: string[];
}

/**
 * Resolve an edited case package against the semantic identities captured at
 * acceptance.  This is intentionally stricter than a textual diff: changing
 * document defaults, a case's execution boundary, its RULE mapping, or its
 * source mapping changes the request boundary and must restart full planning.
 */
function assessBoundedCasePackageDrift(input: {
  manifest: StableDesignSuiteManifest;
  workspaceRoot: string;
  driftedCasePaths: string[];
}): BoundedCasePackageDrift {
  const affected = new Set<string>();
  const rules = parseRuleLedger(readFileSync(resolve(input.workspaceRoot, input.manifest.designLedger.path), "utf8"));
  const expectedRulesByCase = new Map<string, string[]>();
  const expectedSourcesByCase = new Map<string, string[]>();
  for (const rule of rules) {
    for (const caseId of rule.caseIds) {
      expectedRulesByCase.set(
        caseId,
        [...new Set([...(expectedRulesByCase.get(caseId) ?? []), rule.ruleId])].sort()
      );
      expectedSourcesByCase.set(
        caseId,
        [...new Set([...(expectedSourcesByCase.get(caseId) ?? []), ...rule.sourceRefs])].sort()
      );
    }
  }
  for (const path of input.driftedCasePaths) {
    const baseline = input.manifest.casePackageBaselines.find((item) => item.path === path);
    if (!baseline) {
      return { kind: "unsafe", affectedCaseIds: [], reasons: [`case_baseline_missing:${path}`] };
    }
    let current: StableDesignCasePackageBaseline;
    try {
      current = currentCasePackageBaseline(input.workspaceRoot, path);
    } catch (error) {
      return {
        kind: "unsafe",
        affectedCaseIds: [],
        reasons: [error instanceof Error ? error.message : `case_package_invalid:${path}`]
      };
    }
    if (current.defaultsDigest !== baseline.defaultsDigest) {
      return { kind: "unsafe", affectedCaseIds: [], reasons: [`case_defaults_drift:${path}`] };
    }
    const baselineByCase = new Map(baseline.cases.map((testcase) => [testcase.caseId, testcase]));
    const currentByCase = new Map(current.cases.map((testcase) => [testcase.caseId, testcase]));
    if (baselineByCase.size !== currentByCase.size
      || [...baselineByCase.keys()].some((caseId) => !currentByCase.has(caseId))) {
      return { kind: "unsafe", affectedCaseIds: [], reasons: [`case_identity_set_drift:${path}`] };
    }
    const currentDocument = parseTestcaseDocument(readFileSync(resolve(input.workspaceRoot, path), "utf8"));
    for (const testcase of currentDocument.cases) {
      const frozen = baselineByCase.get(testcase.caseId)!;
      if (testcaseExecutionBoundaryDigest(testcase, currentDocument.defaults)
        !== frozen.executionBoundaryDigest) {
        return {
          kind: "unsafe",
          affectedCaseIds: [],
          reasons: [`case_execution_boundary_drift:${testcase.caseId}`]
        };
      }
      const expectedRules = expectedRulesByCase.get(testcase.caseId) ?? [];
      const expectedSources = expectedSourcesByCase.get(testcase.caseId) ?? [];
      if (canonicalJson([...testcase.ruleIds].sort() as unknown as SafeJsonValue)
          !== canonicalJson(expectedRules as unknown as SafeJsonValue)
        || canonicalJson([...testcase.overrides.sourceRefs].sort() as unknown as SafeJsonValue)
          !== canonicalJson(expectedSources as unknown as SafeJsonValue)) {
        return {
          kind: "unsafe",
          affectedCaseIds: [],
          reasons: [`case_rule_or_source_mapping_drift:${testcase.caseId}`]
        };
      }
      if (currentByCase.get(testcase.caseId)!.semanticDigest !== frozen.semanticDigest) {
        affected.add(testcase.caseId);
      }
    }
  }
  if (!affected.size) {
    return { kind: "format_only", affectedCaseIds: [], reasons: ["case_package_format_only_drift"] };
  }
  if (affected.size > 8) {
    return {
      kind: "unsafe",
      affectedCaseIds: [...affected].sort(),
      reasons: [`case_semantic_drift_exceeds_scoped_limit:${affected.size}`]
    };
  }
  return {
    kind: "scoped",
    affectedCaseIds: [...affected].sort(),
    reasons: ["bounded_case_semantic_drift", `affected_case_count:${affected.size}`]
  };
}

export async function assessStableDesignSuite(input: {
  suiteId: string;
  environment: string;
  /** Explicit sources supplied for this request, outside the frozen registry. */
  additionalSourcePaths?: string[];
  workspaceRoot?: string;
}): Promise<DesignSuiteAssessment & { manifest: StableDesignSuiteManifest }> {
  const root = resolve(input.workspaceRoot ?? process.cwd());
  const validation = await validateStableDesignSuite(input.suiteId, root);
  const { manifest } = validation;
  const additionalSourcePaths = normalizeControlledSourcePaths(input.additionalSourcePaths, root);
  if (!manifest.allowedEnvironments.includes(input.environment as "test" | "pre")) {
    return {
      manifest,
      decision: "full_replan",
      selectedCaseIds: [],
      affectedCaseIds: [],
      reasons: ["environment_outside_suite_policy"]
    };
  }
  const casePackagePaths = new Set(manifest.casePackages.map((item) => item.path));
  const nonCaseSuiteDrift = validation.driftedSuitePaths.filter((path) => !casePackagePaths.has(path));
  const driftedCasePaths = validation.driftedSuitePaths.filter((path) => casePackagePaths.has(path));
  if (nonCaseSuiteDrift.length) {
    return {
      manifest,
      decision: "full_replan",
      selectedCaseIds: [],
      affectedCaseIds: [],
      reasons: [
        "suite_design_drift_out_of_band",
        ...nonCaseSuiteDrift.map((path) => `asset_digest_drift:${path}`)
      ]
    };
  }
  const registeredPaths = new Set(
    manifest.sourceRegistry.flatMap((registration) => registration.sourcePaths)
  );
  const newSourcePaths = additionalSourcePaths.filter((path) => !registeredPaths.has(path));
  if (newSourcePaths.length) {
    return {
      manifest,
      decision: "full_replan",
      selectedCaseIds: [],
      affectedCaseIds: [],
      reasons: newSourcePaths.map((path) => `new_request_source:${path}`)
    };
  }
  let caseDrift: BoundedCasePackageDrift | undefined;
  if (driftedCasePaths.length) {
    caseDrift = assessBoundedCasePackageDrift({
      manifest,
      workspaceRoot: root,
      driftedCasePaths
    });
    if (!validation.driftedSourceIds.length && caseDrift.kind === "format_only") {
      return {
        manifest,
        decision: "design_reconfirm",
        selectedCaseIds: [...manifest.profiles.full_feature].sort(),
        affectedCaseIds: [],
        reasons: caseDrift.reasons
      };
    }
    if (!validation.driftedSourceIds.length && caseDrift.kind === "scoped") {
      return {
        manifest,
        decision: "affected_rebuild",
        selectedCaseIds: caseDrift.affectedCaseIds,
        affectedCaseIds: caseDrift.affectedCaseIds,
        reasons: caseDrift.reasons
      };
    }
    if (caseDrift.kind === "unsafe") return {
      manifest,
      decision: "full_replan",
      selectedCaseIds: [],
      affectedCaseIds: caseDrift.affectedCaseIds,
      reasons: ["suite_design_drift_out_of_band", ...caseDrift.reasons]
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
  if (caseDrift?.kind === "scoped") caseDrift.affectedCaseIds.forEach((caseId) => affected.add(caseId));
  if (affected.size > 8) {
    return {
      manifest,
      decision: "full_replan",
      selectedCaseIds: [],
      affectedCaseIds: [...affected].sort(),
      reasons: ["combined_impact_closure_exceeds_scoped_limit", `affected_case_count:${affected.size}`]
    };
  }
  return {
    manifest,
    decision: "affected_rebuild",
    selectedCaseIds: [...affected].sort(),
    affectedCaseIds: [...affected].sort(),
    reasons: [
      "complete_case_impact_mapping",
      ...(caseDrift?.kind === "scoped" ? ["combined_source_and_case_semantic_drift"] : []),
      ...validation.driftedSourceIds.map((sourceId) => `source_digest_drift:${sourceId}`)
    ]
  };
}

/** Load and fully validate a registered design-tier suite manifest. */
export async function loadStableDesignSuite(
  suiteId: string,
  workspaceRoot = process.cwd()
): Promise<StableDesignSuiteManifest> {
  const root = resolve(workspaceRoot);
  const path = designSuiteManifestPath(suiteId, root);
  if (!existsSync(path)) {
    throw new Error(`Stable design suite is not registered: ${suiteId}.`);
  }
  return parseStableDesignSuiteManifest(
    JSON.parse(await readFile(path, "utf8")) as unknown,
    suiteId
  );
}

/**
 * Materialize a design-tier affected rebuild into the request-local archive.
 *
 * A design-tier manifest has no formal scripts to relocate, but its unchanged
 * case packages must still be copied before targeted evolution. Otherwise a
 * candidate-generation worker would mutate the Git-tracked stable suite while
 * rebuilding only the affected RULE/case closure.
 */
export async function materializeAffectedDesignSuiteWorkspace(input: {
  suiteId: string;
  runRequestId: string;
  workspaceRoot?: string;
}): Promise<{ casePackagePaths: string[] }> {
  const root = resolve(input.workspaceRoot ?? process.cwd());
  const suiteScope = input.suiteId.split("/").slice(0, 2).join("/");
  const requestScope = input.runRequestId.split("/").slice(0, 2).join("/");
  if (!suiteIdPattern.test(input.suiteId)
    || !requestIdPattern.test(input.runRequestId)
    || suiteScope !== requestScope) {
    throw new Error("Affected design suite workspace must use the suite type/project scope.");
  }
  const manifest = await loadStableDesignSuite(input.suiteId, root);
  const runRoot = resolve(root, ".local", "test-runs", ...input.runRequestId.split("/"));
  const casePackagePaths: string[] = [];
  for (const identity of manifest.casePackages) {
    const target = resolve(runRoot, basename(identity.path));
    await atomicWriteText(target, await readFile(resolve(root, identity.path), "utf8"));
    casePackagePaths.push(target);
  }
  return { casePackagePaths: casePackagePaths.sort() };
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
