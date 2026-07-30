import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
  RuntimeLeaseStore,
  type RuntimeLeaseHandle
} from "./runtimeLeaseStore.js";
import { processLockCanBeRecovered, type ProcessLockRecord } from "./processLock.js";

export const ARTIFACT_MANIFEST_SCHEMA_VERSION = "artifact-publish-manifest-v1" as const;

export type ArtifactContent = string | Uint8Array;

export interface ArtifactPublishSource {
  targetPath: string;
  content: ArtifactContent;
}

export interface StagedArtifact {
  targetPath: string;
  stagedPath: string;
  digest: string;
  expectedPreviousDigest: string | null;
  sizeBytes: number;
}

export interface ArtifactPublishManifest {
  schemaVersion: typeof ARTIFACT_MANIFEST_SCHEMA_VERSION;
  requestId: string;
  publishId: string;
  activityId: string;
  createdAt: string;
  leaseId: string;
  fencingToken: number;
  artifacts: StagedArtifact[];
  manifestDigest: string;
}

export interface ArtifactPublishPreparedEvent {
  type: "ArtifactPublishPrepared";
  idempotencyKey: string;
  payload: {
    publishId: string;
    activityId: string;
    manifestDigest: string;
    artifacts: Array<{
      targetPath: string;
      digest: string;
      expectedPreviousDigest: string | null;
      sizeBytes: number;
    }>;
  };
}

export interface PreparedArtifactPublication {
  publishId: string;
  manifestPath: string;
  manifestDigest: string;
  event: ArtifactPublishPreparedEvent;
}

export type ArtifactRecoveryState =
  | "READY_TO_PUBLISH"
  | "PUBLISHED"
  | "RECONCILING";

export interface ArtifactRecoveryResult {
  state: ArtifactRecoveryState;
  publishId: string;
  manifestDigest: string;
  matchedTargets: string[];
  pendingTargets: string[];
  missingTargets: string[];
  conflictingTargets: string[];
  invalidStagingPaths: string[];
  reason: string;
}

export interface ArtifactPublishResult {
  state: "PUBLISHED";
  publishId: string;
  manifestDigest: string;
  artifacts: Array<{ targetPath: string; digest: string; sizeBytes: number }>;
  recovered: boolean;
}

export type ArtifactValidator = (artifact: {
  targetPath: string;
  content: Uint8Array;
}) => void | string[] | Promise<void | string[]>;

export interface ArtifactPublishInput {
  publishId: string;
  activityId: string;
  lease: RuntimeLeaseHandle;
  artifacts: ArtifactPublishSource[];
  validators?: ArtifactValidator[];
}

