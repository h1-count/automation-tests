import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { link, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import { canonicalJson } from "./canonicalJson.js";
import {
  reviewBatchScopeDigest,
  type ReviewBatchScope
} from "./reviewBatchScope.js";
import { RuntimeLeaseStore } from "./runtimeLeaseStore.js";

export const REVIEW_INPUT_SNAPSHOT_SCHEMA_VERSION = "review-input-snapshot-v1" as const;

export interface ReviewInputSnapshotArtifact {
  sourcePath: string;
  snapshotPath: string;
  digest: string;
  sizeBytes: number;
}

export interface ReviewInputSnapshotManifest {
  schemaVersion: typeof REVIEW_INPUT_SNAPSHOT_SCHEMA_VERSION;
  requestId: string;
  batchId: string;
  createdAt: string;
  artifacts: ReviewInputSnapshotArtifact[];
  /** Optional for historical manifest v1 compatibility. */
  scope?: ReviewBatchScope;
  scopeDigest?: string;
  combinedDigest: string;
}

export interface ReviewInputIdentity {
  artifacts: Array<Pick<
    ReviewInputSnapshotArtifact,
    "sourcePath" | "digest" | "sizeBytes"
  >>;
  combinedDigest: string;
}

const batchPattern = /^[A-Za-z0-9._-]+$/;
const digestPattern = /^[a-f0-9]{64}$/;
const hardLinkUnavailableCodes = new Set([
  "EACCES",
  "EMLINK",
  "ENOSYS",
  "ENOTSUP",
  "EOPNOTSUPP",
  "EPERM",
  "EXDEV"
]);

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function reviewInputDigest(
  requestId: string,
  artifacts: Array<Pick<ReviewInputSnapshotArtifact, "sourcePath" | "digest" | "sizeBytes">>,
  scopeDigest?: string
): string {
  return sha256(canonicalJson({
    schemaVersion: REVIEW_INPUT_SNAPSHOT_SCHEMA_VERSION,
    requestId,
    ...(scopeDigest ? { scopeDigest } : {}),
    artifacts: [...artifacts].map(({ sourcePath, digest, sizeBytes }) => ({ sourcePath, digest, sizeBytes }))
      .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath))
  }));
}

