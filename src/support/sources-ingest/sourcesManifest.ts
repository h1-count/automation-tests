import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, renameSync, statSync, writeSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { parse, stringify } from "yaml";

export type UnknownRecord = Record<string, unknown>;

export interface SourcesManifestPaths {
  sourcesRoot?: string;
  manifestPath?: string;
}

export interface MaterialRecord {
  id: string;
  type: string;
  path: string;
  sha256?: string;
  sourceVersion: string;
  status: string;
  raw: UnknownRecord;
}

export interface LoadedSourcesManifest {
  raw: UnknownRecord;
  version: number;
  materials: MaterialRecord[];
}

const projectRoot = resolve(import.meta.dirname, "../../..");
export const defaultSourcesRoot = resolve(projectRoot, "sources");
export const defaultInboxRoot = resolve(projectRoot, ".local/upload-inbox");

const READ_CHUNK_BYTES = 1024 * 1024;

export function asRecords(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.filter((item): item is UnknownRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

export function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function sourcesRoot(paths: SourcesManifestPaths = {}): string {
  return resolve(paths.sourcesRoot ?? defaultSourcesRoot);
}

function manifestPath(paths: SourcesManifestPaths = {}): string {
  return resolve(paths.manifestPath ?? resolve(sourcesRoot(paths), "manifest.yaml"));
}

export function resolveManifestPath(paths: SourcesManifestPaths = {}): string {
  return manifestPath(paths);
}

export function loadSourcesManifest(paths: SourcesManifestPaths = {}): LoadedSourcesManifest {
  const path = manifestPath(paths);
  if (!existsSync(path)) {
    throw new Error(`缺少 sources 清单：${path}`);
  }
  const parsed = parse(readFileSync(path, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("sources/manifest.yaml 必须是 YAML 对象。");
  }
  const raw = parsed as UnknownRecord;
  const materials = asRecords(raw.materials).map((entry) => ({
    id: String(entry.id ?? ""),
    type: String(entry.type ?? ""),
    path: String(entry.path ?? ""),
    sha256: typeof entry.sha256 === "string" && entry.sha256 ? entry.sha256 : undefined,
    sourceVersion: String(entry.source_version ?? "unknown"),
    status: String(entry.status ?? ""),
    raw: entry
  }));
  return { raw, version: Number(raw.version ?? 0), materials };
}

export function writeSourcesManifest(raw: UnknownRecord, paths: SourcesManifestPaths = {}): void {
  const path = manifestPath(paths);
  const serialized = `${stringify(raw, { lineWidth: 0 })}`;
  const tempPath = `${path}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  const handle = openSync(tempPath, "w");
  try {
    let written = 0;
    const buffer = Buffer.from(serialized, "utf8");
    while (written < buffer.length) {
      written += writeSync(handle, buffer, written);
    }
  } finally {
    closeSync(handle);
  }
  renameSync(tempPath, path);
}

export function fileSha256(path: string): string {
  const hash = createHash("sha256");
  const handle = openSync(path, "r");
  try {
    const chunk = Buffer.alloc(READ_CHUNK_BYTES);
    for (;;) {
      const bytes = readSync(handle, chunk, 0, chunk.length, null);
      if (bytes === 0) break;
      hash.update(chunk.subarray(0, bytes));
    }
  } finally {
    closeSync(handle);
  }
  return hash.digest("hex");
}

function directoryFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = resolve(directory, entry.name);
      return entry.isDirectory() ? directoryFiles(entryPath) : entry.isFile() ? [entryPath] : [];
    })
    .sort();
}

/**
 * Computes the canonical content hash for a source material: streaming SHA-256 for
 * regular files and the deterministic directory aggregation for prototype packages
 * (relative path \0 content \0 per file, matching check-knowledge-index semantics).
 */
export function computeSourceHash(path: string): string | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  const stats = statSync(path);
  if (!stats.isDirectory()) {
    return fileSha256(path);
  }
  const hash = createHash("sha256");
  const files = directoryFiles(path);
  for (const file of files) {
    hash.update(relative(path, file));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  if (files.length === 0) {
    hash.update("empty-directory\0");
  }
  return hash.digest("hex");
}

export interface BackfillResult {
  updatedMaterialIds: string[];
  alreadyHashedCount: number;
  missingFiles: string[];
}

/**
 * Adds the material-level `sha256` field to every manifest entry that lacks it.
 * Idempotent: entries that already carry a hash are left untouched, and the
 * manifest file is only rewritten when at least one hash was added.
 */
export function backfillManifestSha256(paths: SourcesManifestPaths = {}): BackfillResult {
  const loaded = loadSourcesManifest(paths);
  const root = sourcesRoot(paths);
  const updatedMaterialIds: string[] = [];
  const missingFiles: string[] = [];
  let alreadyHashedCount = 0;
  for (const material of asRecords(loaded.raw.materials)) {
    if (typeof material.sha256 === "string" && material.sha256) {
      alreadyHashedCount += 1;
      continue;
    }
    const materialPath = typeof material.path === "string" ? material.path : "";
    const hash = materialPath ? computeSourceHash(resolve(root, materialPath)) : undefined;
    if (!hash) {
      missingFiles.push(materialPath || String(material.id ?? "<unknown>"));
      continue;
    }
    material.sha256 = hash;
    updatedMaterialIds.push(String(material.id ?? "<unknown>"));
  }
  if (updatedMaterialIds.length > 0) {
    writeSourcesManifest(loaded.raw, paths);
  }
  return { updatedMaterialIds, alreadyHashedCount, missingFiles };
}

export interface NewMaterialEntry {
  id: string;
  type: string;
  path: string;
  sha256: string;
  sourceVersion: string;
  applicableProjects: string[];
  referenceScopes: string[];
  notes: string;
}

const MATERIAL_FIELD_ORDER: string[] = ["id", "type", "path", "sha256", "source", "source_version", "applicable_projects", "reference_scopes", "status", "version_history", "notes"];

/** Inserts a new material entry preserving the field order used across the manifest. */
export function appendMaterialEntry(raw: UnknownRecord, entry: NewMaterialEntry): UnknownRecord {
  const ordered: UnknownRecord = {};
  const fields: UnknownRecord = {
    id: entry.id,
    type: entry.type,
    path: entry.path,
    sha256: entry.sha256,
    source: "user-provided",
    source_version: entry.sourceVersion,
    applicable_projects: entry.applicableProjects,
    reference_scopes: entry.referenceScopes,
    status: "active",
    notes: entry.notes
  };
  for (const key of MATERIAL_FIELD_ORDER) {
    if (key in fields) {
      ordered[key] = fields[key];
    }
  }
  if (!Array.isArray(raw.materials)) {
    raw.materials = [];
  }
  (raw.materials as unknown[]).push(ordered);
  return ordered;
}

export interface SupersededVersion {
  version: string;
  path: string;
  sha256: string;
  superseded_at: string;
  superseded_in_commit?: string;
}

/**
 * Replaces the current version of an existing material: the previous
 * path/version/hash sinks into `version_history` and the main fields point at
 * the new file. Old content itself is never deleted from Git history.
 */
export function supersedeMaterialVersion(
  raw: UnknownRecord,
  materialId: string,
  next: { path: string; sha256: string; sourceVersion: string },
  supersededAt: string
): { material: UnknownRecord; superseded: SupersededVersion } | undefined {
  const material = asRecords(raw.materials).find((entry) => String(entry.id ?? "") === materialId);
  if (!material) {
    return undefined;
  }
  const previous: SupersededVersion = {
    version: String(material.source_version ?? "unknown"),
    path: String(material.path ?? ""),
    sha256: String(material.sha256 ?? ""),
    superseded_at: supersededAt
  };
  material.path = next.path;
  material.sha256 = next.sha256;
  material.source_version = next.sourceVersion;
  if (!Array.isArray(material.version_history)) {
    material.version_history = [];
  }
  (material.version_history as unknown[]).push(previous);
  return { material, superseded: previous };
}

/** Marks every knowledge index that covers the material as stale so it must be re-extracted before reuse. */
export function markCoveringIndexesStale(raw: UnknownRecord, materialId: string): string[] {
  const stale: string[] = [];
  for (const registration of asRecords(raw.knowledge_indexes)) {
    const covered = asStringList(registration.covered_material_ids);
    if (covered.includes(materialId) && registration.status === "reviewed") {
      registration.status = "stale";
      stale.push(String(registration.id ?? "<unknown>"));
    }
  }
  return stale;
}
