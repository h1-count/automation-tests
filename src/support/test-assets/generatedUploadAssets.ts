import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, relative, resolve, sep } from "node:path";
import { sha256Canonical } from "../task-workflow/canonicalJson.js";
import { localRunRootPath } from "../task-workflow/runRoots.js";

export const GENERATED_UPLOAD_ASSET_MANIFEST_SCHEMA_VERSION = "generated-upload-asset-manifest-v1" as const;
export const OPEN_PLATFORM_REGISTRATION_UPLOAD_GENERATOR_ID = "open-platform-registration-upload-boundaries" as const;
export const OPEN_PLATFORM_REGISTRATION_UPLOAD_GENERATOR_VERSION = "1" as const;
export const UPLOAD_LIMIT_BYTES = 10 * 1024 * 1024;

export const OPEN_PLATFORM_REGISTRATION_UPLOAD_ASSET_IDS = [
  "license-valid-png",
  "license-valid-jpeg",
  "license-valid-jpg",
  "license-invalid-text",
  "license-exact-limit-png",
  "license-over-limit-png"
] as const;

export type OpenPlatformRegistrationUploadAssetId = (typeof OPEN_PLATFORM_REGISTRATION_UPLOAD_ASSET_IDS)[number];

export interface GeneratedUploadAssetRecord {
  assetId: OpenPlatformRegistrationUploadAssetId;
  path: string;
  sha256: string;
  byteLength: number;
  mediaType: "image/png" | "image/jpeg" | "text/plain";
  boundary: "valid" | "invalid_type" | "exact_limit" | "over_limit";
}

export interface GeneratedUploadAssetManifest {
  schemaVersion: typeof GENERATED_UPLOAD_ASSET_MANIFEST_SCHEMA_VERSION;
  requestId: string;
  generator: {
    id: typeof OPEN_PLATFORM_REGISTRATION_UPLOAD_GENERATOR_ID;
    version: typeof OPEN_PLATFORM_REGISTRATION_UPLOAD_GENERATOR_VERSION;
    digest: string;
    seedSha256: string;
  };
  assets: GeneratedUploadAssetRecord[];
}

export interface PrepareGeneratedUploadAssetsInput {
  workspaceRoot: string;
  requestId: string;
  dryRun?: boolean;
}

export interface PreparedGeneratedUploadAssets {
  root: string;
  manifestPath: string;
  manifest: GeneratedUploadAssetManifest;
  written: boolean;
}

const seedRelativePath = "test-assets/documents/open-platform/synthetic-business-license.png.b64";
const generatedDirectoryName = "generated-test-assets";
const manifestFilename = "manifest.json";

/**
 * Materializes browser-selectable, synthetic upload files only under one local
 * request archive. The files are intentionally not stable suite assets: the
 * generator and its digest are the reusable evidence, while >10 MB boundary
 * files are regenerated for each request and deleted with that request.
 */
