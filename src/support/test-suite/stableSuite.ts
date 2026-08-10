import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  loadConfirmedExecutionAuthorization,
  type ExecutionAuthorizationSnapshot,
  type ExecutionResourcePoolBudget
} from "../formal-execution/authorization.js";
import {
  FormalExecutionStore,
  digestBusinessOracleContracts,
  validateV3BusinessOracleDefinitions
} from "../formal-execution/formalExecutionStore.js";
import {
  digestFormalExecutionManifest,
  validateFormalExecutionManifest
} from "../formal-execution/manifest.js";
import { resolveLocalScriptDependencyClosure } from "../formal-execution/scriptDependencyClosure.js";
import type { FormalExecutionManifest } from "../formal-execution/types.js";
import {
  semanticBuildEvidenceDigest,
  semanticBuildEvidenceValue
} from "../formal-execution/buildEvidenceIdentity.js";
import { atomicWrite, atomicWriteText } from "../test-data/ledgerStore.js";
import { canonicalJson, sha256Canonical } from "../task-workflow/canonicalJson.js";
import type { SafeJsonValue } from "../task-workflow/types.js";
import { DurableWorkflowManager } from "../task-workflow/workflowManager.js";

export const STABLE_TEST_SUITE_SCHEMA_VERSION = "stable-test-suite-manifest-v1" as const;
export const TEST_SUITE_REUSE_ASSESSMENT_SCHEMA_VERSION = "test-suite-reuse-assessment-v1" as const;

export type StableTestSuiteProfile =
  | "full_feature"
  | "smoke"
  | "affected"
  | "failed_or_blocked";
export type StableTestSuiteReuseDecision =
  | "direct_execute"
  | "affected_rebuild"
  | "full_replan";

export interface StableTestSuiteFileIdentity {
  path: string;
  digest: string;
}

export interface StableTestSuiteManifest {
  schemaVersion: typeof STABLE_TEST_SUITE_SCHEMA_VERSION;
  suiteId: string;
  suiteVersion: string;
  status: "stable";
  sourceRequestId: string;
  plan: StableTestSuiteFileIdentity;
  casePackages: StableTestSuiteFileIdentity[];
  caseIds: string[];
  profiles: {
    full_feature: string[];
    smoke: string[];
    failed_or_blocked: string[];
  };
  formalManifest: StableTestSuiteFileIdentity & {
    schemaVersion: FormalExecutionManifest["schemaVersion"];
  };
  entryScripts: StableTestSuiteFileIdentity[];
  scriptClosure: StableTestSuiteFileIdentity[];
  impactMap: Array<{
    path: string;
    kind: "file" | "json_contract_object" | "json_contract_array" | "json_contract_remainder";
    componentId?: string;
    digest: string;
    caseIds: string[];
  }>;
  buildContracts: Array<StableTestSuiteFileIdentity & {
    kind: "source_contract" | "selector_contract" | "browser_response_contract" | "test_asset";
    semanticDigest: string;
  }>;
  oracleContractDigest: string;
  dataWritePolicy: "no_write" | "ephemeral_cleanup" | "reusable_fixture" | "tracked_residual";
  resourceBudgets: Array<{ resourceType: string; maxCreates: number }>;
  resourcePoolBudgets: ExecutionResourcePoolBudget[];
  allowedEnvironments: Array<"test" | "pre">;
  scriptReview: {
    level: "light" | "standard" | "strict";
    evidenceDigests: string[];
  };
  promotion: {
    workflowHeadDigest: string;
    authorizationDigest: string;
    resultDigest: string;
    promotedAt: string;
  };
}

export interface TestSuiteReuseAssessment {
  schemaVersion: typeof TEST_SUITE_REUSE_ASSESSMENT_SCHEMA_VERSION;
  suiteId: string;
  suiteVersion?: string;
  environment: string;
  requestedProfile: StableTestSuiteProfile;
  effectiveProfile: StableTestSuiteProfile;
  decision: StableTestSuiteReuseDecision;
  selectedCaseIds: string[];
  affectedCaseIds: string[];
  reasons: string[];
  assessmentDigest: string;
}

interface SuiteValidationResult {
  manifest: StableTestSuiteManifest;
  driftedPaths: string[];
  closureDrift: boolean;
  refreshedBuildPaths: string[];
}

