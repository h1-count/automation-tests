import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { FormalExecutionManifest } from "./types.js";
import {
  findTestAsset,
  loadTestAssetManifest,
  resolveAssetPath
} from "../test-assets/assetManifest.js";
import {
  FORMAL_SOURCE_CONTRACT_SCHEMA_VERSION,
  resolveFormalSourceContract,
  validateEvidenceSourceFiles
} from "./sourceContract.js";
import { validateBrowserExplorationEvidence } from "../web/browserExploration.js";

export interface SelectorBuildIdentity {
  targetBuildDigest: string;
  evidenceDigests: string[];
  sources: string[];
}

export interface FrozenBuildIdentityInput {
  manifest: FormalExecutionManifest;
  workspaceRoot: string;
  targetBuildDigest: string;
  selectorEvidenceDigests: string[];
}

type BrowserResponseFinality = "accepted" | "final" | "conditional";

export function assertFormalBuildAuthorization(input: {
  manifest: FormalExecutionManifest;
  authorizationSchemaVersion: string;
}): void {
  if (input.manifest.schemaVersion !== "formal-execution-manifest-v1"
    || input.authorizationSchemaVersion !== "execution-authorization-v1") {
    throw new Error(
      "formal-execution-manifest-v1 requires a readiness-bound execution authorization."
    );
  }
}