function portableRelative(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

async function atomicWrite(path: string, content: Uint8Array): Promise<void> {
  await mkdir(resolve(path, ".."), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    const handle = await open(temporary, "wx");
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
    const directory = await open(resolve(path, ".."), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

async function atomicInstallBlob(
  path: string,
  content: Uint8Array,
  digest: string
): Promise<void> {
  await mkdir(resolve(path, ".."), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    const handle = await open(temporary, "wx");
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporary, path);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
      if (code !== "EEXIST") throw error;
      const existing = await readFile(path);
      if (existing.byteLength === content.byteLength && sha256(existing) === digest) return;
      await rename(temporary, path);
    }
    const directory = await open(resolve(path, ".."), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

export class ReviewInputSnapshotStore {
  readonly workspaceRoot: string;
  readonly requestRoot: string;
  readonly runtimeStore: RuntimeLeaseStore;
  private readonly blobRoot: string;

  constructor(
    readonly requestId: string,
    options: {
      workspaceRoot?: string;
      runtimeRoot?: string;
      runtimeStore?: RuntimeLeaseStore;
    } = {}
  ) {
    this.workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
    this.requestRoot = resolve(this.workspaceRoot, "testcases", ...requestId.split("/"));
    const configuredRuntimeRoot = options.runtimeRoot
      ? resolve(options.runtimeRoot)
      : resolve(this.workspaceRoot, ".local/test-task-runtime");
    this.runtimeStore = options.runtimeStore
      ?? new RuntimeLeaseStore(
        requestId,
        configuredRuntimeRoot
      );
    const runtimeRoot = options.runtimeStore
      ? requestId.split("/").reduce(
        (root) => resolve(root, ".."),
        options.runtimeStore.requestRoot
      )
      : configuredRuntimeRoot;
    this.blobRoot = resolve(runtimeRoot, "review-input-blobs", "sha256");
  }

  async freeze(
    batchId: string,
    inputPaths: string[],
    scope?: ReviewBatchScope
  ): Promise<ReviewInputSnapshotManifest> {
    this.validateBatchId(batchId);
    if (!inputPaths.length) throw new Error("A review input snapshot requires at least one input path.");
    const requested = [...new Set(inputPaths.map((path) => this.normalizeInputPath(path)))].sort();
    const artifacts = await Promise.all(requested.map(async (sourcePath, index) => {
      const absolute = resolve(this.workspaceRoot, sourcePath);
      const content = await readFile(absolute);
      return {
        sourcePath,
        snapshotPath: resolve(
          this.batchRoot(batchId),
          `${String(index + 1).padStart(4, "0")}-${basename(sourcePath)}`
        ),
        digest: sha256(content),
        sizeBytes: content.byteLength,
        content
      };
    }));
    const identity = artifacts.map(({ sourcePath, digest, sizeBytes }) => ({
      sourcePath,
      digest,
      sizeBytes
    }));
    const scopeDigest = scope ? reviewBatchScopeDigest(scope) : undefined;
    const combinedDigest = reviewInputDigest(this.requestId, identity, scopeDigest);
    const existing = await this.readIfExists(batchId);
    if (existing) {
      if (existing.combinedDigest !== combinedDigest) {
        throw new Error(
          `Review input snapshot ${batchId} already exists with another input digest.`
        );
      }
      await this.verify(batchId);
      return existing;
    }

    await mkdir(this.batchRoot(batchId), { recursive: true });
    try {
      for (const artifact of artifacts) {
        const blobPath = await this.ensureBlob(artifact.digest, artifact.content);
        await this.materializeSnapshot(blobPath, artifact.snapshotPath, artifact.content);
      }
      const manifest: ReviewInputSnapshotManifest = {
        schemaVersion: REVIEW_INPUT_SNAPSHOT_SCHEMA_VERSION,
        requestId: this.requestId,
        batchId,
        createdAt: new Date().toISOString(),
        artifacts: artifacts.map(({ content: _content, ...artifact }) => artifact),
        ...(scope ? { scope, scopeDigest } : {}),
        combinedDigest
      };
      await atomicWrite(
        this.manifestPath(batchId),
        Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8")
      );
      return manifest;
    } catch (error) {
      await rm(this.batchRoot(batchId), { recursive: true, force: true });
      throw error;
    }
  }

  /** Reads the current formal inputs without creating or replacing a runtime
   * snapshot. This identity is safe to use for deterministic batch rotation. */
  async inspectCurrent(
    inputPaths: string[],
    scope?: ReviewBatchScope
  ): Promise<ReviewInputIdentity> {
    if (!inputPaths.length) throw new Error("A review input identity requires at least one input path.");
    const requested = [...new Set(inputPaths.map((path) => this.normalizeInputPath(path)))].sort();
    const artifacts = await Promise.all(requested.map(async (sourcePath) => {
      const content = await readFile(resolve(this.workspaceRoot, sourcePath));
      return {
        sourcePath,
        digest: sha256(content),
        sizeBytes: content.byteLength
      };
    }));
    return {
      artifacts,
      combinedDigest: reviewInputDigest(
        this.requestId,
        artifacts,
        scope ? reviewBatchScopeDigest(scope) : undefined
      )
    };
  }

  async read(batchId: string): Promise<ReviewInputSnapshotManifest> {
    this.validateBatchId(batchId);
    const manifest = await this.readIfExists(batchId);
    if (!manifest) throw new Error(`Review input snapshot ${batchId} does not exist.`);
    return manifest;
  }

  async verify(batchId: string): Promise<ReviewInputSnapshotManifest> {
    const manifest = await this.read(batchId);
    const identity: Array<{ sourcePath: string; digest: string; sizeBytes: number }> = [];
    for (const artifact of manifest.artifacts) {
      this.normalizeInputPath(artifact.sourcePath);
      const expectedRoot = this.batchRoot(batchId);
      const snapshotPath = resolve(artifact.snapshotPath);
      const snapshotRelative = portableRelative(expectedRoot, snapshotPath);
      if (!snapshotRelative || snapshotRelative === ".." || snapshotRelative.startsWith("../")) {
        throw new Error(`Review snapshot path escapes its batch directory: ${artifact.snapshotPath}`);
      }
      const content = await readFile(snapshotPath);
      if (
        !digestPattern.test(artifact.digest)
        || sha256(content) !== artifact.digest
        || content.byteLength !== artifact.sizeBytes
      ) {
        throw new Error(`Review input snapshot ${batchId} is corrupt: ${artifact.sourcePath}`);
      }
      identity.push({
        sourcePath: artifact.sourcePath,
        digest: artifact.digest,
        sizeBytes: artifact.sizeBytes
      });
    }
    const scopeDigest = manifest.scope
      ? reviewBatchScopeDigest(manifest.scope)
      : undefined;
    if (
      scopeDigest !== manifest.scopeDigest
      || (manifest.scopeDigest !== undefined && !digestPattern.test(manifest.scopeDigest))
    ) {
      throw new Error(`Review input snapshot ${batchId} has an invalid scope digest.`);
    }
    const combinedDigest = reviewInputDigest(this.requestId, identity, scopeDigest);
    if (combinedDigest !== manifest.combinedDigest) {
      throw new Error(`Review input snapshot ${batchId} has an invalid combined digest.`);
    }
    return manifest;
  }

  /** A frozen copy proves what was reviewed; this check proves the formal
   * inputs have not changed before a dispatch or submission can advance. */
  async verifyCurrentSources(batchId: string): Promise<ReviewInputSnapshotManifest> {
    const manifest = await this.verify(batchId);
    for (const artifact of manifest.artifacts) {
      const content = await readFile(resolve(this.workspaceRoot, artifact.sourcePath));
      if (sha256(content) !== artifact.digest || content.byteLength !== artifact.sizeBytes) {
        throw new Error(`Review batch ${batchId} input drifted: ${artifact.sourcePath}`);
      }
    }
    return manifest;
  }

  /** Rebuild disposable files; the manager compares this result to history. */
  async repair(
    batchId: string,
    inputPaths: string[],
    scope?: ReviewBatchScope
  ): Promise<ReviewInputSnapshotManifest> {
    this.validateBatchId(batchId);
    await rm(this.batchRoot(batchId), { recursive: true, force: true });
    return this.freeze(batchId, inputPaths, scope);
  }

  private batchRoot(batchId: string): string {
    this.validateBatchId(batchId);
    return resolve(this.runtimeStore.requestRoot, "review-inputs", batchId);
  }

  private manifestPath(batchId: string): string {
    return resolve(this.batchRoot(batchId), "manifest.json");
  }

  private blobPath(digest: string): string {
    return resolve(this.blobRoot, digest.slice(0, 2), digest);
  }

  private async ensureBlob(digest: string, content: Uint8Array): Promise<string> {
    const path = this.blobPath(digest);
    if (existsSync(path)) {
      const existing = await readFile(path);
      if (existing.byteLength === content.byteLength && sha256(existing) === digest) return path;
    }
    await atomicInstallBlob(path, content, digest);
    return path;
  }

  private async materializeSnapshot(
    blobPath: string,
    snapshotPath: string,
    content: Uint8Array
  ): Promise<void> {
    await mkdir(resolve(snapshotPath, ".."), { recursive: true });
    const temporary = `${snapshotPath}.tmp-${process.pid}-${randomUUID()}`;
    try {
      await link(blobPath, temporary);
      await rename(temporary, snapshotPath);
      const directory = await open(resolve(snapshotPath, ".."), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } catch (error) {
      await rm(temporary, { force: true });
      if (!this.hardLinkUnavailable(error)) throw error;
      await atomicWrite(snapshotPath, content);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private hardLinkUnavailable(error: unknown): boolean {
    const code = error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
    return hardLinkUnavailableCodes.has(code);
  }

  private validateBatchId(batchId: string): void {
    if (!batchPattern.test(batchId)) {
      throw new Error("batchId must contain only letters, numbers, dot, underscore, or dash.");
    }
  }

  private normalizeInputPath(path: string): string {
    const absolute = resolve(this.workspaceRoot, path);
    const requestRelative = portableRelative(this.requestRoot, absolute);
    if (
      requestRelative
      && requestRelative !== ".."
      && !requestRelative.startsWith("../")
      && /^(?:plan\.md|cases-[a-z0-9][a-z0-9-]*\.md)$/.test(requestRelative)
    ) {
      return portableRelative(this.workspaceRoot, absolute);
    }
    const workspaceRelative = portableRelative(this.workspaceRoot, absolute);
    const hasHiddenSegment = workspaceRelative
      .split("/")
      .some((segment) => segment.startsWith("."));
    if (
      !hasHiddenSegment
      && (
        workspaceRelative === "sources/manifest.yaml"
        || /^sources\/indexes\/[a-z0-9][a-z0-9-]*\.ya?ml$/.test(workspaceRelative)
        || /^sources\/(?:requirements|prototypes|knowledge-base)\/[^/]+\/.+/.test(workspaceRelative)
      )
    ) {
      return workspaceRelative;
    }
    throw new Error(
      `Reviewer input must be the request plan/case package or an explicitly selected controlled source: ${path}`
    );
  }

  private async readIfExists(batchId: string): Promise<ReviewInputSnapshotManifest | undefined> {
    const path = this.manifestPath(batchId);
    if (!existsSync(path)) return undefined;
    const parsed = JSON.parse(await readFile(path, "utf8")) as ReviewInputSnapshotManifest;
    if (
      parsed.schemaVersion !== REVIEW_INPUT_SNAPSHOT_SCHEMA_VERSION
      || parsed.requestId !== this.requestId
      || parsed.batchId !== batchId
      || !Array.isArray(parsed.artifacts)
      || !parsed.artifacts.length
      || (parsed.scope === undefined) !== (parsed.scopeDigest === undefined)
      || !digestPattern.test(parsed.combinedDigest)
    ) {
      throw new Error(`Review input snapshot manifest ${batchId} is invalid.`);
    }
    return parsed;
  }
}