const suiteIdPattern = /^(?:web|h5|app|api|mqtt|iot|iot-chain)\/[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/u;
const requestIdPattern = /^(?:web|h5|app|api|mqtt|iot|iot-chain)\/[a-z0-9][a-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const digestPattern = /^[a-f0-9]{64}$/u;

export function stableSuiteManifestPath(
  suiteId: string,
  workspaceRoot = process.cwd()
): string {
  assertSuiteId(suiteId);
  const [type, project, feature] = suiteId.split("/");
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

export async function loadStableTestSuite(
  suiteId: string,
  workspaceRoot = process.cwd()
): Promise<StableTestSuiteManifest> {
  const path = stableSuiteManifestPath(suiteId, workspaceRoot);
  if (!existsSync(path)) throw new Error(`Stable test suite is not registered: ${suiteId}.`);
  const manifest = parseStableTestSuiteManifest(
    JSON.parse(await readFile(path, "utf8")) as unknown,
    suiteId
  );
  return manifest;
}

export function stableSuiteEntryScriptsForCases(
  manifest: StableTestSuiteManifest,
  selectedCaseIds: string[]
): string[] {
  const selected = [...new Set(selectedCaseIds)].sort();
  if (!selected.length || selected.some((caseId) => !manifest.caseIds.includes(caseId))) {
    throw new Error("Stable suite entry selection requires declared caseIds.");
  }
  const mappedCases = new Set<string>();
  const paths = manifest.entryScripts.flatMap((item) => {
    if (item.path === manifest.formalManifest.path) return [item.path];
    const entryCases = manifest.impactMap
      .filter((entry) => entry.path === item.path && entry.kind === "file")
      .flatMap((entry) => entry.caseIds);
    if (!entryCases.some((caseId) => selected.includes(caseId))) return [];
    entryCases.filter((caseId) => selected.includes(caseId)).forEach((caseId) => mappedCases.add(caseId));
    return [item.path];
  });
  if (selected.some((caseId) => !mappedCases.has(caseId))
    || !paths.includes(manifest.formalManifest.path)
    || !paths.some((path) => path.endsWith(".formal.spec.ts"))) {
    throw new Error("Stable suite cannot map the selected profile to formal entry scripts.");
  }
  return [...new Set(paths)].sort();
}

export async function validateStableTestSuite(
  suiteId: string,
  workspaceRoot = process.cwd()
): Promise<SuiteValidationResult> {
  const root = resolve(workspaceRoot);
  const manifest = await loadStableTestSuite(suiteId, root);
  const identities: StableTestSuiteFileIdentity[] = [
    manifest.plan,
    ...manifest.casePackages,
    manifest.formalManifest,
    ...manifest.scriptClosure
  ];
  const ordinaryDrift = identities
    .filter((identity) => !fileIdentityMatches(identity, root))
    .map((identity) => identity.path)
    .filter((path, index, values) => values.indexOf(path) === index)
    .sort();
  const refreshedBuildPaths: string[] = [];
  const buildDrift = manifest.buildContracts.flatMap((identity) => {
    try {
      const content = readFileSync(resolve(root, safeWorkspaceFile(root, identity.path)));
      const semanticDigest = semanticBuildEvidenceDigest(identity.kind, content);
      if (fileIdentityMatches(identity, root)) {
        if (semanticDigest !== identity.semanticDigest) {
          throw new Error(`Stable suite build evidence semantic digest is invalid: ${identity.path}.`);
        }
        return [];
      }
      if (semanticDigest === identity.semanticDigest) {
        refreshedBuildPaths.push(identity.path);
        return [];
      }
    } catch {
      // Missing or invalid build evidence is a real drift.
    }
    return [identity.path];
  });
  const driftedPaths = [...new Set([...ordinaryDrift, ...buildDrift])].sort();
  let closureDrift = false;
  try {
    const currentClosure = resolveLocalScriptDependencyClosure({
      workspaceRoot: root,
      entryPaths: manifest.entryScripts.map((item) => item.path)
    }).paths;
    closureDrift = canonicalJson(currentClosure) !== canonicalJson(
      manifest.scriptClosure.map((item) => item.path).sort()
    );
  } catch {
    closureDrift = true;
  }
  return { manifest, driftedPaths, closureDrift, refreshedBuildPaths: refreshedBuildPaths.sort() };
}

export async function materializeAffectedSuiteWorkspace(input: {
  suiteId: string;
  runRequestId: string;
  workspaceRoot?: string;
}): Promise<{
  planPath: string;
  casePackagePaths: string[];
  entryScriptPaths: string[];
}> {
  assertSuiteId(input.suiteId);
  assertRequestId(input.runRequestId);
  if (input.suiteId.split("/").slice(0, 2).join("/")
    !== input.runRequestId.split("/").slice(0, 2).join("/")) {
    throw new Error("Affected suite workspace must use the suite type/project scope.");
  }
  const root = resolve(input.workspaceRoot ?? process.cwd());
  const suite = await loadStableTestSuite(input.suiteId, root);
  const paths = affectedWorkspacePaths(input.suiteId, input.runRequestId);
  const planText = relocateAffectedText(await readFile(resolve(root, suite.plan.path), "utf8"), paths);
  await atomicWriteText(resolve(root, paths.plan), planText);
  const casePackagePaths: string[] = [];
  for (const identity of suite.casePackages) {
    const targetPath = affectedWorkspaceAssetPath(identity.path, paths);
    if (targetPath === identity.path) {
      throw new Error(`Affected suite case package is outside its stable directory: ${identity.path}.`);
    }
    await atomicWriteText(
      resolve(root, targetPath),
      relocateAffectedText(await readFile(resolve(root, identity.path), "utf8"), paths)
    );
    casePackagePaths.push(targetPath);
  }
  const rawBuildDigests = new Map<string, string>();
  for (const contract of suite.buildContracts) {
    const targetPath = affectedWorkspaceAssetPath(contract.path, paths);
    if (targetPath === contract.path) {
      rawBuildDigests.set(contract.semanticDigest, contract.digest);
      continue;
    }
    const source = await readFile(resolve(root, contract.path));
    const content = relocateAffectedBuildEvidence(source, suite.sourceRequestId, input.runRequestId, paths);
    await atomicWriteText(resolve(root, targetPath), content);
    rawBuildDigests.set(
      contract.semanticDigest,
      createHash("sha256").update(content).digest("hex")
    );
  }
  for (const identity of suite.scriptClosure) {
    const targetPath = affectedWorkspaceAssetPath(identity.path, paths);
    if (targetPath === identity.path) continue;
    let source = relocateAffectedScriptSource(
      await readFile(resolve(root, identity.path), "utf8"),
      paths
    );
    if (identity.path === suite.formalManifest.path) {
      source = downgradeFormalManifestSource(
        source,
        suite,
        input.runRequestId,
        rawBuildDigests
      );
    }
    await atomicWriteText(resolve(root, targetPath), source);
  }
  const entryScriptPaths = suite.entryScripts.map((item) =>
    affectedWorkspaceAssetPath(item.path, paths)
  ).sort();
  const currentClosure = resolveLocalScriptDependencyClosure({
    workspaceRoot: root,
    entryPaths: entryScriptPaths
  }).paths;
  const expectedClosure = suite.scriptClosure.map((item) =>
    affectedWorkspaceAssetPath(item.path, paths)
  ).sort();
  if (canonicalJson(currentClosure) !== canonicalJson(expectedClosure)) {
    throw new Error("Affected suite workspace dependency closure differs from the stable suite.");
  }
  const formalManifestPath = affectedWorkspaceAssetPath(suite.formalManifest.path, paths);
  const formalManifest = await importFormalManifest(root, formalManifestPath);
  if (formalManifest.schemaVersion !== "formal-execution-manifest-v3"
    || formalManifest.requestId !== input.runRequestId
    || canonicalJson(formalManifest.cases.map((item) => item.caseId).sort())
      !== canonicalJson([...suite.caseIds].sort())) {
    throw new Error("Affected suite workspace formal manifest identity is invalid.");
  }
  return {
    planPath: paths.plan,
    casePackagePaths: casePackagePaths.sort(),
    entryScriptPaths
  };
}

export async function assessStableTestSuite(input: {
  suiteId: string;
  environment: string;
  profile?: StableTestSuiteProfile;
  workspaceRoot?: string;
}): Promise<TestSuiteReuseAssessment> {
  const root = resolve(input.workspaceRoot ?? process.cwd());
  assertSuiteId(input.suiteId);
  const requestedProfile = input.profile ?? "full_feature";
  assertProfile(requestedProfile);
  if (/^prod(?:uction)?$/iu.test(input.environment)) {
    return assessment({
      suiteId: input.suiteId,
      environment: input.environment,
      requestedProfile,
      effectiveProfile: requestedProfile,
      decision: "full_replan",
      selectedCaseIds: [],
      affectedCaseIds: [],
      reasons: ["production_environment_forbidden"]
    });
  }
  if (input.environment !== "test" && input.environment !== "pre") {
    throw new Error("Stable suite assessment environment must be test or pre.");
  }
  if (!existsSync(stableSuiteManifestPath(input.suiteId, root))) {
    return assessment({
      suiteId: input.suiteId,
      environment: input.environment,
      requestedProfile,
      effectiveProfile: requestedProfile,
      decision: "full_replan",
      selectedCaseIds: [],
      affectedCaseIds: [],
      reasons: ["stable_suite_not_found"]
    });
  }
  let validation: SuiteValidationResult;
  try {
    validation = await validateStableTestSuite(input.suiteId, root);
  } catch {
    return assessment({
      suiteId: input.suiteId,
      environment: input.environment,
      requestedProfile,
      effectiveProfile: requestedProfile,
      decision: "full_replan",
      selectedCaseIds: [],
      affectedCaseIds: [],
      reasons: ["suite_manifest_invalid"]
    });
  }
  const { manifest, driftedPaths, closureDrift } = validation;
  if (!manifest.allowedEnvironments.includes(input.environment as "test" | "pre")) {
    return assessment({
      suiteId: manifest.suiteId,
      suiteVersion: manifest.suiteVersion,
      environment: input.environment,
      requestedProfile,
      effectiveProfile: requestedProfile,
      decision: "full_replan",
      selectedCaseIds: [],
      affectedCaseIds: [],
      reasons: ["environment_outside_suite_policy"]
    });
  }
  if (!driftedPaths.length && !closureDrift) {
    const effectiveProfile = requestedProfile === "affected" ? "full_feature" : requestedProfile;
    return assessment({
      suiteId: manifest.suiteId,
      suiteVersion: manifest.suiteVersion,
      environment: input.environment,
      requestedProfile,
      effectiveProfile,
      decision: "direct_execute",
      selectedCaseIds: selectProfileCases(manifest, effectiveProfile),
      affectedCaseIds: [],
      reasons: [
        ...(requestedProfile === "affected"
          ? ["affected_profile_without_change_map_falls_back_to_full_feature"]
          : []),
        ...(validation.refreshedBuildPaths.length
          ? ["target_build_changed_contract_semantics_unchanged"]
          : ["suite_assets_exact"])
      ]
    });
  }
  const impact = closureDrift
    ? { caseIds: [], complete: false }
    : await resolveAffectedImpact(manifest, driftedPaths, root);
  const affectedCaseIds = expandAffectedCaseIds(manifest, impact.caseIds);
  const designPaths = new Set([
    manifest.plan.path,
    ...manifest.casePackages.map((item) => item.path),
    manifest.formalManifest.path
  ]);
  const onlyMappedScriptDrift = !closureDrift
    && driftedPaths.length > 0
    && driftedPaths.every((path) => !designPaths.has(path))
    && impact.complete
    && affectedCaseIds.length > 0;
  return assessment({
    suiteId: manifest.suiteId,
    suiteVersion: manifest.suiteVersion,
    environment: input.environment,
    requestedProfile,
    effectiveProfile: onlyMappedScriptDrift ? "affected" : requestedProfile,
    decision: onlyMappedScriptDrift ? "affected_rebuild" : "full_replan",
    selectedCaseIds: onlyMappedScriptDrift ? affectedCaseIds : [],
    affectedCaseIds,
    reasons: [
      ...(closureDrift ? ["script_dependency_closure_drift"] : []),
      ...driftedPaths.map((path) => `asset_digest_drift:${path}`),
      onlyMappedScriptDrift ? "complete_case_impact_mapping" : "impact_mapping_incomplete_or_core_contract_drift"
    ]
  });
}

function expandAffectedCaseIds(
  manifest: StableTestSuiteManifest,
  initialCaseIds: string[]
): string[] {
  const affected = new Set(initialCaseIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of manifest.impactMap.filter((item) => item.kind === "file")) {
      if (!entry.caseIds.some((caseId) => affected.has(caseId))) continue;
      for (const caseId of entry.caseIds) {
        if (!affected.has(caseId)) {
          affected.add(caseId);
          changed = true;
        }
      }
    }
  }
  return [...affected].sort();
}

export async function promoteStableTestSuite(input: {
  requestId: string;
  suiteId: string;
  workspaceRoot?: string;
  promotedAt?: string;
}): Promise<{ path: string; manifest: StableTestSuiteManifest; created: boolean }> {
  assertRequestId(input.requestId);
  assertSuiteId(input.suiteId);
  if (input.requestId.split("/").slice(0, 2).join("/")
    !== input.suiteId.split("/").slice(0, 2).join("/")) {
    throw new Error("Stable suite and source request must use the same type/project scope.");
  }
  const root = resolve(input.workspaceRoot ?? process.cwd());
  const workflow = new DurableWorkflowManager(input.requestId, root);
  const gate = await workflow.gate();
  if (gate.workflowState !== "SUCCEEDED") {
    throw new Error("Only a WorkflowCompleted request may be promoted to a stable suite.");
  }
  const authorization = await loadConfirmedExecutionAuthorization(
    input.requestId,
    undefined,
    [],
    root
  );
  if (!authorization.targetBuildDigest || !authorization.scriptReview) {
    throw new Error("Stable suite promotion requires readiness and frozen script-review evidence.");
  }
  const authorizedSuite = authorization.schemaVersion === "execution-authorization-v5"
    ? await loadStableTestSuite(authorization.suiteId!, root)
    : undefined;
  if (authorizedSuite
    && (authorization.suiteId !== input.suiteId
      || authorization.suiteVersion !== authorizedSuite.suiteVersion)) {
    throw new Error("A suite-backed run may only promote the exact authorized stable suite.");
  }
  const reuseMetadata = gate.activities["reuse-assessment"]?.definition.metadata;
  const affectedBaseSuite = reuseMetadata?.decision === "affected_rebuild"
    && reuseMetadata.suiteId === input.suiteId
    && typeof reuseMetadata.suiteVersion === "string"
    ? await loadStableTestSuite(input.suiteId, root)
    : undefined;
  if (affectedBaseSuite
    && affectedBaseSuite.suiteVersion !== reuseMetadata?.suiteVersion) {
    throw new Error("Affected rebuild may only update the stable suite version it assessed.");
  }
  const baseSuite = authorizedSuite ?? affectedBaseSuite;
  const store = new FormalExecutionStore(
    resolve(root, ".local/test-ledger"),
    resolve(root, "artifacts/test-results/formal")
  );
  const record = await store.read(authorization.digest);
  if (!record?.completionSeal) {
    throw new Error("Stable suite promotion requires a sealed formal execution record.");
  }
  const report = await store.materializeSealedReport(authorization.digest);
  if (report.summary.counts.unknown > 0
    || report.summary.stageProgress.some((item) => item.waitingTransitionIds.length > 0)
    || !["clean", "reusable", "retained"].includes(report.summary.dataHygieneStatus)) {
    throw new Error("Stable suite promotion requires settled cases and accepted cleanup.");
  }
  const requestRoot = workflow.requestRoot;
  const sourceCasePackagePaths = authorizedSuite
    ? authorizedSuite.casePackages.map((item) => item.path)
    : (await readdir(requestRoot))
      .filter((name) => /^cases-[a-z0-9][a-z0-9-]*\.md$/u.test(name))
      .sort()
      .map((name) => workspacePath(root, resolve(requestRoot, name)));
  if (!sourceCasePackagePaths.length) {
    throw new Error("Stable suite promotion requires at least one case package.");
  }
  const formalManifestIdentity = authorization.scriptDigests.find((item) =>
    item.path.endsWith("/execution.manifest.ts")
  );
  if (!formalManifestIdentity) {
    throw new Error("Stable suite promotion requires an authorized execution.manifest.ts.");
  }
  const formalManifest = await importFormalManifest(root, formalManifestIdentity.path);
  if (!["formal-execution-manifest-v3", "formal-execution-manifest-v4"]
    .includes(formalManifest.schemaVersion)) {
    throw new Error("Stable suite promotion requires a v3 or v4 formal execution manifest.");
  }
  if (formalManifest.schemaVersion === "formal-execution-manifest-v4"
    && formalManifest.suiteId !== input.suiteId) {
    throw new Error("A v4 formal manifest may only update its own stable suite.");
  }
  if (formalManifest.requestId !== input.requestId
    && (!baseSuite || formalManifest.requestId !== baseSuite.sourceRequestId)) {
    throw new Error("Promoted formal manifest belongs to another request.");
  }
  if (digestFormalExecutionManifest(formalManifest) !== record.manifestDigest) {
    throw new Error("Promoted formal manifest differs from the sealed execution record.");
  }
  const sourceEntryScripts = authorization.scriptDigests
    .filter((item) => item.path.endsWith("/execution.manifest.ts") || item.path.endsWith(".formal.spec.ts"))
    .map((item) => ({ ...item }))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (!sourceEntryScripts.some((item) => item.path.endsWith(".formal.spec.ts"))) {
    throw new Error("Stable suite promotion requires at least one authorized formal spec.");
  }
  const closure = resolveLocalScriptDependencyClosure({
    workspaceRoot: root,
    entryPaths: sourceEntryScripts.map((item) => item.path)
  }).paths;
  const sourceScriptClosure = closure.map((path) => identityForFile(root, path));
  if (canonicalJson(sourceScriptClosure as unknown as SafeJsonValue) !== canonicalJson(
    authorization.scriptDigests.map((item) => ({ ...item })).sort((left, right) => left.path.localeCompare(right.path)) as unknown as SafeJsonValue
  )) {
    throw new Error("Authorized scripts differ from the exact current dependency closure.");
  }
  const sourceBuildContracts = (formalManifest.buildEvidence ?? []).map((item) => {
    const identity = identityForFile(root, item.path);
    return {
      kind: item.kind,
      ...identity,
      semanticDigest: semanticBuildEvidenceDigest(
        item.kind,
        readFileSync(resolve(root, identity.path))
      )
    };
  }).sort((left, right) => `${left.kind}:${left.path}`.localeCompare(`${right.kind}:${right.path}`));
  const suiteAssetPaths = stableSuiteAssetPaths(input.suiteId, input.requestId);
  const affectedCaseIds = affectedBaseSuite
    ? affectedCaseIdsFromMetadata(reuseMetadata)
    : [];
  const selectedRunCaseIds = [...new Set([
    ...authorization.caseIds,
    ...(authorization.deferredCases ?? []).map((item) => item.caseId)
  ])].sort();
  if (affectedBaseSuite
    && canonicalJson(selectedRunCaseIds) !== canonicalJson(affectedCaseIds)) {
    throw new Error("Affected rebuild execution scope differs from its deterministic impact assessment.");
  }
  const suiteCaseIds = baseSuite
    ? formalManifest.cases.map((item) => item.caseId).sort()
    : selectedRunCaseIds;
  if (baseSuite
    && canonicalJson(suiteCaseIds) !== canonicalJson([...baseSuite.caseIds].sort())) {
    throw new Error("Suite reuse cannot add or remove stable suite cases without a full replan.");
  }
  if (baseSuite?.entryScripts.some((item) => item.path !== baseSuite.formalManifest.path
    && !baseSuite.impactMap.some((entry) => entry.path === item.path
      && entry.kind === "file"
      && entry.caseIds.length > 0))) {
    throw new Error("Suite reuse cannot prove every entry script's case ownership.");
  }
  if (affectedBaseSuite) {
    validateAffectedFormalManifestEvolution({
      baseManifest: await importFormalManifest(root, affectedBaseSuite.formalManifest.path),
      candidateManifest: formalManifest,
      selectedCaseIds: affectedCaseIds,
      paths: suiteAssetPaths
    });
  }
  const sourcePlanPath = authorizedSuite
    ? resolve(root, authorizedSuite.plan.path)
    : workflow.planPath;
  await atomicWriteText(
    resolve(root, suiteAssetPaths.plan),
    await readFile(sourcePlanPath, "utf8")
  );
  for (const sourcePath of sourceCasePackagePaths) {
    await atomicWriteText(
      resolve(root, stableSuiteAssetPath(sourcePath, suiteAssetPaths)),
      await readFile(resolve(root, sourcePath), "utf8")
    );
  }
  for (const identity of sourceScriptClosure) {
    const targetPath = stableSuiteAssetPath(identity.path, suiteAssetPaths);
    if (targetPath === identity.path) continue;
    const source = await readFile(resolve(root, identity.path), "utf8");
    let relocatedSource = relocateStableScriptSource(
      source,
      suiteAssetPaths.sourceTestPrefix,
      suiteAssetPaths.stableTestPrefix
    );
    if (identity.path === formalManifestIdentity.path
      && formalManifest.schemaVersion === "formal-execution-manifest-v3") {
      relocatedSource = upgradeFormalManifestSource(
        relocatedSource,
        input.suiteId,
        formalManifest.requestId,
        sourceBuildContracts
      );
    }
    await atomicWriteText(
      resolve(root, targetPath),
      relocatedSource
    );
  }
  for (const contract of sourceBuildContracts) {
    const targetPath = stableSuiteAssetPath(contract.path, suiteAssetPaths);
    if (targetPath === contract.path) continue;
    await atomicWriteText(resolve(root, targetPath), await readFile(resolve(root, contract.path), "utf8"));
  }
  const stableFormalManifestPath = stableSuiteAssetPath(
    formalManifestIdentity.path,
    suiteAssetPaths
  );
  const stableFormalManifest = await importFormalManifest(root, stableFormalManifestPath);
  const pathRelocatedManifest = replaceStringPrefixDeep(
    formalManifest,
    suiteAssetPaths.sourceTestPrefix,
    suiteAssetPaths.stableTestPrefix
  ) as FormalExecutionManifest;
  const relocatedManifest = sourceBuildContracts.reduce(
    (current, contract) => replaceStringExactDeep(
      current,
      contract.digest,
      contract.semanticDigest
    ) as FormalExecutionManifest,
    pathRelocatedManifest
  );
  const expectedStableManifest: FormalExecutionManifest = formalManifest.schemaVersion
    === "formal-execution-manifest-v3"
    ? {
        ...relocatedManifest,
        schemaVersion: "formal-execution-manifest-v4",
        suiteId: input.suiteId,
        sourceRequestId: formalManifest.requestId
      }
    : relocatedManifest;
  if (digestFormalExecutionManifest(stableFormalManifest)
    !== digestFormalExecutionManifest(expectedStableManifest)) {
    throw new Error("Stable suite materialization changed the formal manifest beyond path relocation.");
  }
  const currentEntryScripts = sourceEntryScripts.map((item) =>
    identityForFile(root, stableSuiteAssetPath(item.path, suiteAssetPaths))
  ).sort((left, right) => left.path.localeCompare(right.path));
  const retainedEntryScripts = baseSuite
    ? baseSuite.entryScripts.filter((item) => {
        if (item.path === baseSuite.formalManifest.path) return false;
        const mappedCases = baseSuite.impactMap
          .filter((entry) => entry.path === item.path && entry.kind === "file")
          .flatMap((entry) => entry.caseIds);
        if (!mappedCases.length) {
          throw new Error(`Suite reuse cannot prove entry-script ownership: ${item.path}.`);
        }
        return !mappedCases.some((caseId) => selectedRunCaseIds.includes(caseId));
      })
    : [];
  const entryScripts = [...new Map(
    [...currentEntryScripts, ...retainedEntryScripts].map((item) => [item.path, item] as const)
  ).values()].sort((left, right) => left.path.localeCompare(right.path));
  const scriptClosure = resolveLocalScriptDependencyClosure({
    workspaceRoot: root,
    entryPaths: entryScripts.map((item) => item.path)
  }).paths.map((path) => identityForFile(root, path));
  const buildContracts = sourceBuildContracts.map((item) => {
    const identity = identityForFile(root, stableSuiteAssetPath(item.path, suiteAssetPaths));
    return {
      kind: item.kind,
      ...identity,
      semanticDigest: semanticBuildEvidenceDigest(
        item.kind,
        readFileSync(resolve(root, identity.path))
      )
    };
  }).sort((left, right) => `${left.kind}:${left.path}`.localeCompare(`${right.kind}:${right.path}`));
  const impactMap = buildStableImpactMap({
    manifest: stableFormalManifest,
    formalManifestPath: stableFormalManifestPath,
    entryScriptPaths: entryScripts.map((item) => item.path),
    buildContracts,
    caseIds: suiteCaseIds,
    workspaceRoot: root
  });
  const plan = identityForFile(root, suiteAssetPaths.plan);
  const casePackages = sourceCasePackagePaths.map((path) =>
    identityForFile(root, stableSuiteAssetPath(path, suiteAssetPaths))
  );
  const policies = [...new Set(formalManifest.cases.map((item) =>
    item.dataWritePolicy === "managed_cleanup" ? "ephemeral_cleanup" : item.dataWritePolicy
  ))];
  if (policies.some((item) => item === undefined)) {
    throw new Error("Stable suite promotion requires explicit per-case data-write policies.");
  }
  const dataWritePolicy = strongestDataWritePolicy(
    policies as StableTestSuiteManifest["dataWritePolicy"][]
  );
  const smokeCaseIds = await priorityCaseIds(
    casePackages.map((item) => item.path),
    root,
    "P0"
  );
  const failedOrBlockedCaseIds = [...new Set([
    ...(baseSuite?.profiles.failed_or_blocked ?? []).filter((caseId) =>
      !selectedRunCaseIds.includes(caseId)
    ),
    ...report.summary.cases
    .filter((item) => item.status === "failed" || item.status === "blocked")
    .map((item) => item.caseId)
  ])].sort();
  const suiteCaseSet = new Set(suiteCaseIds);
  const selectedSmokeCaseIds = smokeCaseIds.filter((caseId) => suiteCaseSet.has(caseId));
  const selectedFailedOrBlockedCaseIds = failedOrBlockedCaseIds.filter((caseId) =>
    suiteCaseSet.has(caseId)
  );
  if (formalManifest.environment !== "test" && formalManifest.environment !== "pre") {
    throw new Error("Stable suite promotion supports only test or pre environments.");
  }
  const immutable = {
    schemaVersion: STABLE_TEST_SUITE_SCHEMA_VERSION,
    suiteId: input.suiteId,
    plan,
    casePackages,
    caseIds: suiteCaseIds,
    profiles: {
      full_feature: suiteCaseIds,
      smoke: selectedSmokeCaseIds.length ? selectedSmokeCaseIds : suiteCaseIds,
      failed_or_blocked: selectedFailedOrBlockedCaseIds
    },
    formalManifest: {
      ...identityForFile(root, stableFormalManifestPath),
      schemaVersion: stableFormalManifest.schemaVersion
    },
    entryScripts,
    scriptClosure,
    impactMap,
    buildContracts,
    oracleContractDigest: digestBusinessOracleContracts(
      validateV3BusinessOracleDefinitions(formalManifest, suiteCaseIds)
    ),
    dataWritePolicy,
    resourceBudgets: [...(baseSuite?.resourceBudgets ?? authorization.resourceBudgets)]
      .sort((left, right) => left.resourceType.localeCompare(right.resourceType)),
    resourcePoolBudgets: [...(baseSuite?.resourcePoolBudgets ?? authorization.resourcePoolBudgets ?? [])]
      .sort((left, right) => `${left.resourceType}:${left.baselineContractId}`.localeCompare(
        `${right.resourceType}:${right.baselineContractId}`
      )),
    allowedEnvironments: baseSuite?.allowedEnvironments
      ?? [formalManifest.environment].filter((environment): environment is "test" | "pre" =>
        environment === "test" || environment === "pre"
      ),
    scriptReview: {
      level: strongestScriptReviewLevel(
        baseSuite?.scriptReview.level,
        authorization.scriptReview.level
      ),
      evidenceDigests: [...new Set([
        ...(baseSuite?.scriptReview.evidenceDigests ?? []),
        ...authorization.scriptReview.evidenceDigests
      ])].sort()
    }
  };
  const suiteVersion = digestStableTestSuiteDesign(immutable);
  const path = stableSuiteManifestPath(input.suiteId, root);
  const existing = existsSync(path)
    ? await loadStableTestSuite(input.suiteId, root)
    : undefined;
  if (existing?.suiteVersion === suiteVersion
    && existing.promotion.authorizationDigest === authorization.digest
    && existing.promotion.resultDigest === record.completionSeal.resultDigest) {
    return { path: workspacePath(root, path), manifest: existing, created: false };
  }
  const promotedAt = input.promotedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(promotedAt))) throw new Error("promotedAt is invalid.");
  const manifest: StableTestSuiteManifest = {
    ...immutable,
    suiteVersion,
    status: "stable",
    sourceRequestId: baseSuite?.sourceRequestId ?? input.requestId,
    promotion: {
      workflowHeadDigest: gate.head.digest,
      authorizationDigest: authorization.digest,
      resultDigest: record.completionSeal.resultDigest,
      promotedAt
    }
  };
  await mkdir(dirname(path), { recursive: true });
  await atomicWrite(path, manifest);
  return { path: workspacePath(root, path), manifest, created: existing === undefined };
}