export async function resolveSelectorBuildIdentity(input: {
  manifest: FormalExecutionManifest;
  workspaceRoot: string;
  suppliedTargetBuildDigest?: string;
  suppliedEvidenceDigests?: string[];
}): Promise<SelectorBuildIdentity> {
  const workspaceRoot = await realpath(resolve(input.workspaceRoot));
  const evidenceDefinitions = input.manifest.buildEvidence ?? [];
  const sources = [...new Set(evidenceDefinitions.map((item) => item.path.trim()))].sort();
  if (!sources.length) {
    throw new Error(
      "Execution readiness requires frozen build evidence with targetBuildDigest."
    );
  }

  const evidenceDigests: string[] = [];
  const targetBuildDigests = new Set<string>();
  const browserResponseContracts = new Map<string, { finality: BrowserResponseFinality; source: string }>();
  for (const definition of evidenceDefinitions) {
    const source = definition.path.trim();
    const absolute = resolve(workspaceRoot, source);
    const withinRoot = relative(workspaceRoot, absolute);
    if (isOutsideWorkspace(withinRoot)) {
      throw new Error(`Selector evidence source is outside the workspace: ${source}.`);
    }
    let canonicalEvidencePath: string;
    try {
      canonicalEvidencePath = await realpath(absolute);
    } catch {
      throw new Error(`Selector evidence source does not exist: ${source}.`);
    }
    if (isOutsideWorkspace(relative(workspaceRoot, canonicalEvidencePath))) {
      throw new Error(`Selector evidence source resolves outside the workspace: ${source}.`);
    }
    if (!(await stat(canonicalEvidencePath)).isFile()) {
      throw new Error(`Selector evidence source must be a regular file: ${source}.`);
    }
    const content = await readFile(canonicalEvidencePath);
    if (sha256(content) !== definition.sha256) {
      throw new Error(`Build evidence ${source} digest differs from its frozen manifest SHA-256.`);
    }
    if (definition.kind === "test_asset") {
      const assetId = definition.assetId!;
      const testAssetRoot = resolve(workspaceRoot, "test-assets");
      const assetPaths = { assetRoot: testAssetRoot };
      const asset = findTestAsset(loadTestAssetManifest(assetPaths), assetId);
      const registeredPath = asset ? resolveAssetPath(asset, assetPaths) : undefined;
      const requestPlatform = input.manifest.requestId.split("/")[0];
      if (!asset
        || asset.status !== "active"
        || !asset.projects?.includes(input.manifest.projectId)
        || asset.platform !== requestPlatform
        || (definition.scope !== undefined && !asset.scopes?.includes(definition.scope))
        || registeredPath !== absolute) {
        throw new Error(
          `Test asset ${assetId} is missing, inactive, outside the project/platform/scope, or its path differs from build evidence.`
        );
      }
      const contentDigest = sha256(content);
      if (contentDigest !== asset.sha256 || contentDigest !== definition.sha256) {
        throw new Error(`Test asset ${assetId} digest differs from test-assets/manifest.yaml.`);
      }
      evidenceDigests.push(sha256(Buffer.concat([
        content,
        Buffer.from(JSON.stringify({
          assetId: asset.assetId,
          path: asset.path,
          sha256: asset.sha256,
          status: asset.status,
          projects: asset.projects,
          platform: asset.platform,
          scopes: asset.scopes,
          version: asset.version
        }), "utf8")
      ])));
      continue;
    }
    let evidence: Record<string, unknown>;
    try {
      evidence = JSON.parse(content.toString("utf8")) as Record<string, unknown>;
    } catch {
      throw new Error(`Selector evidence is not valid JSON: ${source}.`);
    }
    const schemaVersion = String(evidence.schemaVersion);
    const allowedSchemas = evidenceSchemasFor(input.manifest, definition.kind);
    if (!allowedSchemas.includes(schemaVersion)) {
      throw new Error(
        `Build evidence kind ${definition.kind} does not accept schema ${schemaVersion || "missing"}: ${source}.`
      );
    }
    if (schemaVersion === FORMAL_SOURCE_CONTRACT_SCHEMA_VERSION) {
      const resolvedSourceContract = await resolveFormalSourceContract({
        content,
        sourcePath: source,
        manifest: input.manifest,
        workspaceRoot
      });
      targetBuildDigests.add(resolvedSourceContract.targetBuildDigest);
      evidenceDigests.push(resolvedSourceContract.evidenceDigest);
      continue;
    }
    if (evidence.requestId !== input.manifest.requestId) {
      throw new Error(`Selector evidence requestId differs from ${input.manifest.requestId}: ${source}.`);
    }
    const digest = evidence.targetBuildDigest;
    if (typeof digest !== "string" || !/^[a-f0-9]{64}$/u.test(digest)) {
      throw new Error(`Selector evidence has an invalid targetBuildDigest: ${source}.`);
    }
    targetBuildDigests.add(digest);
    await validateEvidenceSourceFiles({
      evidence,
      workspaceRoot,
      sourcePath: source
    });
    if (schemaVersion === "selector-contract-evidence-v1" && "runtimeEvidence" in evidence) {
      const runtimeEvidence = evidence.runtimeEvidence;
      if (!runtimeEvidence || typeof runtimeEvidence !== "object" || Array.isArray(runtimeEvidence)) {
        throw new Error(`Selector runtimeEvidence must be an object: ${source}.`);
      }
      const exploration = (runtimeEvidence as Record<string, unknown>).exploration;
      if (exploration !== undefined) validateBrowserExplorationEvidence(exploration);
    }
    if (schemaVersion === "browser-response-contract-evidence-v1") {
      collectBrowserResponseContracts(evidence, source, browserResponseContracts);
    }
    evidenceDigests.push(sha256(content));
  }
  validateBrowserResponseOracleContracts(input.manifest, browserResponseContracts);
  if (targetBuildDigests.size !== 1) {
    throw new Error(
      `Selector evidence sources disagree on targetBuildDigest: ${[...targetBuildDigests].join(", ")}; sources=${sources.join(", ")}.`
    );
  }

  const targetBuildDigest = [...targetBuildDigests][0]!;
  if (input.suppliedTargetBuildDigest !== undefined) {
    if (!/^[a-f0-9]{64}$/u.test(input.suppliedTargetBuildDigest)) {
      throw new Error("--target-build-digest must be a lowercase SHA-256 digest.");
    }
    if (input.suppliedTargetBuildDigest !== targetBuildDigest) {
      throw new Error(
        `Invalid readiness input: selector evidence targetBuildDigest=${targetBuildDigest}; supplied targetBuildDigest=${input.suppliedTargetBuildDigest}; sources=${sources.join(", ")}.`
      );
    }
  }

  const suppliedEvidenceDigests = input.suppliedEvidenceDigests ?? [];
  if (suppliedEvidenceDigests.some((digest) => !/^[a-f0-9]{64}$/u.test(digest))) {
    throw new Error("--selector-evidence-digest must be a lowercase SHA-256 digest.");
  }
  if (suppliedEvidenceDigests.length > 0
    && !sameValues(suppliedEvidenceDigests, evidenceDigests)) {
    throw new Error(
      `Invalid readiness input: derived selector evidence digests=${evidenceDigests.join(",")}; supplied selector evidence digests=${suppliedEvidenceDigests.join(",")}; sources=${sources.join(", ")}.`
    );
  }

  return {
    targetBuildDigest,
    evidenceDigests,
    sources
  };
}

/**
 * Recomputes every frozen build input and compares it with an accepted
 * execution-authorization v1 snapshot. Runner and workflow finalization
 * must reuse this helper instead of implementing separate drift checks.
 */
