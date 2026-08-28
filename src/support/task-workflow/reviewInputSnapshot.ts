import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { link, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { canonicalJson } from "./canonicalJson.js";
import {
  reviewBatchScopeDigest,
  type ReviewBatchScope,
  type ReviewRoleCaseScope,
  hasCompleteReviewBatchScope
} from "./reviewBatchScope.js";
import { RuntimeLeaseStore } from "./runtimeLeaseStore.js";
import {
  isStructuredTestcaseDocumentVersion,
  TESTCASE_V6_LAYERED_MARKER,
  parseTestcaseDocument,
  testcaseV6LayeredSemanticProjection
} from "../testcase/testcaseDocument.js";

export const REVIEW_INPUT_SNAPSHOT_SCHEMA_VERSION = "review-input-snapshot-v1" as const;

export interface ReviewInputSnapshotArtifact {
  sourcePath: string;
  snapshotPath: string;
  digest: string;
  sizeBytes: number;
  semanticDigest?: string;
  roleSemanticDigests?: Record<string, string>;
}

/** A read-only reviewer packet. Full frozen originals remain in `artifacts`
 * for recovery and audit; dispatch exposes only this role-scoped projection. */
export interface ReviewRoleInputPacket {
  activityId: string;
  role: string;
  packetPath: string;
  digest: string;
  packetBytes: number;
  originalBytes: number;
}

export interface ReviewInputSnapshotManifest {
  schemaVersion: typeof REVIEW_INPUT_SNAPSHOT_SCHEMA_VERSION;
  requestId: string;
  batchId: string;
  createdAt: string;
  artifacts: ReviewInputSnapshotArtifact[];
  scope: ReviewBatchScope;
  scopeDigest: string;
  combinedDigest: string;
  semanticDigest: string;
  roleInputDigests: Record<string, string>;
  rolePackets: ReviewRoleInputPacket[];
}

export interface ReviewInputIdentity {
  artifacts: Array<Pick<
    ReviewInputSnapshotArtifact,
    "sourcePath" | "digest" | "sizeBytes"
  >>;
  combinedDigest: string;
  semanticDigest?: string;
  roleInputDigests?: Record<string, string>;
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

function isSemanticSnapshotManifest(manifest: ReviewInputSnapshotManifest): boolean {
  return Boolean(manifest.semanticDigest);
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

function stripTopLevelSections(markdown: string, excluded: RegExp): string {
  const kept: string[] = [];
  let skip = false;
  for (const line of markdown.split(/\r?\n/u)) {
    const heading = /^##\s+(.+?)\s*$/u.exec(line);
    if (heading) skip = excluded.test(heading[1]!);
    if (!skip) kept.push(line.trimEnd());
  }
  return kept.join("\n").replace(/\n{3,}/gu, "\n\n").trim();
}

function normalizePlanProjection(markdown: string): string {
  const withoutDerivedCaseIds = markdown.replace(
    /\b(?!(?:REQ|RULE|REV|MRR|EVO)-)[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+-\d{3}\b/gu,
    "<caseId>"
  );
  const lines = withoutDerivedCaseIds.split("\n");
  const normalized: string[] = [];
  for (let index = 0; index < lines.length;) {
    if (!lines[index]!.trim().startsWith("|")) {
      normalized.push(lines[index]!);
      index += 1;
      continue;
    }
    const table: string[] = [];
    while (index < lines.length && lines[index]!.trim().startsWith("|")) {
      table.push(lines[index]!);
      index += 1;
    }
    if (table.length >= 3 && /^\|(?:\s*:?-+:?\s*\|)+$/u.test(table[1]!.trim())) {
      normalized.push(table[0]!, table[1]!, ...table.slice(2).sort());
    } else {
      normalized.push(...table);
    }
  }
  return normalized.join("\n");
}

function semanticReviewContent(sourcePath: string, content: Uint8Array): Uint8Array {
  if (!sourcePath.endsWith(".md")) return content;
  const markdown = Buffer.from(content).toString("utf8");
  if (sourcePath.endsWith("/plan.md")) {
    return Buffer.from(normalizePlanProjection(stripTopLevelSections(
      markdown,
      /^(?:评审记录|多角色评审记录|评审与正式决定|用例集评审与演进|确认后的工程映射|工程层|预计交付物)/u
    )), "utf8");
  }
  if (/\/cases(?:-[^/]+)?\.md$/u.test(sourcePath)) {
    const version = parseTestcaseDocument(markdown).version;
    if (version === TESTCASE_V6_LAYERED_MARKER) {
      return Buffer.from(testcaseV6LayeredSemanticProjection(markdown), "utf8");
    }
    throw new Error(`Review snapshot only accepts ${TESTCASE_V6_LAYERED_MARKER}: ${sourcePath}.`);
  }
  return content;
}

function roleSemanticReviewContent(
  sourcePath: string,
  content: Uint8Array,
  roleScope: ReviewRoleCaseScope
): Uint8Array {
  const semantic = Buffer.from(semanticReviewContent(sourcePath, content)).toString("utf8");
  if (/\/cases(?:-[^/]+)?\.md$/u.test(sourcePath)) {
    const raw = Buffer.from(content).toString("utf8");
    const structured = isStructuredTestcaseDocumentVersion(parseTestcaseDocument(raw).version);
    const starts = [...semantic.matchAll(structured
      ? /^###\s+([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\s*｜\s*(.+?)\s*$/gmu
      : /^##\s+测试用例[：:]\s*(.+?)\s*$/gmu
    )];
    const allowed = new Set(roleScope.caseIds);
    const safetyLine = /(?:数据策略|权限|特权|允许操作|requiredOperations|permissionProfile|OTP|验证码|安全挑战|敏感凭据|cleanup|reconciliation|结果未知|无法判定)/iu;
    const identityLine = /(?:^###\s+[A-Z]|用例编号|需求编号|规则编号|需求追溯编号|规则覆盖编号|\bREQ-|\bRULE-)/u;
    const selected = starts.flatMap((start, index) => {
      const bodyStart = start.index ?? 0;
      const bodyEnd = starts[index + 1]?.index ?? semantic.length;
      const body = semantic.slice(bodyStart, bodyEnd);
      if (![...allowed].some((caseId) => body.includes(caseId))) return [];
      const lines = body.split(/\r?\n/u);
      const scoped = roleScope.role === "impact"
        ? lines.filter((line) => safetyLine.test(line) || identityLine.test(line))
        : lines.filter((line) => !safetyLine.test(line));
      return [scoped.join("\n").replace(/\n{3,}/gu, "\n\n").trim()];
    });
    return Buffer.from(selected.join("\n\n"), "utf8");
  }
  if (sourcePath.endsWith("/plan.md")) {
    const allowed = new Set([
      ...roleScope.caseIds,
      ...roleScope.requirementRefs,
      ...roleScope.ruleRefs
    ]);
    const filtered = semantic.split(/\r?\n/u).filter((line) => {
      const refs = line.match(/\b(?:REQ|RULE)-[A-Z0-9-]+\b|\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+-\d{3}\b/gu) ?? [];
      return refs.length === 0 || refs.some((ref) => allowed.has(ref));
    });
    return Buffer.from(filtered.join("\n").replace(/\n{3,}/gu, "\n\n").trim(), "utf8");
  }
  return Buffer.from(semantic, "utf8");
}

function sourceExcerptForRole(content: Uint8Array, roleScope: ReviewRoleCaseScope): string {
  const markdown = Buffer.from(content).toString("utf8");
  const references = [
    ...roleScope.caseIds,
    ...roleScope.requirementRefs,
    ...roleScope.ruleRefs
  ];
  if (!references.length) return "";
  const lines = markdown.split(/\r?\n/u);
  const selected = new Set<number>();
  for (const [index, line] of lines.entries()) {
    if (!references.some((reference) => line.includes(reference))) continue;
    for (let offset = -1; offset <= 1; offset += 1) {
      const candidate = index + offset;
      if (candidate >= 0 && candidate < lines.length) selected.add(candidate);
    }
    for (let heading = index - 1; heading >= 0; heading -= 1) {
      if (/^#{1,6}\s+/u.test(lines[heading]!)) {
        selected.add(heading);
        break;
      }
    }
  }
  return [...selected]
    .sort((left, right) => left - right)
    .map((index) => lines[index])
    .join("\n")
    .trim();
}

function rolePacketContent(
  sourcePath: string,
  content: Uint8Array,
  roleScope: ReviewRoleCaseScope
): string {
  if (/\/cases(?:-[^/]+)?\.md$/u.test(sourcePath) || sourcePath.endsWith("/plan.md")) {
    return Buffer.from(roleSemanticReviewContent(sourcePath, content, roleScope)).toString("utf8");
  }
  return sourcePath.endsWith(".md") ? sourceExcerptForRole(content, roleScope) : "";
}

function rolePacketMarkdown(
  batchId: string,
  roleScope: ReviewRoleCaseScope,
  artifacts: Array<Pick<ReviewInputSnapshotArtifact, "sourcePath" | "snapshotPath" | "digest" | "sizeBytes"> & { content: Uint8Array }>
): string {
  const lines = [
    "# 评审输入包", "",
    `- 批次：${batchId}`,
    `- 活动：${roleScope.activityId}`,
    `- 角色：${roleScope.role}`,
    `- 用例范围：${roleScope.caseIds.join(", ") || "无"}`,
    `- 需求范围：${roleScope.requirementRefs.join(", ") || "无"}`,
    `- 规则范围：${roleScope.ruleRefs.join(", ") || "无"}`,
    "- 全局边界：不得扩展上述范围；完整冻结原件仅用于恢复和审计。", "",
    "## 审计原件", "",
    "| 原始路径 | 摘要 | 字节 | 冻结副本 |",
    "| --- | --- | --- | --- |",
    ...artifacts.map((artifact) =>
      `| ${artifact.sourcePath} | ${artifact.digest} | ${artifact.sizeBytes} | ${artifact.snapshotPath} |`
    )
  ];
  for (const artifact of artifacts) {
    const content = rolePacketContent(artifact.sourcePath, artifact.content, roleScope);
    if (!content) continue;
    lines.push("", `## 切片：${artifact.sourcePath}`, "", content);
  }
  return `${lines.join("\n").trim()}\n`;
}

export function semanticReviewInputDigest(
  requestId: string,
  artifacts: Array<Pick<ReviewInputSnapshotArtifact, "sourcePath" | "semanticDigest">>,
  scopeDigest?: string
): string {
  return sha256(canonicalJson({
    schemaVersion: REVIEW_INPUT_SNAPSHOT_SCHEMA_VERSION,
    requestId,
    ...(scopeDigest ? { scopeDigest } : {}),
    artifacts: [...artifacts].map(({ sourcePath, semanticDigest }) => ({
      sourcePath,
      ...(semanticDigest ? { semanticDigest } : {})
    })).sort((left, right) => left.sourcePath.localeCompare(right.sourcePath))
  }));
}

export function reviewRoleInputDigests(
  requestId: string,
  artifacts: Array<Pick<
    ReviewInputSnapshotArtifact,
    "sourcePath" | "semanticDigest" | "roleSemanticDigests"
  >>,
  scopeDigest: string | undefined,
  scope?: ReviewBatchScope
): Record<string, string> {
  if (!scope || !hasCompleteReviewBatchScope(scope)) return {};
  return Object.fromEntries(scope.roleScopes.map((roleScope) => [
    roleScope.activityId,
    sha256(canonicalJson({
      schemaVersion: "review-role-input-v1",
      requestId,
      ...(scopeDigest ? { scopeDigest } : {}),
      artifacts: [...artifacts].map((artifact) => ({
        sourcePath: artifact.sourcePath,
        semanticDigest: artifact.roleSemanticDigests?.[roleScope.activityId]
          ?? artifact.semanticDigest
          ?? ""
      })).sort((left, right) => left.sourcePath.localeCompare(right.sourcePath)),
      roleScope: {
        activityId: roleScope.activityId,
        role: roleScope.role,
        caseIds: roleScope.caseIds,
        requirementRefs: roleScope.requirementRefs,
        ruleRefs: roleScope.ruleRefs
      }
    }))
  ]));
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
  readonly suiteRoot: string | undefined;
  readonly runtimeStore: RuntimeLeaseStore;
  private readonly blobRoot: string;

  constructor(
    readonly requestId: string,
    options: {
      workspaceRoot?: string;
      runtimeRoot?: string;
      runtimeStore?: RuntimeLeaseStore;
      runRoot?: string;
      suiteRoot?: string;
    } = {}
  ) {
    this.workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
    this.requestRoot = options.runRoot
      ? resolve(options.runRoot)
      : resolve(this.workspaceRoot, "testcases", ...requestId.split("/"));
    this.suiteRoot = options.suiteRoot;
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
    scope: ReviewBatchScope
  ): Promise<ReviewInputSnapshotManifest> {
    this.validateBatchId(batchId);
    if (!inputPaths.length) throw new Error("A review input snapshot requires at least one input path.");
    const requested = await this.normalizeInputPaths(inputPaths);
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
        semanticDigest: sha256(semanticReviewContent(sourcePath, content)),
        roleSemanticDigests: Object.fromEntries(scope.roleScopes.map((roleScope) => [
          roleScope.activityId,
          sha256(roleSemanticReviewContent(sourcePath, content, roleScope))
        ])),
        content
      };
    }));
    const identity = artifacts.map(({ sourcePath, digest, sizeBytes }) => ({
      sourcePath,
      digest,
      sizeBytes
    }));
    const scopeDigest = reviewBatchScopeDigest(scope);
    const semanticDigest = semanticReviewInputDigest(this.requestId, artifacts, scopeDigest);
    const combinedDigest = semanticDigest;
    const reviewerDigests = reviewRoleInputDigests(this.requestId, artifacts, scopeDigest, scope);
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
      const rolePackets = await Promise.all(scope.roleScopes.map(async (roleScope) => {
            const content = Buffer.from(rolePacketMarkdown(batchId, roleScope, artifacts), "utf8");
            const packetPath = resolve(this.batchRoot(batchId), "packets", `${roleScope.activityId}.md`);
            await atomicWrite(packetPath, content);
            return {
              activityId: roleScope.activityId,
              role: roleScope.role,
              packetPath,
              digest: sha256(content),
              packetBytes: content.byteLength,
              originalBytes: artifacts.reduce((sum, artifact) => sum + artifact.sizeBytes, 0)
            };
          }));
      const manifest: ReviewInputSnapshotManifest = {
        schemaVersion: REVIEW_INPUT_SNAPSHOT_SCHEMA_VERSION,
        requestId: this.requestId,
        batchId,
        createdAt: new Date().toISOString(),
        artifacts: artifacts.map(({ content: _content, ...artifact }) => artifact),
        scope,
        scopeDigest,
        combinedDigest,
        semanticDigest,
        roleInputDigests: reviewerDigests,
        rolePackets
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
    const requested = await this.normalizeInputPaths(inputPaths);
    const artifacts = await Promise.all(requested.map(async (sourcePath) => {
      const content = await readFile(resolve(this.workspaceRoot, sourcePath));
      return {
        sourcePath,
        digest: sha256(content),
        sizeBytes: content.byteLength,
        semanticDigest: sha256(semanticReviewContent(sourcePath, content)),
        ...(scope !== undefined && hasCompleteReviewBatchScope(scope)
          ? {
              roleSemanticDigests: Object.fromEntries(scope.roleScopes.map((roleScope) => [
                roleScope.activityId,
                sha256(roleSemanticReviewContent(sourcePath, content, roleScope))
              ]))
            }
          : {})
      };
    }));
    const scopeDigest = scope ? reviewBatchScopeDigest(scope) : undefined;
    const semanticDigest = scope !== undefined && hasCompleteReviewBatchScope(scope)
      ? semanticReviewInputDigest(this.requestId, artifacts, scopeDigest)
      : undefined;
    return {
      artifacts,
      combinedDigest: semanticDigest ?? reviewInputDigest(this.requestId, artifacts, scopeDigest),
      ...(semanticDigest ? {
        semanticDigest,
        roleInputDigests: reviewRoleInputDigests(
          this.requestId,
          artifacts,
          scopeDigest,
          scope
        )
      } : {})
    };
  }

  async read(batchId: string): Promise<ReviewInputSnapshotManifest> {
    this.validateBatchId(batchId);
    const manifest = await this.readIfExists(batchId);
    if (!manifest) throw new Error(`Review input snapshot ${batchId} does not exist.`);
    return manifest;
  }

  /** Returns a verified, role-scoped packet for host reviewer dispatch. */
  async readRolePacket(batchId: string, activityId: string): Promise<ReviewRoleInputPacket | undefined> {
    const manifest = await this.verify(batchId);
    return manifest.rolePackets?.find((packet) => packet.activityId === activityId);
  }

  async verify(batchId: string): Promise<ReviewInputSnapshotManifest> {
    const manifest = await this.read(batchId);
    const identity: Array<{ sourcePath: string; digest: string; sizeBytes: number }> = [];
    for (const artifact of manifest.artifacts) {
      this.normalizeInputPath(
        artifact.sourcePath,
        new Set([resolve(this.workspaceRoot, artifact.sourcePath)])
      );
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
      if (
        isSemanticSnapshotManifest(manifest)
        && (
          !artifact.semanticDigest
          || sha256(semanticReviewContent(artifact.sourcePath, content)) !== artifact.semanticDigest
        )
      ) {
        throw new Error(`Review input snapshot ${batchId} has an invalid semantic digest.`);
      }
      if (
        isSemanticSnapshotManifest(manifest)
        && hasCompleteReviewBatchScope(manifest.scope)
      ) {
        const expectedRoleArtifactDigests = Object.fromEntries(
          manifest.scope.roleScopes.map((roleScope) => [
            roleScope.activityId,
            sha256(roleSemanticReviewContent(artifact.sourcePath, content, roleScope))
          ])
        );
        if (JSON.stringify(artifact.roleSemanticDigests ?? {}) !== JSON.stringify(expectedRoleArtifactDigests)) {
          throw new Error(`Review input snapshot ${batchId} has invalid role semantic digests.`);
        }
      }
    }
    const scopeDigest = reviewBatchScopeDigest(manifest.scope);
    if (
      scopeDigest !== manifest.scopeDigest
      || (manifest.scopeDigest !== undefined && !digestPattern.test(manifest.scopeDigest))
    ) {
      throw new Error(`Review input snapshot ${batchId} has an invalid scope digest.`);
    }
    const semanticDigest = isSemanticSnapshotManifest(manifest)
      ? semanticReviewInputDigest(this.requestId, manifest.artifacts, scopeDigest)
      : undefined;
    const combinedDigest = semanticDigest
      ?? reviewInputDigest(this.requestId, identity, scopeDigest);
    if (combinedDigest !== manifest.combinedDigest) {
      throw new Error(`Review input snapshot ${batchId} has an invalid combined digest.`);
    }
    if (semanticDigest) {
      const expectedRoleDigests = reviewRoleInputDigests(
        this.requestId,
        manifest.artifacts,
        scopeDigest,
        manifest.scope
      );
      if (
        manifest.semanticDigest !== semanticDigest
        || JSON.stringify(manifest.roleInputDigests ?? {})
          !== JSON.stringify(expectedRoleDigests)
      ) {
        throw new Error(`Review input snapshot ${batchId} has invalid role input digests.`);
      }
    }
    if (manifest.schemaVersion === REVIEW_INPUT_SNAPSHOT_SCHEMA_VERSION) {
      if (!hasCompleteReviewBatchScope(manifest.scope)) {
        throw new Error(`Review input snapshot ${batchId} requires a role scope.`);
      }
      const expectedActivities = manifest.scope.roleScopes.map((scope) => scope.activityId).sort();
      const packets = manifest.rolePackets ?? [];
      if (JSON.stringify(packets.map((packet) => packet.activityId).sort()) !== JSON.stringify(expectedActivities)) {
        throw new Error(`Review input snapshot ${batchId} has invalid role packets.`);
      }
      const originalBytes = manifest.artifacts.reduce((sum, artifact) => sum + artifact.sizeBytes, 0);
      for (const packet of packets) {
        const roleScope = manifest.scope.roleScopes.find((scope) => scope.activityId === packet.activityId);
        const packetPath = resolve(packet.packetPath);
        const packetRelative = portableRelative(this.batchRoot(batchId), packetPath);
        if (
          !roleScope
          || roleScope.role !== packet.role
          || !packetRelative.startsWith("packets/")
          || packetRelative.includes("..")
          || !digestPattern.test(packet.digest)
          || packet.originalBytes !== originalBytes
          || !Number.isInteger(packet.packetBytes)
          || packet.packetBytes < 0
        ) {
          throw new Error(`Review input snapshot ${batchId} has an invalid role packet.`);
        }
        const content = await readFile(packetPath);
        if (sha256(content) !== packet.digest || content.byteLength !== packet.packetBytes) {
          throw new Error(`Review input snapshot ${batchId} has a corrupt role packet: ${packet.activityId}`);
        }
        const expected = Buffer.from(rolePacketMarkdown(batchId, roleScope, await Promise.all(manifest.artifacts.map(async (artifact) => ({
          ...artifact,
          content: await readFile(artifact.snapshotPath)
        })))));
        if (Buffer.compare(content, expected) !== 0) {
          throw new Error(`Review input snapshot ${batchId} has an invalid role packet: ${packet.activityId}`);
        }
      }
    }
    return manifest;
  }

  /** A frozen copy proves what was reviewed; this check proves the formal
   * inputs have not changed before a dispatch or submission can advance. */
  async verifyCurrentSources(
    batchId: string,
    activityId?: string
  ): Promise<ReviewInputSnapshotManifest> {
    const manifest = await this.verify(batchId);
    const current = await this.inspectCurrent(
      manifest.artifacts.map((artifact) => artifact.sourcePath),
      manifest.scope
    );
    const currentDigest = activityId
      ? current.roleInputDigests?.[activityId] ?? current.combinedDigest
      : current.combinedDigest;
    const expectedDigest = activityId
      ? manifest.roleInputDigests?.[activityId] ?? manifest.combinedDigest
      : manifest.combinedDigest;
    if (currentDigest !== expectedDigest) {
      throw new Error(`Review batch ${batchId} input drifted for ${activityId ?? "batch"}.`);
    }
    return manifest;
  }

  /** Rebuild disposable files; the manager compares this result to history. */
  async repair(
    batchId: string,
    inputPaths: string[],
    scope: ReviewBatchScope
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

  private async normalizeInputPaths(paths: string[]): Promise<string[]> {
    const planPath = resolve(this.requestRoot, "plan.md");
    const allowedRequestSources = new Set<string>();
    if (existsSync(planPath)) {
      const plan = await readFile(planPath, "utf8");
      const heading = /^##\s+请求内来源\s*$/mu.exec(plan);
      if (heading) {
        const start = heading.index + heading[0].length;
        const next = /^##\s+/mu.exec(plan.slice(start));
        const section = plan.slice(start, next ? start + next.index : undefined);
        for (const match of section.matchAll(/\]\(\s*<?([^)>]+?)>?\s*\)/gu)) {
          let reference = match[1]!.trim();
          try {
            reference = decodeURI(reference);
          } catch {
            // Keep the literal path; normalizeInputPath still validates it.
          }
          allowedRequestSources.add(resolve(this.requestRoot, reference));
        }
      }
    }
    return [...new Set(paths.map((path) => this.normalizeInputPath(path, allowedRequestSources)))].sort();
  }

  private normalizeInputPath(path: string, allowedRequestSources = new Set<string>()): string {
    const absolute = resolve(this.workspaceRoot, path);
    const requestRelative = portableRelative(this.requestRoot, absolute);
    if (
      requestRelative
      && requestRelative !== ".."
      && !requestRelative.startsWith("../")
      && /^(?:plan\.md|run-intent\.json|script-review-assessment\.json|cases(?:-[a-z0-9][a-z0-9-]*)?\.md|candidate-scripts\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.(?:ts|json))$/.test(requestRelative)
    ) {
      return portableRelative(this.workspaceRoot, absolute);
    }
    if (this.suiteRoot) {
      // Suite-bound design assets (cases.md / design.md) live in the committed
      // suite directory instead of the run archive.
      const suiteRelative = portableRelative(this.suiteRoot, absolute);
      if (
        suiteRelative
        && suiteRelative !== ".."
        && !suiteRelative.startsWith("../")
        && /^(?:cases(?:-[a-z0-9][a-z0-9-]*)?\.md|design\.md)$/.test(suiteRelative)
      ) {
        return portableRelative(this.workspaceRoot, absolute);
      }
    }
    const workspaceRelative = portableRelative(this.workspaceRoot, absolute);
    const hasHiddenSegment = workspaceRelative
      .split("/")
      .some((segment) => segment.startsWith("."));
    if (
      !hasHiddenSegment
      && (
        workspaceRelative === "sources/manifest.yaml"
        || /^(?:src\/support\/(?:formal-execution\/(?:formalCase|manifest|operationEvidence)|web\/networkOperationGuard)\.ts)$/.test(workspaceRelative)
        || /^sources\/indexes\/[a-z0-9][a-z0-9-]*\.ya?ml$/.test(workspaceRelative)
        || /^sources\/(?!indexes\/|README)[^/]+\/.+/.test(workspaceRelative)
      )
    ) {
      return workspaceRelative;
    }
    const externalSegments = absolute.split(sep).filter(Boolean);
    const allowedExternalExtensions = new Set([
      ".docx", ".pdf", ".md", ".txt", ".yaml", ".yml", ".json",
      ".png", ".jpg", ".jpeg", ".webp"
    ]);
    if (
      isAbsolute(path)
      && allowedRequestSources.has(absolute)
      && !externalSegments.some((segment) => segment.startsWith("."))
      && allowedExternalExtensions.has(extname(absolute).toLowerCase())
    ) {
      return absolute;
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
      ![
        REVIEW_INPUT_SNAPSHOT_SCHEMA_VERSION,
        REVIEW_INPUT_SNAPSHOT_SCHEMA_VERSION,
        REVIEW_INPUT_SNAPSHOT_SCHEMA_VERSION
      ].includes(parsed.schemaVersion)
      || parsed.requestId !== this.requestId
      || parsed.batchId !== batchId
      || !Array.isArray(parsed.artifacts)
      || !parsed.artifacts.length
      || (parsed.scope === undefined) !== (parsed.scopeDigest === undefined)
      || !digestPattern.test(parsed.combinedDigest)
      || ((parsed.schemaVersion === REVIEW_INPUT_SNAPSHOT_SCHEMA_VERSION
          || parsed.schemaVersion === REVIEW_INPUT_SNAPSHOT_SCHEMA_VERSION)
        && (
          !parsed.semanticDigest
          || !digestPattern.test(parsed.semanticDigest)
          || !parsed.roleInputDigests
          || Object.values(parsed.roleInputDigests).some((digest) => !digestPattern.test(digest))
        ))
      || (parsed.schemaVersion === REVIEW_INPUT_SNAPSHOT_SCHEMA_VERSION
        && !Array.isArray(parsed.rolePackets))
    ) {
      throw new Error(`Review input snapshot manifest ${batchId} is invalid.`);
    }
    return parsed;
  }
}