function affectedCaseIdsFromMetadata(
  metadata: Record<string, SafeJsonValue> | undefined
): string[] {
  const caseIds = Array.isArray(metadata?.affectedCaseIds)
    ? metadata.affectedCaseIds.filter((item): item is string => typeof item === "string")
    : [];
  if (!caseIds.length || new Set(caseIds).size !== caseIds.length) {
    throw new Error("Affected rebuild is missing its deterministic affected caseIds.");
  }
  return [...caseIds].sort();
}

function validateAffectedFormalManifestEvolution(input: {
  baseManifest: FormalExecutionManifest;
  candidateManifest: FormalExecutionManifest;
  selectedCaseIds: string[];
  paths: StableSuiteAssetPaths;
}): void {
  if (input.baseManifest.schemaVersion !== "formal-execution-manifest-v4"
    || input.candidateManifest.schemaVersion !== "formal-execution-manifest-v3") {
    throw new Error("Affected rebuild must evolve a stable v4 manifest through a request-scoped v3 candidate.");
  }
  let relocatedBase = replaceStringPrefixDeep(
    replaceStringPrefixDeep(
      input.baseManifest,
      input.paths.stableCasePrefix,
      input.paths.sourceCasePrefix
    ),
    input.paths.stableTestPrefix,
    input.paths.sourceTestPrefix
  ) as FormalExecutionManifest;
  const candidateEvidenceByPath = new Map(
    (input.candidateManifest.buildEvidence ?? []).map((item) => [item.path, item] as const)
  );
  for (const evidence of relocatedBase.buildEvidence ?? []) {
    const candidate = candidateEvidenceByPath.get(evidence.path);
    if (!candidate || !evidence.sha256 || !candidate.sha256) continue;
    relocatedBase = replaceStringExactDeep(
      relocatedBase,
      evidence.sha256,
      candidate.sha256
    ) as FormalExecutionManifest;
  }
  const buildShape = (manifest: FormalExecutionManifest) => (manifest.buildEvidence ?? []).map(
    ({ sha256: _sha256, ...item }) => item
  );
  if (canonicalJson(buildShape(relocatedBase) as unknown as SafeJsonValue)
    !== canonicalJson(buildShape(input.candidateManifest) as unknown as SafeJsonValue)) {
    throw new Error("Affected rebuild changed the stable build-evidence set; full replan is required.");
  }
  const candidateCases = new Map(input.candidateManifest.cases.map((item) => [item.caseId, item]));
  const baseCaseIds = relocatedBase.cases.map((item) => item.caseId).sort();
  const candidateCaseIds = input.candidateManifest.cases.map((item) => item.caseId).sort();
  if (canonicalJson(baseCaseIds) !== canonicalJson(candidateCaseIds)) {
    throw new Error("Affected rebuild changed the stable case set; full replan is required.");
  }
  const mutatingOperations = new Set([
    "send_test_otp",
    "upload_synthetic_file",
    "submit_registration",
    "create_test_resource",
    "update_test_resource",
    "delete_test_resource",
    "change_test_permission",
    "invoke_test_device_action",
    "cleanup_test_resource",
    "retain_tracked_residual"
  ]);
  for (const baseCase of relocatedBase.cases.filter((item) =>
    input.selectedCaseIds.includes(item.caseId)
  )) {
    const candidateCase = candidateCases.get(baseCase.caseId)!;
    const baseBoundary = {
      permissionProfile: baseCase.permissionProfile,
      dataWritePolicy: baseCase.dataWritePolicy,
      consumesResources: baseCase.consumesResources ?? [],
      producesResources: baseCase.producesResources,
      mutatingOperations: (baseCase.requiredOperations ?? [])
        .filter((operation) => mutatingOperations.has(operation)).sort()
    };
    const candidateBoundary = {
      permissionProfile: candidateCase.permissionProfile,
      dataWritePolicy: candidateCase.dataWritePolicy,
      consumesResources: candidateCase.consumesResources ?? [],
      producesResources: candidateCase.producesResources,
      mutatingOperations: (candidateCase.requiredOperations ?? [])
        .filter((operation) => mutatingOperations.has(operation)).sort()
    };
    if (canonicalJson(baseBoundary as unknown as SafeJsonValue)
      !== canonicalJson(candidateBoundary as unknown as SafeJsonValue)) {
      throw new Error(
        `Affected rebuild changed permissions, write boundaries or resource topology for ${baseCase.caseId}; full replan is required.`
      );
    }
  }
  const expectedCases = relocatedBase.cases.map((item) =>
    input.selectedCaseIds.includes(item.caseId) ? candidateCases.get(item.caseId)! : item
  );
  const {
    suiteId: _suiteId,
    sourceRequestId: _sourceRequestId,
    ...baseWithoutSuiteIdentity
  } = relocatedBase;
  const expected: FormalExecutionManifest = {
    ...baseWithoutSuiteIdentity,
    schemaVersion: "formal-execution-manifest-v3",
    requestId: input.candidateManifest.requestId,
    buildEvidence: input.candidateManifest.buildEvidence,
    cases: expectedCases
  };
  if (digestFormalExecutionManifest(expected)
    !== digestFormalExecutionManifest(input.candidateManifest)) {
    throw new Error("Affected rebuild changed manifest scope outside the assessed cases.");
  }
}