export function prepareOpenPlatformRegistrationUploadAssets(
  input: PrepareGeneratedUploadAssetsInput
): PreparedGeneratedUploadAssets {
  const requestId = assertRequestId(input.requestId);
  const workspaceRoot = resolve(input.workspaceRoot);
  const root = resolve(localRunRootPath(workspaceRoot, requestId), generatedDirectoryName);
  const runRoot = localRunRootPath(workspaceRoot, requestId);
  if (!isWithin(runRoot, root)) throw new Error("generated upload assets must remain inside the current local run archive.");

  const seedPath = resolve(workspaceRoot, seedRelativePath);
  const validPng = decodePngSeed(seedPath);
  const seedSha256 = sha256(validPng);
  const generatorDigest = currentGeneratorDigest(seedSha256);
  const files = generatedFiles(validPng);
  const manifest: GeneratedUploadAssetManifest = {
    schemaVersion: GENERATED_UPLOAD_ASSET_MANIFEST_SCHEMA_VERSION,
    requestId,
    generator: {
      id: OPEN_PLATFORM_REGISTRATION_UPLOAD_GENERATOR_ID,
      version: OPEN_PLATFORM_REGISTRATION_UPLOAD_GENERATOR_VERSION,
      digest: generatorDigest,
      seedSha256
    },
    assets: files.map((file) => ({
      assetId: file.assetId,
      path: relative(workspaceRoot, resolve(root, file.filename)).split(sep).join("/"),
      sha256: sha256(file.content),
      byteLength: file.content.byteLength,
      mediaType: file.mediaType,
      boundary: file.boundary
    }))
  };
  const manifestPath = resolve(root, manifestFilename);
  if (input.dryRun) return { root, manifestPath, manifest, written: false };

  const temporaryRoot = `${root}.tmp-${process.pid}`;
  rmSync(temporaryRoot, { recursive: true, force: true });
  mkdirSync(temporaryRoot, { recursive: true });
  for (const file of files) writeFileSync(resolve(temporaryRoot, file.filename), file.content);
  writeFileSync(resolve(temporaryRoot, manifestFilename), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  rmSync(root, { recursive: true, force: true });
  renameSync(temporaryRoot, root);
  return { root, manifestPath, manifest, written: true };
}

export function readGeneratedUploadAssetManifest(input: {
  workspaceRoot: string;
  requestId: string;
  manifestPath?: string;
}): GeneratedUploadAssetManifest {
  const workspaceRoot = resolve(input.workspaceRoot);
  const requestId = assertRequestId(input.requestId);
  const runRoot = localRunRootPath(workspaceRoot, requestId);
  const manifestPath = input.manifestPath
    ? resolve(workspaceRoot, input.manifestPath)
    : resolve(runRoot, generatedDirectoryName, manifestFilename);
  if (!isWithin(resolve(runRoot, generatedDirectoryName), manifestPath) || basename(manifestPath) !== manifestFilename) {
    throw new Error("generated_asset_path_escape: generated upload manifest must be inside this request's generated-test-assets directory.");
  }
  if (!existsSync(manifestPath)) throw new Error("generated_asset_missing: generated upload asset manifest does not exist.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    throw new Error("generated_asset_invalid: generated upload asset manifest is not JSON.");
  }
  const manifest = parseGeneratedUploadAssetManifest(parsed);
  if (manifest.requestId !== requestId) throw new Error("generated_asset_scope_mismatch: generated upload manifest belongs to another request.");
  const expectedSeedSha256 = sha256(decodePngSeed(resolve(workspaceRoot, seedRelativePath)));
  if (manifest.generator.seedSha256 !== expectedSeedSha256
    || manifest.generator.digest !== currentGeneratorDigest(expectedSeedSha256)) {
    throw new Error("generated_asset_generator_drift: generated upload manifest was not produced by the current deterministic generator.");
  }
  for (const asset of manifest.assets) {
    const assetPath = resolve(workspaceRoot, asset.path);
    if (!isWithin(resolve(runRoot, generatedDirectoryName), assetPath)) {
      throw new Error(`generated_asset_path_escape: ${asset.assetId} is outside this request's generated-test-assets directory.`);
    }
    if (!existsSync(assetPath) || sha256(readFileSync(assetPath)) !== asset.sha256) {
      throw new Error(`generated_asset_drift: ${asset.assetId} differs from the frozen generated manifest.`);
    }
  }
  return manifest;
}

export function findGeneratedUploadAsset(
  manifest: GeneratedUploadAssetManifest,
  assetId: string
): GeneratedUploadAssetRecord | undefined {
  return manifest.assets.find((asset) => asset.assetId === assetId);
}

function generatedFiles(validPng: Buffer): Array<{
  assetId: OpenPlatformRegistrationUploadAssetId;
  filename: string;
  content: Buffer;
  mediaType: GeneratedUploadAssetRecord["mediaType"];
  boundary: GeneratedUploadAssetRecord["boundary"];
}> {
  const validJpeg = Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/Aaf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/Aaf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Aqf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IR//2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z",
    "base64"
  );
  return [
    { assetId: "license-valid-png", filename: "license-valid.png", content: validPng, mediaType: "image/png", boundary: "valid" },
    { assetId: "license-valid-jpeg", filename: "license-valid.jpeg", content: validJpeg, mediaType: "image/jpeg", boundary: "valid" },
    { assetId: "license-valid-jpg", filename: "license-valid.jpg", content: validJpeg, mediaType: "image/jpeg", boundary: "valid" },
    { assetId: "license-invalid-text", filename: "license-invalid.txt", content: Buffer.from("synthetic invalid license payload\n", "utf8"), mediaType: "text/plain", boundary: "invalid_type" },
    { assetId: "license-exact-limit-png", filename: "license-exact-limit.png", content: padToSize(validPng, UPLOAD_LIMIT_BYTES), mediaType: "image/png", boundary: "exact_limit" },
    { assetId: "license-over-limit-png", filename: "license-over-limit.png", content: padToSize(validPng, UPLOAD_LIMIT_BYTES + 1), mediaType: "image/png", boundary: "over_limit" }
  ];
}