export class ArtifactValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Artifact validation failed: ${issues.join("; ")}`);
  }
}

export class ArtifactReconciliationRequiredError extends Error {
  constructor(readonly recovery: ArtifactRecoveryResult) {
    super(`Artifact publication ${recovery.publishId} requires reconciliation: ${recovery.reason}`);
  }
}

/**
 * Publishes validated files from the request's disposable runtime directory.
 * The caller-provided recordPrepared callback is the history boundary: no
 * target is renamed before that callback resolves.
 */
export class ArtifactPublisher {
  readonly workspaceRoot: string;
  readonly runtimeStore: RuntimeLeaseStore;
  readonly publicationLockPath: string;

  constructor(
    readonly requestId: string,
    options: {
      workspaceRoot?: string;
      runtimeRoot?: string;
      runtimeStore?: RuntimeLeaseStore;
    } = {}
  ) {
    this.workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
    this.runtimeStore = options.runtimeStore
      ?? new RuntimeLeaseStore(
        requestId,
        options.runtimeRoot ?? resolve(this.workspaceRoot, ".local/test-task-runtime")
      );
    this.publicationLockPath = resolve(
      this.workspaceRoot,
      ".local/workflow-publication-locks",
      `${sha256(requestId)}.lock`
    );
  }

  async prepare(input: ArtifactPublishInput): Promise<PreparedArtifactPublication> {
    validatePublishKey(input.publishId, "publishId");
    validatePublishKey(input.activityId, "activityId");
    if (input.lease.activityId !== input.activityId) {
      throw new Error("Artifact activityId must match the runtime lease.");
    }
    if (input.artifacts.length === 0) {
      throw new ArtifactValidationError(["At least one artifact is required."]);
    }
    await this.runtimeStore.assertCanCommit(input.lease);

    const publicationRoot = this.publicationRoot(input.publishId);
    const filesRoot = resolve(publicationRoot, "files");
    await mkdir(filesRoot, { recursive: true });

    const issues: string[] = [];
    const seenTargets = new Set<string>();
    const staged: StagedArtifact[] = [];
    try {
      const requestedArtifacts = input.artifacts.map((artifact) => {
        const targetPath = normalizeTargetPath(this.workspaceRoot, artifact.targetPath);
        const content = Buffer.from(artifact.content);
        return {
          targetPath,
          content,
          digest: sha256(content),
          sizeBytes: content.byteLength
        };
      });
      if (existsSync(this.manifestPath(input.publishId))) {
        const existing = await this.readManifest(input.publishId);
        const requestedIdentity = requestedArtifacts.map(
          ({ targetPath, digest, sizeBytes }) => ({ targetPath, digest, sizeBytes })
        );
        const existingIdentity = existing.artifacts.map(
          ({ targetPath, digest, sizeBytes }) => ({ targetPath, digest, sizeBytes })
        );
        if (
          existing.activityId !== input.activityId
          || existing.leaseId !== input.lease.leaseId
          || existing.fencingToken !== input.lease.fencingToken
          || canonicalJson(existingIdentity) !== canonicalJson(requestedIdentity)
        ) {
          throw new ArtifactReconciliationRequiredError(
            await this.recover(input.publishId)
          );
        }
        await this.runtimeStore.addStagingRef(
          {
            publishId: input.publishId,
            activityId: input.activityId,
            manifestPath: this.manifestPath(input.publishId),
            manifestDigest: existing.manifestDigest
          },
          input.lease
        );
        return toPrepared(existing, this.manifestPath(input.publishId));
      }
      for (const [index, artifact] of requestedArtifacts.entries()) {
        const { targetPath, content } = artifact;
        if (seenTargets.has(targetPath)) {
          issues.push(`Duplicate target path: ${targetPath}`);
          continue;
        }
        seenTargets.add(targetPath);
        if (content.byteLength === 0) issues.push(`${targetPath}: content is empty.`);
        for (const validator of input.validators ?? []) {
          const validationIssues = await validator({ targetPath, content });
          if (Array.isArray(validationIssues)) {
            issues.push(...validationIssues.map((issue) => `${targetPath}: ${issue}`));
          }
        }
        const stagedPath = resolve(filesRoot, `${String(index + 1).padStart(4, "0")}.stage`);
        await writeFileDurably(stagedPath, content);
        staged.push({
          targetPath,
          stagedPath,
          digest: sha256(content),
          expectedPreviousDigest: await digestIfExists(
            resolve(this.workspaceRoot, targetPath)
          ),
          sizeBytes: content.byteLength
        });
      }
      if (issues.length > 0) throw new ArtifactValidationError(issues);

      await assertSameFilesystem(filesRoot, staged, this.workspaceRoot);
      const manifestWithoutDigest = {
        schemaVersion: ARTIFACT_MANIFEST_SCHEMA_VERSION,
        requestId: this.requestId,
        publishId: input.publishId,
        activityId: input.activityId,
        createdAt: new Date().toISOString(),
        leaseId: input.lease.leaseId,
        fencingToken: input.lease.fencingToken,
        artifacts: staged
      };
      const manifest: ArtifactPublishManifest = {
        ...manifestWithoutDigest,
        manifestDigest: sha256(canonicalJson(manifestWithoutDigest))
      };
      const manifestPath = this.manifestPath(input.publishId);
      await atomicWriteJson(manifestPath, manifest);
      await this.runtimeStore.addStagingRef(
        {
          publishId: input.publishId,
          activityId: input.activityId,
          manifestPath,
          manifestDigest: manifest.manifestDigest
        },
        input.lease
      );
      return toPrepared(manifest, manifestPath);
    } catch (error) {
      if (error instanceof ArtifactValidationError) {
        await rm(publicationRoot, { recursive: true, force: true });
      }
      throw error;
    }
  }

  async publish(
    input: ArtifactPublishInput,
    recordPrepared: (event: ArtifactPublishPreparedEvent) => void | Promise<void>
  ): Promise<ArtifactPublishResult> {
    const prepared = await this.prepare(input);
    return this.withPublicationLock(async () => {
      await recordPrepared(prepared.event);
      return this.commitUnlocked(prepared, input.lease);
    });
  }

  async commit(
    prepared: PreparedArtifactPublication,
    lease: RuntimeLeaseHandle
  ): Promise<ArtifactPublishResult> {
    return this.withPublicationLock(() => this.commitUnlocked(prepared, lease));
  }

  /**
   * Completes only the still-pending targets of a durably prepared publication.
   * This is used after a worker died between target renames; it never replaces
   * a target whose digest differs from both the prepared and previous values.
   */
  async reconcilePrepared(publishId: string): Promise<ArtifactPublishResult> {
    return this.withPublicationLock(async () => {
      const manifest = await this.readManifest(publishId);
      const before = await this.recover(publishId);
      if (before.state === "PUBLISHED") return toPublishResult(manifest, true);
      if (before.conflictingTargets.length || before.invalidStagingPaths.length) {
        throw new ArtifactReconciliationRequiredError(before);
      }
      for (const artifact of manifest.artifacts) {
        const targetPath = resolve(this.workspaceRoot, artifact.targetPath);
        const currentDigest = await digestIfExists(targetPath);
        if (currentDigest === artifact.digest) continue;
        if (currentDigest !== artifact.expectedPreviousDigest) {
          throw new ArtifactReconciliationRequiredError(await this.recover(publishId));
        }
        if (!existsSync(artifact.stagedPath) || await digestFile(artifact.stagedPath) !== artifact.digest) {
          throw new ArtifactReconciliationRequiredError(await this.recover(publishId));
        }
        await rename(artifact.stagedPath, targetPath);
        if (await digestFile(targetPath) !== artifact.digest) {
          throw new ArtifactReconciliationRequiredError(await this.recover(publishId));
        }
      }
      const after = await this.recover(publishId);
      if (after.state !== "PUBLISHED") throw new ArtifactReconciliationRequiredError(after);
      return toPublishResult(manifest, true);
    });
  }

  private async commitUnlocked(
    prepared: PreparedArtifactPublication,
    lease: RuntimeLeaseHandle
  ): Promise<ArtifactPublishResult> {
    const manifest = await this.readManifest(prepared.publishId);
    if (
      manifest.manifestDigest !== prepared.manifestDigest
      || manifest.leaseId !== lease.leaseId
      || manifest.fencingToken !== lease.fencingToken
    ) {
      throw new ArtifactReconciliationRequiredError(await this.recover(prepared.publishId));
    }
    await this.runtimeStore.assertCanCommit(lease);
    const before = await this.recover(prepared.publishId);
    if (before.state === "PUBLISHED") return toPublishResult(manifest, true);
    if (before.state !== "READY_TO_PUBLISH") {
      throw new ArtifactReconciliationRequiredError(before);
    }

    try {
      for (const artifact of manifest.artifacts) {
        await this.runtimeStore.assertCanCommit(lease);
        const targetPath = resolve(this.workspaceRoot, artifact.targetPath);
        const currentDigest = await digestIfExists(targetPath);
        if (currentDigest !== artifact.expectedPreviousDigest) {
          throw new Error(
            `Target changed after publication was prepared: ${artifact.targetPath}`
          );
        }
        await mkdir(dirname(targetPath), { recursive: true });
        await rename(artifact.stagedPath, targetPath);
        if (await digestFile(targetPath) !== artifact.digest) {
          throw new Error(`Readback digest mismatch: ${artifact.targetPath}`);
        }
      }
    } catch {
      const recovery = await this.recover(prepared.publishId);
      if (recovery.state === "PUBLISHED") return toPublishResult(manifest, true);
      throw new ArtifactReconciliationRequiredError(recovery);
    }

    const after = await this.recover(prepared.publishId);
    if (after.state !== "PUBLISHED") {
      throw new ArtifactReconciliationRequiredError(after);
    }
    return toPublishResult(manifest, false);
  }

  async recover(publishId: string): Promise<ArtifactRecoveryResult> {
    const manifest = await this.readManifest(publishId);
    const matchedTargets: string[] = [];
    const pendingTargets: string[] = [];
    const missingTargets: string[] = [];
    const conflictingTargets: string[] = [];
    const invalidStagingPaths: string[] = [];

    for (const artifact of manifest.artifacts) {
      const targetPath = resolve(this.workspaceRoot, artifact.targetPath);
      const currentDigest = await digestIfExists(targetPath);
      if (currentDigest === artifact.digest) {
        matchedTargets.push(artifact.targetPath);
      } else if (currentDigest === artifact.expectedPreviousDigest) {
        pendingTargets.push(artifact.targetPath);
        if (currentDigest === null) missingTargets.push(artifact.targetPath);
      } else if (currentDigest === null) {
        missingTargets.push(artifact.targetPath);
      } else {
        conflictingTargets.push(artifact.targetPath);
      }
      if (
        currentDigest !== artifact.digest
        && (
          !existsSync(artifact.stagedPath)
          || await digestFile(artifact.stagedPath) !== artifact.digest
        )
      ) {
        invalidStagingPaths.push(artifact.targetPath);
      }
    }

    if (matchedTargets.length === manifest.artifacts.length) {
      return {
        state: "PUBLISHED",
        publishId,
        manifestDigest: manifest.manifestDigest,
        matchedTargets,
        pendingTargets,
        missingTargets,
        conflictingTargets,
        invalidStagingPaths,
        reason: "Every final artifact matches the prepared manifest."
      };
    }
    if (
      pendingTargets.length === manifest.artifacts.length
      && conflictingTargets.length === 0
      && invalidStagingPaths.length === 0
    ) {
      return {
        state: "READY_TO_PUBLISH",
        publishId,
        manifestDigest: manifest.manifestDigest,
        matchedTargets,
        pendingTargets,
        missingTargets,
        conflictingTargets,
        invalidStagingPaths,
        reason: "No final artifact exists and all staged digests are valid."
      };
    }
    return {
      state: "RECONCILING",
      publishId,
      manifestDigest: manifest.manifestDigest,
      matchedTargets,
      pendingTargets,
      missingTargets,
      conflictingTargets,
      invalidStagingPaths,
      reason: conflictingTargets.length > 0
        ? "At least one final target conflicts with the prepared digest."
        : "Only part of the prepared artifact set is present."
    };
  }

  /**
   * Call after the durable Activity/Callback outcome, or to abort before the
   * ArtifactPublishPrepared history boundary was recorded. Once that boundary
   * exists, recovery evidence must remain until a durable outcome closes it.
   */
  async cleanup(publishId: string, lease: RuntimeLeaseHandle): Promise<void> {
    await this.runtimeStore.assertCanCommit(lease);
    await this.runtimeStore.removeStagingRef(publishId, lease);
    await rm(this.publicationRoot(publishId), { recursive: true, force: true });
  }

  private async withPublicationLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(dirname(this.publicationLockPath), { recursive: true });
    const owner = `${process.pid}:${randomUUID()}`;
    const deadline = Date.now() + 30_000;
    let handle;
    while (!handle) {
      try {
        handle = await open(this.publicationLockPath, "wx", 0o600);
        await handle.writeFile(
          `${JSON.stringify({ owner, expiresAt: deadline })}\n`,
          "utf8"
        );
        await handle.sync();
      } catch (error) {
        if (!existsSync(this.publicationLockPath)) throw error;
        let recoverable = false;
        try {
          const [lockText, lockStat] = await Promise.all([
            readFile(this.publicationLockPath, "utf8"),
            stat(this.publicationLockPath)
          ]);
          let record: ProcessLockRecord = {};
          try {
            record = JSON.parse(lockText) as ProcessLockRecord;
          } catch {
            // A fresh partial lock remains owned until its mtime times out.
          }
          recoverable = processLockCanBeRecovered(
            record,
            Date.now() - lockStat.mtimeMs > 30_000
          );
        } catch {
          // Inspection races are not evidence that a publisher died.
        }
        if (recoverable) {
          const stalePath = `${this.publicationLockPath}.stale.${randomUUID()}`;
          try {
            await rename(this.publicationLockPath, stalePath);
            await rm(stalePath, { force: true });
            continue;
          } catch {
            // Another publisher recovered it first.
          }
        }
        if (Date.now() >= deadline) {
          throw new Error("Artifact publication mutex remained busy for 30 seconds.");
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 25));
      }
    }
    try {
      return await operation();
    } finally {
      await handle.close();
      try {
        const current = JSON.parse(
          await readFile(this.publicationLockPath, "utf8")
        ) as { owner?: string };
        if (current.owner === owner) {
          await rm(this.publicationLockPath, { force: true });
        }
      } catch {
        // Never remove another publisher's lock.
      }
    }
  }

  private publicationRoot(publishId: string): string {
    validatePublishKey(publishId, "publishId");
    return resolve(this.runtimeStore.requestRoot, "staging", publishId);
  }

  private manifestPath(publishId: string): string {
    return resolve(this.publicationRoot(publishId), "manifest.json");
  }

  private async readManifest(publishId: string): Promise<ArtifactPublishManifest> {
    const manifestPath = this.manifestPath(publishId);
    if (!existsSync(manifestPath)) {
      throw new Error(`Artifact publication manifest ${publishId} is missing.`);
    }
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ArtifactPublishManifest;
    if (
      manifest.schemaVersion !== ARTIFACT_MANIFEST_SCHEMA_VERSION
      || manifest.requestId !== this.requestId
      || manifest.publishId !== publishId
      || !Array.isArray(manifest.artifacts)
      || manifest.artifacts.length === 0
    ) {
      throw new Error(`Artifact publication manifest ${publishId} is invalid.`);
    }
    const { manifestDigest, ...digestInput } = manifest;
    if (manifestDigest !== sha256(canonicalJson(digestInput))) {
      throw new Error(`Artifact publication manifest ${publishId} digest is invalid.`);
    }
    for (const artifact of manifest.artifacts) {
      normalizeTargetPath(this.workspaceRoot, artifact.targetPath);
      assertInside(this.publicationRoot(publishId), artifact.stagedPath, "stagedPath");
      if (
        artifact.expectedPreviousDigest !== null
        && !/^[a-f0-9]{64}$/.test(artifact.expectedPreviousDigest)
      ) {
        throw new Error(
          `Artifact publication manifest ${publishId} has an invalid previous digest.`
        );
      }
    }
    return manifest;
  }
}

function toPrepared(
  manifest: ArtifactPublishManifest,
  manifestPath: string
): PreparedArtifactPublication {
  const artifacts = manifest.artifacts.map(({
    targetPath,
    digest,
    expectedPreviousDigest,
    sizeBytes
  }) => ({
    targetPath,
    digest,
    expectedPreviousDigest,
    sizeBytes
  }));
  return {
    publishId: manifest.publishId,
    manifestPath,
    manifestDigest: manifest.manifestDigest,
    event: {
      type: "ArtifactPublishPrepared",
      idempotencyKey: `${manifest.requestId}/${manifest.activityId}/artifact-publish/${manifest.publishId}`,
      payload: {
        publishId: manifest.publishId,
        activityId: manifest.activityId,
        manifestDigest: manifest.manifestDigest,
        artifacts
      }
    }
  };
}

function toPublishResult(
  manifest: ArtifactPublishManifest,
  recovered: boolean
): ArtifactPublishResult {
  return {
    state: "PUBLISHED",
    publishId: manifest.publishId,
    manifestDigest: manifest.manifestDigest,
    artifacts: manifest.artifacts.map(({ targetPath, digest, sizeBytes }) => ({
      targetPath,
      digest,
      sizeBytes
    })),
    recovered
  };
}

function normalizeTargetPath(workspaceRoot: string, targetPath: string): string {
  if (!targetPath || isAbsolute(targetPath)) {
    throw new Error("Artifact targetPath must be a workspace-relative path.");
  }
  const absolute = resolve(workspaceRoot, targetPath);
  assertInside(workspaceRoot, absolute, "targetPath");
  return relative(workspaceRoot, absolute).split("\\").join("/");
}

function assertInside(root: string, candidate: string, label: string): void {
  const pathFromRoot = relative(resolve(root), resolve(candidate));
  if (!pathFromRoot || pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new Error(`${label} must resolve to a file inside ${root}.`);
  }
}

async function assertSameFilesystem(
  stagingRoot: string,
  artifacts: StagedArtifact[],
  workspaceRoot: string
): Promise<void> {
  const stagingDevice = (await stat(stagingRoot)).dev;
  for (const artifact of artifacts) {
    const targetDirectory = dirname(resolve(workspaceRoot, artifact.targetPath));
    await mkdir(targetDirectory, { recursive: true });
    if ((await stat(targetDirectory)).dev !== stagingDevice) {
      throw new Error(
        `Staged artifact and target must share a filesystem: ${artifact.targetPath}`
      );
    }
  }
}

async function writeFileDurably(path: string, content: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, path);
  const directory = await open(dirname(path), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function digestFile(path: string): Promise<string> {
  return sha256(await readFile(path));
}

async function digestIfExists(path: string): Promise<string | null> {
  return existsSync(path) ? digestFile(path) : null;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function validatePublishKey(value: string, label: string): void {
  if (!value || !/^[A-Za-z0-9_.:-]+$/.test(value)) {
    throw new Error(`${label} contains unsupported characters.`);
  }
}