function assessment(
  input: Omit<TestSuiteReuseAssessment, "schemaVersion" | "assessmentDigest">
): TestSuiteReuseAssessment {
  const normalized = {
    ...input,
    selectedCaseIds: [...new Set(input.selectedCaseIds)].sort(),
    affectedCaseIds: [...new Set(input.affectedCaseIds)].sort(),
    reasons: [...new Set(input.reasons)].sort()
  };
  return {
    schemaVersion: TEST_SUITE_REUSE_ASSESSMENT_SCHEMA_VERSION,
    ...normalized,
    assessmentDigest: sha256Canonical({
      schemaVersion: TEST_SUITE_REUSE_ASSESSMENT_SCHEMA_VERSION,
      ...normalized
    } as unknown as SafeJsonValue)
  };
}

async function resolveAffectedImpact(
  manifest: StableTestSuiteManifest,
  driftedPaths: string[],
  workspaceRoot: string
): Promise<{ caseIds: string[]; complete: boolean }> {
  const affected = new Set<string>();
  for (const path of driftedPaths) {
    const entries = manifest.impactMap.filter((item) => item.path === path);
    if (!entries.length) return { caseIds: [...affected].sort(), complete: false };
    let content: Buffer;
    try {
      content = readFileSync(resolve(workspaceRoot, safeWorkspaceFile(workspaceRoot, path)));
    } catch {
      return { caseIds: [...affected].sort(), complete: false };
    }
    const componentIds = entries.flatMap((entry) => entry.componentId ? [entry.componentId] : []);
    const changed = entries.filter((entry) =>
      impactEntryDigest(entry, content, componentIds) !== entry.digest
    );
    if (!changed.length || changed.some((entry) => entry.caseIds.length === 0)) {
      return { caseIds: [...affected].sort(), complete: false };
    }
    for (const entry of changed) entry.caseIds.forEach((caseId) => affected.add(caseId));
  }
  return { caseIds: [...affected].sort(), complete: true };
}

