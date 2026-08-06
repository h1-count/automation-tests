import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { FormalExecutionManifest } from "./types.js";
import {
  findTestAsset,
  loadTestAssetManifest,
  resolveAssetPath
} from "../test-assets/assetManifest.js";

export interface SelectorBuildIdentity {
  targetBuildDigest: string;
  evidenceDigests: string[];
  sources: string[];
}

export async function resolveSelectorBuildIdentity(input: {
  manifest: FormalExecutionManifest;
  workspaceRoot: string;
  suppliedTargetBuildDigest?: string;
  suppliedEvidenceDigests?: string[];
}): Promise<SelectorBuildIdentity> {
  const workspaceRoot = resolve(input.workspaceRoot);
  const evidenceDefinitions = input.manifest.schemaVersion === "formal-execution-manifest-v2"
    ? (input.manifest.buildEvidence ?? [])
    : input.manifest.capabilities.flatMap((capability) => {
          if (capability.source.kind !== "provider"
            || capability.source.providerId !== "selector_evidence") return [];
          const path = capability.source.configuration?.path;
          return typeof path === "string" && path.trim()
            ? [{ kind: "selector_contract" as const, path: path.trim() }]
            : [];
        });
  const sources = [...new Set(evidenceDefinitions.map((item) => item.path.trim()))].sort();
  if (!sources.length) {
    throw new Error(
      "Execution readiness requires frozen build evidence with targetBuildDigest."
    );
  }

  const evidenceDigests: string[] = [];
  const targetBuildDigests = new Set<string>();
  for (const definition of evidenceDefinitions) {
    const source = definition.path.trim();
    const absolute = resolve(workspaceRoot, source);
    const withinRoot = relative(workspaceRoot, absolute);
    if (isAbsolute(withinRoot) || withinRoot === ".." || withinRoot.startsWith(`..${sep}`)) {
      throw new Error(`Selector evidence source is outside the workspace: ${source}.`);
    }
    const content = await readFile(absolute);
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
    if (!["selector-contract-evidence-v1", "source-contract-evidence-v1", "browser-response-contract-evidence-v1"].includes(String(evidence.schemaVersion))) {
      throw new Error(`Selector evidence has an unsupported schema: ${source}.`);
    }
    if (evidence.requestId !== input.manifest.requestId) {
      throw new Error(`Selector evidence requestId differs from ${input.manifest.requestId}: ${source}.`);
    }
    const digest = evidence.targetBuildDigest;
    if (typeof digest !== "string" || !/^[a-f0-9]{64}$/u.test(digest)) {
      throw new Error(`Selector evidence has an invalid targetBuildDigest: ${source}.`);
    }
    targetBuildDigests.add(digest);
    evidenceDigests.push(sha256(content));
  }
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

function sameValues(left: string[], right: string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
