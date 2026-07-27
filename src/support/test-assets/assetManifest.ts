import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { parse } from "yaml";

export const TEST_ASSET_KINDS = ["app-package", "firmware-package", "visual-baseline", "test-document"] as const;
export const TEST_ASSET_STATUSES = ["active", "inventory-only", "retired"] as const;

export type TestAssetKind = (typeof TEST_ASSET_KINDS)[number];
export type TestAssetStatus = (typeof TEST_ASSET_STATUSES)[number];

export interface TestAssetRecord {
  assetId: string;
  kind: TestAssetKind;
  path: string;
  sha256: string;
  status: TestAssetStatus;
  projects?: string[];
  platform?: string;
  version?: string;
  scopes?: string[];
  defaultSelection?: boolean;
  description: string;
}

export interface TestAssetManifest {
  version: 1;
  assets: TestAssetRecord[];
}

export interface TestAssetPaths {
  assetRoot?: string;
  manifestPath?: string;
}

export interface TestAssetSelectionRequest {
  project: string;
  kind: TestAssetKind;
  platform?: string;
  scope?: string;
}

export interface TestAssetSelection {
  status: "selected" | "not-found" | "ambiguous";
  asset?: TestAssetRecord;
  candidates: TestAssetRecord[];
}

const projectRoot = resolve(import.meta.dirname, "../../..");
export const defaultTestAssetRoot = resolve(projectRoot, "test-assets");
export const defaultTestAssetManifestPath = resolve(defaultTestAssetRoot, "manifest.yaml");

function assetRoot(paths: TestAssetPaths = {}): string {
  return resolve(paths.assetRoot ?? defaultTestAssetRoot);
}

function manifestPath(paths: TestAssetPaths = {}): string {
  return resolve(paths.manifestPath ?? resolve(assetRoot(paths), "manifest.yaml"));
}

function asStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    return undefined;
  }
  return value;
}

function parseAsset(value: unknown): TestAssetRecord {
  if (!value || typeof value !== "object") {
    throw new Error("test-assets/manifest.yaml 的资产条目必须为对象。");
  }
  const asset = value as Record<string, unknown>;
  return {
    assetId: String(asset.assetId ?? ""),
    kind: asset.kind as TestAssetKind,
    path: String(asset.path ?? ""),
    sha256: String(asset.sha256 ?? ""),
    status: asset.status as TestAssetStatus,
    projects: asStringList(asset.projects),
    platform: typeof asset.platform === "string" ? asset.platform : undefined,
    version: typeof asset.version === "string" ? asset.version : undefined,
    scopes: asStringList(asset.scopes),
    defaultSelection: asset.defaultSelection === true,
    description: String(asset.description ?? "")
  };
}

export function loadTestAssetManifest(paths: TestAssetPaths = {}): TestAssetManifest {
  const path = manifestPath(paths);
  if (!existsSync(path)) {
    throw new Error("缺少 test-assets/manifest.yaml。");
  }
  const parsed = parse(readFileSync(path, "utf8"));
  if (!parsed || typeof parsed !== "object") {
    throw new Error("test-assets/manifest.yaml 必须是 YAML 对象。");
  }
  const raw = parsed as Record<string, unknown>;
  if (raw.version !== 1 || !Array.isArray(raw.assets)) {
    throw new Error("test-assets/manifest.yaml 必须使用 version: 1 并包含 assets 数组。");
  }
  return { version: 1, assets: raw.assets.map(parseAsset) };
}

export function resolveAssetPath(asset: Pick<TestAssetRecord, "path">, paths: TestAssetPaths = {}): string | undefined {
  if (!asset.path || isAbsolute(asset.path)) {
    return undefined;
  }
  const root = assetRoot(paths);
  const target = resolve(root, asset.path);
  const relativePath = relative(root, target);
  return relativePath && !relativePath.startsWith("..") && !isAbsolute(relativePath) ? target : undefined;
}

export function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function listTestAssetFiles(paths: TestAssetPaths = {}): string[] {
  const root = assetRoot(paths);
  if (!existsSync(root)) {
    return [];
  }
  const ignored = new Set([".DS_Store", "README.md", "manifest.yaml", "Thumbs.db"]);
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (ignored.has(entry.name) || entry.name.startsWith(".")) {
        continue;
      }
      const entryPath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (entry.isFile()) {
        files.push(relative(root, entryPath));
      }
    }
  };
  walk(root);
  return files.sort();
}