function buildStableImpactMap(input: {
  manifest: FormalExecutionManifest;
  formalManifestPath: string;
  entryScriptPaths: string[];
  buildContracts: StableTestSuiteManifest["buildContracts"];
  caseIds: string[];
  workspaceRoot: string;
}): StableTestSuiteManifest["impactMap"] {
  const allowedCases = new Set(input.caseIds);
  const pathCases = new Map<string, Set<string>>();
  const closure = resolveLocalScriptDependencyClosure({
    workspaceRoot: input.workspaceRoot,
    entryPaths: input.entryScriptPaths
  });
  for (const entryPath of input.entryScriptPaths.filter((path) => path.endsWith(".formal.spec.ts"))) {
    const source = readFileSync(resolve(input.workspaceRoot, entryPath), "utf8");
    const caseIds = input.caseIds.filter((caseId) => source.includes(caseId));
    if (!caseIds.length) {
      throw new Error(`Stable suite cannot map ${entryPath} to a declared caseId.`);
    }
    const pending = [entryPath];
    const visited = new Set<string>();
    while (pending.length) {
      const path = pending.pop()!;
      if (visited.has(path)) continue;
      visited.add(path);
      if (path !== input.formalManifestPath) {
        const consumers = pathCases.get(path) ?? new Set<string>();
        caseIds.forEach((caseId) => consumers.add(caseId));
        pathCases.set(path, consumers);
      }
      for (const dependency of closure.dependenciesByPath.get(path) ?? []) pending.push(dependency);
    }
  }
  const entries: StableTestSuiteManifest["impactMap"] = [...pathCases]
    .map(([path, caseIds]) => ({
      path,
      kind: "file" as const,
      digest: identityForFile(input.workspaceRoot, path).digest,
      caseIds: [...caseIds].sort()
    }));
  for (const contract of input.buildContracts) {
    if (contract.kind === "test_asset") continue;
    const content = readFileSync(resolve(input.workspaceRoot, contract.path));
    let semantic: unknown;
    try {
      semantic = semanticBuildEvidenceValue(JSON.parse(content.toString("utf8")));
    } catch {
      entries.push({
        path: contract.path,
        kind: "json_contract_remainder",
        digest: semanticBuildEvidenceDigest(contract.kind, content),
        caseIds: []
      });
      continue;
    }
    const componentEntries = contractImpactComponents(
      input.manifest,
      contract.path,
      semantic,
      allowedCases
    );
    entries.push(...componentEntries);
    const componentIds = componentEntries.flatMap((entry) => entry.componentId ? [entry.componentId] : []);
    entries.push({
      path: contract.path,
      kind: "json_contract_remainder",
      digest: impactEntryDigest({
        path: contract.path,
        kind: "json_contract_remainder",
        digest: "0".repeat(64),
        caseIds: []
      }, content, componentIds),
      caseIds: []
    });
  }
  return entries.sort((left, right) =>
    `${left.path}:${left.kind}:${left.componentId ?? ""}`.localeCompare(
      `${right.path}:${right.kind}:${right.componentId ?? ""}`
    )
  );
}