function padToSize(seed: Buffer, targetBytes: number): Buffer {
  if (seed.byteLength > targetBytes) throw new Error("upload asset seed exceeds the target boundary size.");
  return Buffer.concat([seed, Buffer.alloc(targetBytes - seed.byteLength)]);
}

function decodePngSeed(path: string): Buffer {
  if (!existsSync(path)) throw new Error(`missing generated upload asset seed: ${seedRelativePath}`);
  const decoded = Buffer.from(readFileSync(path, "utf8").trim(), "base64");
  if (decoded.byteLength < 8 || !decoded.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    throw new Error("generated upload asset seed is not a valid PNG signature.");
  }
  return decoded;
}

function currentGeneratorDigest(seedSha256: string): string {
  return sha256Canonical({
    id: OPEN_PLATFORM_REGISTRATION_UPLOAD_GENERATOR_ID,
    version: OPEN_PLATFORM_REGISTRATION_UPLOAD_GENERATOR_VERSION,
    seedRelativePath,
    seedSha256,
    assets: [...OPEN_PLATFORM_REGISTRATION_UPLOAD_ASSET_IDS],
    uploadLimitBytes: UPLOAD_LIMIT_BYTES
  });
}

function parseGeneratedUploadAssetManifest(value: unknown): GeneratedUploadAssetManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("generated_asset_invalid: generated upload manifest must be an object.");
  const manifest = value as Partial<GeneratedUploadAssetManifest>;
  if (manifest.schemaVersion !== GENERATED_UPLOAD_ASSET_MANIFEST_SCHEMA_VERSION || !isRequestId(manifest.requestId)
    || !manifest.generator || manifest.generator.id !== OPEN_PLATFORM_REGISTRATION_UPLOAD_GENERATOR_ID
    || manifest.generator.version !== OPEN_PLATFORM_REGISTRATION_UPLOAD_GENERATOR_VERSION
    || !isSha256(manifest.generator.digest) || !isSha256(manifest.generator.seedSha256)
    || !Array.isArray(manifest.assets) || manifest.assets.length !== OPEN_PLATFORM_REGISTRATION_UPLOAD_ASSET_IDS.length) {
    throw new Error("generated_asset_invalid: generated upload manifest does not match the current generator contract.");
  }
  const seen = new Set<string>();
  for (const asset of manifest.assets) {
    if (!asset || typeof asset !== "object" || !OPEN_PLATFORM_REGISTRATION_UPLOAD_ASSET_IDS.includes(asset.assetId as OpenPlatformRegistrationUploadAssetId)
      || seen.has(asset.assetId) || typeof asset.path !== "string" || !asset.path.startsWith(".local/test-runs/")
      || !isSha256(asset.sha256) || !Number.isInteger(asset.byteLength) || asset.byteLength < 1
      || !["image/png", "image/jpeg", "text/plain"].includes(asset.mediaType ?? "")
      || !["valid", "invalid_type", "exact_limit", "over_limit"].includes(asset.boundary ?? "")) {
      throw new Error("generated_asset_invalid: generated upload asset entry is invalid.");
    }
    seen.add(asset.assetId);
  }
  return manifest as GeneratedUploadAssetManifest;
}

function assertRequestId(value: string): string {
  if (!isRequestId(value)) throw new Error("requestId must be <type>/<project>/<request> using lowercase slugs.");
  return value;
}

function isRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/u.test(value);
}

function isWithin(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !path.includes(`${sep}..${sep}`));
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