export function validateTestAssetManifest(manifest: TestAssetManifest, paths: TestAssetPaths = {}): string[] {
  const errors: string[] = [];
  const assetIds = new Set<string>();
  const registeredPaths = new Set<string>();
  const defaults = new Set<string>();

  for (const asset of manifest.assets) {
    if (!/^[a-z][a-z0-9-]*$/.test(asset.assetId)) {
      errors.push(`资产 assetId 非法：${asset.assetId || "<空>"}。`);
    } else if (assetIds.has(asset.assetId)) {
      errors.push(`资产 assetId 重复：${asset.assetId}。`);
    } else {
      assetIds.add(asset.assetId);
    }
    if (!TEST_ASSET_KINDS.includes(asset.kind)) {
      errors.push(`资产 ${asset.assetId} 的 kind 非法。`);
    }
    if (!TEST_ASSET_STATUSES.includes(asset.status)) {
      errors.push(`资产 ${asset.assetId} 的 status 非法。`);
    }
    if (!asset.description.trim()) {
      errors.push(`资产 ${asset.assetId} 缺少 description。`);
    }
    if (!/^[a-f0-9]{64}$/.test(asset.sha256)) {
      errors.push(`资产 ${asset.assetId} 的 sha256 非法。`);
    }
    const absolutePath = resolveAssetPath(asset, paths);
    if (!absolutePath) {
      errors.push(`资产 ${asset.assetId} 的 path 必须位于 test-assets/ 内。`);
      continue;
    }
    if (registeredPaths.has(asset.path)) {
      errors.push(`资产 path 重复：${asset.path}。`);
    } else {
      registeredPaths.add(asset.path);
    }
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      errors.push(`资产 ${asset.assetId} 的文件不存在：${asset.path}。`);
    } else if (/^[a-f0-9]{64}$/.test(asset.sha256) && sha256(absolutePath) !== asset.sha256) {
      errors.push(`资产 ${asset.assetId} 的 SHA-256 与文件不一致。`);
    }
    if (asset.status === "active" && (!asset.projects?.length || !asset.platform || !asset.version)) {
      errors.push(`active 资产 ${asset.assetId} 必须填写 projects、platform 和 version。`);
    }
    if (asset.defaultSelection) {
      if (asset.status !== "active" || !asset.projects?.length || !asset.platform) {
        errors.push(`默认资产 ${asset.assetId} 必须是包含项目和平台的 active 资产。`);
      }
      for (const project of asset.projects ?? []) {
        const key = `${project}/${asset.kind}/${asset.platform ?? ""}`;
        if (defaults.has(key)) {
          errors.push(`同一项目、类型和平台只能有一个默认资产：${key}。`);
        }
        defaults.add(key);
      }
    }
  }

  const undisclosed = listTestAssetFiles(paths).filter((path) => !registeredPaths.has(path));
  if (undisclosed.length > 0) {
    errors.push(`以下静态资产未登记：${undisclosed.join("、")}。`);
  }
  return errors;
}

export function findTestAsset(manifest: TestAssetManifest, assetId: string): TestAssetRecord | undefined {
  return manifest.assets.find((asset) => asset.assetId === assetId);
}

export function selectTestAsset(manifest: TestAssetManifest, request: TestAssetSelectionRequest): TestAssetSelection {
  const candidates = manifest.assets.filter((asset) =>
    asset.status === "active" &&
    asset.kind === request.kind &&
    asset.projects?.includes(request.project) &&
    (!request.platform || asset.platform === request.platform) &&
    (!request.scope || asset.scopes?.includes(request.scope))
  );
  if (candidates.length === 0) {
    return { status: "not-found", candidates };
  }
  if (candidates.length === 1) {
    return { status: "selected", asset: candidates[0], candidates };
  }
  const defaults = candidates.filter((asset) => asset.defaultSelection);
  return defaults.length === 1
    ? { status: "selected", asset: defaults[0], candidates }
    : { status: "ambiguous", candidates };
}