function contractImpactComponents(
  manifest: FormalExecutionManifest,
  path: string,
  semantic: unknown,
  allowedCases: Set<string>
): StableTestSuiteManifest["impactMap"] {
  if (!semantic || typeof semantic !== "object" || Array.isArray(semantic)) return [];
  const contracts = (semantic as Record<string, unknown>).contracts;
  const components: StableTestSuiteManifest["impactMap"] = [];
  if (contracts && typeof contracts === "object" && !Array.isArray(contracts)) {
    for (const [componentId, value] of Object.entries(contracts as Record<string, unknown>)) {
      const caseIds = selectorScopeConsumers(manifest, path, componentId, allowedCases);
      if (!caseIds.length) continue;
      components.push({
        path,
        kind: "json_contract_object",
        componentId,
        digest: sha256Canonical(value as SafeJsonValue),
        caseIds
      });
    }
  }
  if (Array.isArray(contracts)) {
    for (const value of contracts) {
      const componentId = typeof value === "string"
        ? value
        : value && typeof value === "object" && !Array.isArray(value)
          ? String((value as Record<string, unknown>).id ?? "")
          : "";
      if (!componentId) continue;
      const caseIds = contractIdConsumers(manifest, componentId, allowedCases);
      if (!caseIds.length) continue;
      components.push({
        path,
        kind: "json_contract_array",
        componentId,
        digest: sha256Canonical(value as SafeJsonValue),
        caseIds
      });
    }
  }
  return components;
}

function selectorScopeConsumers(
  manifest: FormalExecutionManifest,
  path: string,
  scopeId: string,
  allowedCases: Set<string>
): string[] {
  return [...new Set(manifest.capabilities.flatMap((capability) => {
    const configuration = capability.source.kind === "provider"
      ? capability.source.configuration
      : undefined;
    return configuration?.path === path && configuration.scopeId === scopeId
      ? capability.requiredForCaseIds.filter((caseId) => allowedCases.has(caseId))
      : [];
  }))].sort();
}

function contractIdConsumers(
  manifest: FormalExecutionManifest,
  contractId: string,
  allowedCases: Set<string>
): string[] {
  const consumers = new Set<string>();
  for (const definition of manifest.cases) {
    if (!allowedCases.has(definition.caseId)) continue;
    const requiredCapabilities = definition.requiredCapabilities.map((item) =>
      typeof item === "string" ? item : item.capabilityId
    );
    const operationContracts = (definition.operationEvidence ?? []).flatMap((item) => [
      item.responseContractId,
      item.uiContractId,
      item.queryCapabilityId
    ]).filter((item): item is string => Boolean(item));
    const oracleContracts = (definition.businessOracles ?? [])
      .flatMap((item) => item.contractId ? [item.contractId] : []);
    if ([...requiredCapabilities, ...operationContracts, ...oracleContracts].includes(contractId)) {
      consumers.add(definition.caseId);
    }
  }
  return [...consumers].sort();
}

function impactEntryDigest(
  entry: StableTestSuiteManifest["impactMap"][number],
  content: Buffer,
  componentIds: string[]
): string {
  if (entry.kind === "file") {
    return createHash("sha256").update(content).digest("hex");
  }
  let semantic: unknown;
  try {
    semantic = semanticBuildEvidenceValue(JSON.parse(content.toString("utf8")));
  } catch {
    return createHash("sha256").update(content).digest("hex");
  }
  if (!semantic || typeof semantic !== "object" || Array.isArray(semantic)) {
    return sha256Canonical(semantic as SafeJsonValue);
  }
  const root = semantic as Record<string, unknown>;
  if (entry.kind === "json_contract_object") {
    const contracts = root.contracts;
    const value = contracts && typeof contracts === "object" && !Array.isArray(contracts)
      ? (contracts as Record<string, unknown>)[entry.componentId!]
      : undefined;
    return sha256Canonical((value ?? { missing: true }) as SafeJsonValue);
  }
  if (entry.kind === "json_contract_array") {
    const value = Array.isArray(root.contracts)
      ? root.contracts.find((item) => typeof item === "string"
        ? item === entry.componentId
        : item && typeof item === "object" && !Array.isArray(item)
          && (item as Record<string, unknown>).id === entry.componentId)
      : undefined;
    return sha256Canonical((value ?? { missing: true }) as SafeJsonValue);
  }
  const remainder = structuredClone(root);
  if (remainder.contracts && typeof remainder.contracts === "object") {
    if (Array.isArray(remainder.contracts)) {
      remainder.contracts = remainder.contracts.filter((item) => {
        const id = typeof item === "string"
          ? item
          : item && typeof item === "object" && !Array.isArray(item)
            ? String((item as Record<string, unknown>).id ?? "")
            : "";
        return !componentIds.includes(id);
      });
    } else {
      remainder.contracts = Object.fromEntries(Object.entries(
        remainder.contracts as Record<string, unknown>
      ).filter(([key]) => !componentIds.includes(key)));
    }
  }
  return sha256Canonical(remainder as SafeJsonValue);
}

function selectProfileCases(
  manifest: StableTestSuiteManifest,
  profile: StableTestSuiteProfile
): string[] {
  if (profile === "smoke") {
    return [...manifest.profiles.smoke].sort();
  }
  if (profile === "failed_or_blocked") {
    return (manifest.profiles.failed_or_blocked.length
      ? manifest.profiles.failed_or_blocked
      : manifest.profiles.full_feature).slice().sort();
  }
  return [...manifest.profiles.full_feature].sort();
}

interface StableSuiteAssetPaths {
  plan: string;
  sourceCasePrefix: string;
  stableCasePrefix: string;
  sourceTestPrefix: string;
  stableTestPrefix: string;
}

interface AffectedWorkspacePaths {
  plan: string;
  stableCasePrefix: string;
  runCasePrefix: string;
  stableTestPrefix: string;
  runTestPrefix: string;
}

function affectedWorkspacePaths(suiteId: string, runRequestId: string): AffectedWorkspacePaths {
  const [type, project, feature] = suiteId.split("/");
  return {
    plan: `testcases/${runRequestId}/plan.md`,
    stableCasePrefix: `testcases/${type}/${project}/suites/${feature}/`,
    runCasePrefix: `testcases/${runRequestId}/`,
    stableTestPrefix: `tests/${type}/${project}/suites/${feature}/`,
    runTestPrefix: `tests/${runRequestId}/`
  };
}

function affectedWorkspaceAssetPath(path: string, paths: AffectedWorkspacePaths): string {
  if (path.startsWith(paths.stableCasePrefix)) {
    return `${paths.runCasePrefix}${path.slice(paths.stableCasePrefix.length)}`;
  }
  if (path.startsWith(paths.stableTestPrefix)) {
    return `${paths.runTestPrefix}${path.slice(paths.stableTestPrefix.length)}`;
  }
  return path;
}

function relocateAffectedText(source: string, paths: AffectedWorkspacePaths): string {
  return source
    .split(paths.stableCasePrefix).join(paths.runCasePrefix)
    .split(paths.stableTestPrefix).join(paths.runTestPrefix);
}

function relocateAffectedBuildEvidence(
  source: Buffer,
  sourceRequestId: string,
  runRequestId: string,
  paths: AffectedWorkspacePaths
): string {
  try {
    const parsed = JSON.parse(source.toString("utf8")) as unknown;
    const relocated = replaceStringExactDeep(
      replaceStringPrefixDeep(
        replaceStringPrefixDeep(parsed, paths.stableCasePrefix, paths.runCasePrefix),
        paths.stableTestPrefix,
        paths.runTestPrefix
      ),
      sourceRequestId,
      runRequestId
    );
    return `${JSON.stringify(relocated, null, 2)}\n`;
  } catch {
    return relocateAffectedText(source.toString("utf8"), paths);
  }
}