export async function verifyFrozenBuildIdentity(
  input: FrozenBuildIdentityInput
): Promise<SelectorBuildIdentity> {
  try {
    const resolved = await resolveSelectorBuildIdentity({
      manifest: input.manifest,
      workspaceRoot: input.workspaceRoot,
      suppliedTargetBuildDigest: input.targetBuildDigest
    });
    if (!sameValues(input.selectorEvidenceDigests, resolved.evidenceDigests)) {
      throw new Error(
        `derived selector evidence digests=${resolved.evidenceDigests.join(",")}; frozen selector evidence digests=${input.selectorEvidenceDigests.join(",")}; sources=${resolved.sources.join(", ")}.`
      );
    }
    return resolved;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown build identity failure.";
    throw new Error(`Frozen build identity verification failed: ${message}`);
  }
}

function evidenceSchemasFor(
  _manifest: FormalExecutionManifest,
  kind: "source_contract" | "selector_contract" | "browser_response_contract"
): string[] {
  if (kind === "selector_contract") return ["selector-contract-evidence-v1"];
  if (kind === "browser_response_contract") return ["browser-response-contract-evidence-v1"];
  return [FORMAL_SOURCE_CONTRACT_SCHEMA_VERSION];
}

function collectBrowserResponseContracts(
  evidence: Record<string, unknown>,
  source: string,
  contracts: Map<string, { finality: BrowserResponseFinality; source: string }>
): void {
  if (!Array.isArray(evidence.contracts)) {
    throw new Error(`Browser response evidence requires contracts: ${source}.`);
  }
  for (const [index, value] of evidence.contracts.entries()) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Browser response contract ${source}#${index} must be an object.`);
    }
    const contract = value as Record<string, unknown>;
    const id = contract.id;
    const finality = contract.finality;
    if (typeof id !== "string" || !id.trim() || !["accepted", "final", "conditional"].includes(String(finality))) {
      throw new Error(`Browser response contract ${source}#${index} has invalid id or finality.`);
    }
    if (contracts.has(id)) {
      throw new Error(`Browser response contract ${id} is duplicated across build evidence.`);
    }
    contracts.set(id, { finality: finality as BrowserResponseFinality, source });
  }
}

function validateBrowserResponseOracleContracts(
  manifest: FormalExecutionManifest,
  contracts: Map<string, { finality: BrowserResponseFinality; source: string }>
): void {
  for (const definition of manifest.cases) {
    for (const oracle of definition.businessOracles ?? []) {
      if (oracle.observationKind !== "browser_response") continue;
      const contractId = oracle.contractId;
      if (!contractId) {
        throw new Error(
          `${definition.caseId}/${oracle.oracleId} browser response oracle has no contractId.`
        );
      }
      const frozen = contracts.get(contractId);
      if (!frozen) {
        throw new Error(
          `${definition.caseId}/${oracle.oracleId} browser response contract ${contractId} is not frozen build evidence.`
        );
      }
      if (frozen.finality === "conditional") {
        throw new Error(
          `${definition.caseId}/${oracle.oracleId} conditional browser response ${contractId} cannot bind to a formal operation oracle.`
        );
      }
      const matchingOperations = (definition.operationEvidence ?? []).filter((item) =>
        item.responseContractId === contractId
      );
      if (matchingOperations.length !== 1) {
        throw new Error(
          `${definition.caseId}/${oracle.oracleId} has no unique matching operation response contract.`
        );
      }
      const operation = matchingOperations[0]!;
      if (frozen.finality !== operation.finality) {
        throw new Error(
          `${definition.caseId}/${oracle.oracleId} frozen browser response finality ${frozen.finality} differs from operation finality ${operation.finality}.`
        );
      }
      if (frozen.finality === "accepted") {
        const queryCapabilityId = operation.queryCapabilityId;
        const matchingPostconditions = (definition.businessOracles ?? []).filter((candidate) =>
          candidate.observationKind === "postcondition_query"
          && candidate.contractId === queryCapabilityId
        );
        if (!queryCapabilityId || matchingPostconditions.length !== 1) {
          throw new Error(
            `${definition.caseId}/${oracle.oracleId} accepted browser response ${contractId} requires exactly one matching postcondition_query oracle for the same operation queryCapabilityId.`
          );
        }
      }
    }
  }
}

function sameValues(left: string[], right: string[]): boolean {
  return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
}

function isOutsideWorkspace(path: string): boolean {
  return isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`);
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