function relocateAffectedScriptSource(
  source: string,
  paths: AffectedWorkspacePaths
): string {
  return relocateAffectedText(source, paths)
    .replace(/(\bfrom\s*["'])\.\.\/\.\.\//gu, "$1../")
    .replace(/(\bimport\s*["'])\.\.\/\.\.\//gu, "$1../")
    .replace(/(\b(?:import|require)\s*\(\s*["'])\.\.\/\.\.\//gu, "$1../");
}

function downgradeFormalManifestSource(
  source: string,
  suite: StableTestSuiteManifest,
  runRequestId: string,
  rawBuildDigests: Map<string, string>
): string {
  let downgraded = source.replace(
    /["']?schemaVersion["']?\s*:\s*["']formal-execution-manifest-v4["']/u,
    'schemaVersion: "formal-execution-manifest-v3"'
  );
  if (downgraded === source) {
    throw new Error("Affected rebuild could not locate the stable v4 manifest schema field.");
  }
  downgraded = downgraded
    .replace(/^\s*["']?suiteId["']?\s*:\s*["'][^"']+["']\s*,\s*$/mu, "")
    .replace(/^\s*["']?sourceRequestId["']?\s*:\s*["'][^"']+["']\s*,\s*$/mu, "");
  const requestField = new RegExp(
    `(["']?requestId["']?\\s*:\\s*["'])${escapeRegExp(suite.sourceRequestId)}(["'])`,
    "u"
  );
  const requestScoped = downgraded.replace(requestField, `$1${runRequestId}$2`);
  if (requestScoped === downgraded) {
    throw new Error("Affected rebuild could not replace the stable manifest requestId.");
  }
  return [...rawBuildDigests].reduce(
    (current, [semanticDigest, rawDigest]) => current.split(semanticDigest).join(rawDigest),
    requestScoped
  );
}

function stableSuiteAssetPaths(suiteId: string, requestId: string): StableSuiteAssetPaths {
  const [type, project, feature] = suiteId.split("/");
  const stableCasePrefix = `testcases/${type}/${project}/suites/${feature}/`;
  return {
    plan: `${stableCasePrefix}plan.md`,
    sourceCasePrefix: `testcases/${requestId}/`,
    stableCasePrefix,
    sourceTestPrefix: `tests/${requestId}/`,
    stableTestPrefix: `tests/${type}/${project}/suites/${feature}/`
  };
}

function stableSuiteAssetPath(path: string, paths: StableSuiteAssetPaths): string {
  if (path.startsWith(paths.sourceCasePrefix)) {
    return `${paths.stableCasePrefix}${path.slice(paths.sourceCasePrefix.length)}`;
  }
  if (path.startsWith(paths.sourceTestPrefix)) {
    return `${paths.stableTestPrefix}${path.slice(paths.sourceTestPrefix.length)}`;
  }
  return path;
}

function replaceStringPrefixDeep(value: unknown, source: string, target: string): unknown {
  if (typeof value === "string") return value.split(source).join(target);
  if (Array.isArray(value)) {
    return value.map((item) => replaceStringPrefixDeep(item, source, target));
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    replaceStringPrefixDeep(item, source, target)
  ]));
}

function replaceStringExactDeep(value: unknown, source: string, target: string): unknown {
  if (typeof value === "string") return value === source ? target : value;
  if (Array.isArray(value)) {
    return value.map((item) => replaceStringExactDeep(item, source, target));
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    replaceStringExactDeep(item, source, target)
  ]));
}

function relocateStableScriptSource(
  source: string,
  sourceTestPrefix: string,
  stableTestPrefix: string
): string {
  const relocatedPaths = source.split(sourceTestPrefix).join(stableTestPrefix);
  return relocatedPaths
    .replace(/(\bfrom\s*["'])\.\.\//gu, "$1../../")
    .replace(/(\bimport\s*["'])\.\.\//gu, "$1../../")
    .replace(/(\b(?:import|require)\s*\(\s*["'])\.\.\//gu, "$1../../");
}

function upgradeFormalManifestSource(
  source: string,
  suiteId: string,
  sourceRequestId: string,
  buildContracts: StableTestSuiteManifest["buildContracts"]
): string {
  const upgradedSchema = source.replace(
    /["']?schemaVersion["']?\s*:\s*["']formal-execution-manifest-v3["']/u,
    'schemaVersion: "formal-execution-manifest-v4"'
  );
  if (upgradedSchema === source) {
    throw new Error("Stable suite promotion could not locate the v3 formal manifest schema field.");
  }
  const requestField = new RegExp(
    `(["']?requestId["']?\\s*:\\s*["']${escapeRegExp(sourceRequestId)}["']\\s*,)`,
    "u"
  );
  const upgradedIdentity = upgradedSchema.replace(
    requestField,
    `$1\n  suiteId: "${suiteId}",\n  sourceRequestId: "${sourceRequestId}",`
  );
  if (upgradedIdentity === upgradedSchema) {
    throw new Error("Stable suite promotion could not locate the formal manifest requestId field.");
  }
  return buildContracts.reduce(
    (current, contract) => current.split(contract.digest).join(contract.semanticDigest),
    upgradedIdentity
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function parseStableTestSuiteManifest(value: unknown, expectedSuiteId: string): StableTestSuiteManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Stable test suite manifest must be an object.");
  }
  const manifest = value as StableTestSuiteManifest;
  if (manifest.schemaVersion !== STABLE_TEST_SUITE_SCHEMA_VERSION
    || manifest.suiteId !== expectedSuiteId
    || manifest.status !== "stable") {
    throw new Error("Stable test suite manifest identity is invalid.");
  }
  assertRequestId(manifest.sourceRequestId);
  requireDigest(manifest.suiteVersion, "suiteVersion");
  if (!manifest.caseIds?.length || new Set(manifest.caseIds).size !== manifest.caseIds.length) {
    throw new Error("Stable test suite manifest requires unique caseIds.");
  }
  const [type, project, feature] = expectedSuiteId.split("/");
  const stableCasePrefix = `testcases/${type}/${project}/suites/${feature}/`;
  const stableTestPrefix = `tests/${type}/${project}/suites/${feature}/`;
  if (manifest.plan?.path !== `${stableCasePrefix}plan.md`
    || !manifest.casePackages?.length
    || new Set(manifest.casePackages.map((item) => item.path)).size !== manifest.casePackages.length
    || manifest.casePackages.some((item) => !item.path.startsWith(stableCasePrefix))) {
    throw new Error("Stable suite plan and case packages must live in its no-date suite directory.");
  }
  if (manifest.formalManifest?.schemaVersion !== "formal-execution-manifest-v4") {
    throw new Error("Stable test suites require a suite-scoped formal-execution-manifest-v4.");
  }
  if (!manifest.formalManifest.path.startsWith(stableTestPrefix)
    || manifest.entryScripts?.some((item) => !item.path.startsWith(stableTestPrefix))) {
    throw new Error("Stable suite entry scripts must live in its no-date suite directory.");
  }
  const profileKeys = Object.keys(manifest.profiles ?? {}).sort();
  if (canonicalJson(profileKeys) !== canonicalJson([
    "failed_or_blocked",
    "full_feature",
    "smoke"
  ])) {
    throw new Error("Stable test suite profiles contain an unsupported profile.");
  }
  for (const [profile, caseIds] of Object.entries(manifest.profiles ?? {})) {
    if (!Array.isArray(caseIds)
      || caseIds.some((caseId) => typeof caseId !== "string" || !manifest.caseIds.includes(caseId))) {
      throw new Error(`Stable test suite profile ${profile} contains an undeclared caseId.`);
    }
  }
  if (!manifest.profiles?.full_feature?.length
    || !manifest.profiles?.smoke?.length
    || canonicalJson([...manifest.profiles.full_feature].sort()) !== canonicalJson([...manifest.caseIds].sort())) {
    throw new Error("Stable test suite profiles are incomplete.");
  }
  if (!Array.isArray(manifest.allowedEnvironments)
    || !manifest.allowedEnvironments.length
    || new Set(manifest.allowedEnvironments).size !== manifest.allowedEnvironments.length
    || manifest.allowedEnvironments.some((environment) => !["test", "pre"].includes(environment))) {
    throw new Error("Stable test suite allowedEnvironments must contain unique test/pre values.");
  }
  if (!["no_write", "ephemeral_cleanup", "reusable_fixture", "tracked_residual"]
    .includes(manifest.dataWritePolicy)) {
    throw new Error("Stable test suite dataWritePolicy is invalid.");
  }
  if (!Array.isArray(manifest.resourceBudgets)
    || manifest.resourceBudgets.some((item) => !item
      || typeof item.resourceType !== "string"
      || !item.resourceType
      || !Number.isInteger(item.maxCreates)
      || item.maxCreates < 0)
    || new Set(manifest.resourceBudgets.map((item) => item.resourceType)).size
      !== manifest.resourceBudgets.length) {
    throw new Error("Stable test suite resourceBudgets are invalid.");
  }
  if (!Array.isArray(manifest.resourcePoolBudgets)
    || manifest.resourcePoolBudgets.some((item) => !item
      || typeof item.resourceType !== "string"
      || !item.resourceType
      || typeof item.baselineContractId !== "string"
      || !item.baselineContractId
      || !Number.isInteger(item.maxAvailable)
      || item.maxAvailable < 1
      || !Number.isInteger(item.replacementBudget)
      || item.replacementBudget < 0
      || !Number.isInteger(item.ttlHours)
      || item.ttlHours < 1
      || item.retirementPolicy !== "validate_quarantine_replace")
    || new Set(manifest.resourcePoolBudgets.map((item) =>
      `${item.resourceType}:${item.baselineContractId}`
    )).size !== manifest.resourcePoolBudgets.length) {
    throw new Error("Stable test suite resourcePoolBudgets are invalid.");
  }
  if (!manifest.scriptReview
    || !["light", "standard", "strict"].includes(manifest.scriptReview.level)
    || !Array.isArray(manifest.scriptReview.evidenceDigests)
    || new Set(manifest.scriptReview.evidenceDigests).size
      !== manifest.scriptReview.evidenceDigests.length
    || (manifest.scriptReview.level !== "light"
      && manifest.scriptReview.evidenceDigests.length === 0)) {
    throw new Error("Stable test suite scriptReview is invalid.");
  }
  for (const digest of manifest.scriptReview.evidenceDigests) {
    requireDigest(digest, "script review evidence digest");
  }
  for (const identity of [
    manifest.plan,
    ...manifest.casePackages,
    manifest.formalManifest,
    ...manifest.entryScripts,
    ...manifest.scriptClosure,
    ...manifest.buildContracts
  ]) validateFileIdentity(identity);
  if (new Set(manifest.buildContracts.map((item) => item.path)).size
    !== manifest.buildContracts.length) {
    throw new Error("Stable suite buildContracts must use unique paths.");
  }
  for (const contract of manifest.buildContracts) {
    if (!["source_contract", "selector_contract", "browser_response_contract", "test_asset"]
      .includes(contract.kind)) {
      throw new Error(`Stable suite build contract kind is invalid: ${contract.path}.`);
    }
    requireDigest(contract.semanticDigest, `semanticDigest for ${contract.path}`);
  }
  const entryPaths = manifest.entryScripts.map((item) => item.path);
  const closurePaths = new Set(manifest.scriptClosure.map((item) => item.path));
  if (!entryPaths.length
    || new Set(entryPaths).size !== entryPaths.length
    || manifest.scriptClosure.length !== closurePaths.size
    || entryPaths.some((path) => !closurePaths.has(path))
    || !entryPaths.includes(manifest.formalManifest.path)) {
    throw new Error("Stable test suite entry scripts and exact dependency closure are inconsistent.");
  }
  const impactPaths = new Set([
    ...manifest.scriptClosure.map((item) => item.path),
    ...manifest.buildContracts.map((item) => item.path)
  ]);
  if (!Array.isArray(manifest.impactMap) || !manifest.impactMap.length) {
    throw new Error("Stable test suite requires a deterministic impact map.");
  }
  const impactKeys = new Set<string>();
  for (const entry of manifest.impactMap) {
    if (!entry
      || typeof entry.path !== "string"
      || !impactPaths.has(entry.path)
      || !["file", "json_contract_object", "json_contract_array", "json_contract_remainder"]
        .includes(entry.kind)
      || !Array.isArray(entry.caseIds)
      || new Set(entry.caseIds).size !== entry.caseIds.length
      || entry.caseIds.some((caseId) => !manifest.caseIds.includes(caseId))) {
      throw new Error("Stable test suite impactMap contains an invalid entry.");
    }
    if ((entry.kind === "json_contract_object" || entry.kind === "json_contract_array")
      !== Boolean(entry.componentId)) {
      throw new Error("Stable test suite impactMap component identity is invalid.");
    }
    requireDigest(entry.digest, `impact digest for ${entry.path}`);
    const key = `${entry.path}:${entry.kind}:${entry.componentId ?? ""}`;
    if (impactKeys.has(key)) throw new Error(`Stable test suite impactMap duplicates ${key}.`);
    impactKeys.add(key);
  }
  requireDigest(manifest.oracleContractDigest, "oracleContractDigest");
  requireDigest(manifest.promotion?.workflowHeadDigest, "workflowHeadDigest");
  requireDigest(manifest.promotion?.authorizationDigest, "authorizationDigest");
  requireDigest(manifest.promotion?.resultDigest, "resultDigest");
  if (!Number.isFinite(Date.parse(manifest.promotion?.promotedAt ?? ""))) {
    throw new Error("Stable test suite promotion time is invalid.");
  }
  const { suiteVersion: _suiteVersion, status: _status, sourceRequestId: _sourceRequestId, promotion: _promotion, ...immutable } = manifest;
  if (digestStableTestSuiteDesign(immutable) !== manifest.suiteVersion) {
    throw new Error("Stable test suite suiteVersion does not match its immutable design assets.");
  }
  return structuredClone(manifest);
}

export function digestStableTestSuiteDesign(value: {
  profiles: StableTestSuiteManifest["profiles"];
  buildContracts: StableTestSuiteManifest["buildContracts"];
  [key: string]: unknown;
}): string {
  const versioned = {
    ...value,
    profiles: {
      full_feature: [...value.profiles.full_feature].sort(),
      smoke: [...value.profiles.smoke].sort()
    },
    buildContracts: value.buildContracts.map(({ digest: _digest, ...contract }) => contract)
      .sort((left, right) => `${left.kind}:${left.path}`.localeCompare(`${right.kind}:${right.path}`))
  };
  return sha256Canonical(versioned as unknown as SafeJsonValue);
}

async function importFormalManifest(
  workspaceRoot: string,
  path: string
): Promise<FormalExecutionManifest> {
  const identity = identityForFile(workspaceRoot, path);
  const imported = await import(`${pathToFileURL(resolve(workspaceRoot, identity.path)).href}?sha256=${identity.digest}`) as {
    formalExecutionManifest?: FormalExecutionManifest;
  };
  if (!imported.formalExecutionManifest) {
    throw new Error(`Formal execution manifest export is missing: ${identity.path}.`);
  }
  validateFormalExecutionManifest(imported.formalExecutionManifest);
  return imported.formalExecutionManifest;
}

function identityForFile(workspaceRoot: string, path: string): StableTestSuiteFileIdentity {
  const safePath = safeWorkspaceFile(workspaceRoot, path);
  return {
    path: safePath,
    digest: createHash("sha256").update(readFileSync(resolve(workspaceRoot, safePath))).digest("hex")
  };
}

function strongestDataWritePolicy(
  values: StableTestSuiteManifest["dataWritePolicy"][]
): StableTestSuiteManifest["dataWritePolicy"] {
  const ranking: StableTestSuiteManifest["dataWritePolicy"][] = [
    "no_write",
    "ephemeral_cleanup",
    "reusable_fixture",
    "tracked_residual"
  ];
  return values.reduce((strongest, current) =>
    ranking.indexOf(current) > ranking.indexOf(strongest) ? current : strongest,
  "no_write");
}

function strongestScriptReviewLevel(
  left: StableTestSuiteManifest["scriptReview"]["level"] | undefined,
  right: StableTestSuiteManifest["scriptReview"]["level"]
): StableTestSuiteManifest["scriptReview"]["level"] {
  const rank = { light: 0, standard: 1, strict: 2 } as const;
  return left && rank[left] > rank[right] ? left : right;
}

async function priorityCaseIds(
  casePackagePaths: string[],
  workspaceRoot: string,
  priority: string
): Promise<string[]> {
  const selected = new Set<string>();
  for (const path of casePackagePaths) {
    const content = await readFile(resolve(workspaceRoot, path), "utf8");
    for (const block of content.split(/^##\s+测试用例：/gmu).slice(1)) {
      const caseId = block.match(/^\|\s*用例编号\s*\|\s*([^|]+?)\s*\|\s*$/mu)?.[1]?.trim();
      const casePriority = block.match(/^\|\s*优先级\s*\|\s*([^|]+?)\s*\|\s*$/mu)?.[1]?.trim();
      if (caseId && casePriority === priority) selected.add(caseId);
    }
  }
  return [...selected].sort();
}

function fileIdentityMatches(identity: StableTestSuiteFileIdentity, workspaceRoot: string): boolean {
  try {
    return identityForFile(workspaceRoot, identity.path).digest === identity.digest;
  } catch {
    return false;
  }
}

function safeWorkspaceFile(workspaceRoot: string, path: string): string {
  const root = realpathSync(resolve(workspaceRoot));
  const absolute = resolve(root, path);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    throw new Error(`Stable suite file is missing: ${path}.`);
  }
  const real = realpathSync(absolute);
  const rel = relative(root, real).split(sep).join("/");
  if (!rel || rel === ".." || rel.startsWith("../") || rel.startsWith(".local/") || rel.startsWith("artifacts/")) {
    throw new Error(`Stable suite file must stay in the reviewable workspace: ${path}.`);
  }
  return rel;
}

function workspacePath(workspaceRoot: string, path: string): string {
  return relative(resolve(workspaceRoot), resolve(path)).split(sep).join("/");
}

function validateFileIdentity(identity: StableTestSuiteFileIdentity): void {
  if (!identity || typeof identity.path !== "string" || !identity.path.trim()) {
    throw new Error("Stable suite file identity requires a path.");
  }
  requireDigest(identity.digest, `digest for ${identity.path}`);
}

function assertSuiteId(value: string): void {
  if (!suiteIdPattern.test(value)) {
    throw new Error("suiteId must use <web|h5|app|api|mqtt|iot|iot-chain>/<project>/<feature>.");
  }
}

function assertRequestId(value: string): void {
  if (!requestIdPattern.test(value)) {
    throw new Error("requestId must use <type>/<project>/<request>.");
  }
}

function assertProfile(value: string): asserts value is StableTestSuiteProfile {
  if (!["full_feature", "smoke", "affected", "failed_or_blocked"].includes(value)) {
    throw new Error(`Unsupported stable suite profile: ${value}.`);
  }
}

function requireDigest(value: unknown, label: string): string {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}
