import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  appendMaterialEntry,
  asRecords,
  computeSourceHash,
  defaultSourcesRoot,
  fileSha256,
  loadSourcesManifest,
  markCoveringIndexesStale,
  resolveManifestPath,
  supersedeMaterialVersion,
  writeSourcesManifest,
  type SourcesManifestPaths
} from "./sourcesManifest.js";
import { findPendingItem, logicalFileName, recordHandledDecision, type PendingItem, type ScanOptions } from "./ingest.js";

export type GitRunner = (args: string[], options?: { cwd?: string }) => { status: number; stdout: string; stderr: string };

export const spawnGitRunner: GitRunner = (args, options) =>
  spawnSync("git", args, { encoding: "utf8", cwd: options?.cwd }) as { status: number; stdout: string; stderr: string };

export interface ApplyOptions extends ScanOptions {
  itemId: string;
  mode: "register" | "request-scoped" | "ignore";
  gitRunner?: GitRunner;
  dryRun?: boolean;
  /** register + new material */
  materialId?: string;
  targetType?: string;
  targetDir?: string;
  sourceVersion?: string;
  projects?: string[];
  scopes?: string[];
  notes?: string;
  /** register + version replacement: the material being superseded */
  supersedes?: string;
  /** register + ambiguous resolved as an independent new material */
  forceNew?: boolean;
}

export interface ApplyResult {
  status: "applied" | "dry-run" | "rejected";
  mode: ApplyOptions["mode"];
  itemId: string;
  classification?: PendingItem["classification"];
  actions: string[];
  commit?: string;
  staleIndexes?: string[];
  warnings: string[];
}

function defaultNow(): string {
  return new Date().toISOString().slice(0, 10);
}

function verifyPendingFile(item: PendingItem): { absolutePath: string; sha256: string } {
  const candidates = item.file.paths.filter((path) => existsSync(path) && statSync(path).size > 0);
  if (candidates.length === 0) {
    throw new Error(`待登记项 ${item.itemId} 的暂存文件已不存在；请重新运行扫描。`);
  }
  const absolutePath = candidates[0];
  const sha256 = fileSha256(absolutePath);
  if (sha256 !== item.file.sha256) {
    throw new Error(`暂存文件内容与扫描时不一致（${absolutePath}）；已拒绝执行，请重新扫描。`);
  }
  return { absolutePath, sha256 };
}

function uniqueTargetPath(sourcesRoot: string, targetDir: string, fileName: string, sha256: string, allowOverwritePath?: string): { target: string; overwrites: boolean } {
  const direct = resolve(sourcesRoot, targetDir, fileName);
  if (allowOverwritePath && direct === allowOverwritePath) {
    return { target: direct, overwrites: true };
  }
  if (!existsSync(direct)) {
    return { target: direct, overwrites: false };
  }
  const extension = extname(fileName);
  const stem = basename(fileName, extension);
  let suffix = 1;
  let target = direct;
  while (existsSync(target)) {
    target = resolve(sourcesRoot, targetDir, `${stem}-${sha256.slice(0, 6)}-${suffix}${extension}`);
    suffix += 1;
  }
  return { target, overwrites: false };
}

function pruneJunk(root: string): void {
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = resolve(directory, entry.name);
      if (entry.name === "__MACOSX" && entry.isDirectory()) {
        rmSync(entryPath, { recursive: true, force: true });
      } else if (entry.isDirectory()) {
        walk(entryPath);
      } else if (entry.name === ".DS_Store" || entry.name.startsWith("._")) {
        rmSync(entryPath, { force: true });
      }
    }
  };
  walk(root);
}

function assertSafeZipEntries(zipPath: string): void {
  const listing = spawnSync("unzip", ["-Z1", zipPath], { encoding: "utf8" });
  if (listing.status !== 0) {
    throw new Error(`读取 zip 条目失败：${listing.stderr.trim()}`);
  }
  for (const rawLine of listing.stdout.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("/") || line.split("/").some((segment) => segment === "..")) {
      throw new Error(`zip 包含不安全路径条目：${line}`);
    }
  }
}

/**
 * Extracts an uploaded zip as a directory package: unzip (fallback ditto),
 * drop macOS/OS junk, hoist a single top-level wrapper directory so the
 * package root is the target itself.
 */
export function extractZipPackage(zipPath: string, target: string): void {
  assertSafeZipEntries(zipPath);
  const extractRoot = resolve(dirname(target), `.${basename(target)}.extract`);
  rmSync(extractRoot, { recursive: true, force: true });
  mkdirSync(extractRoot, { recursive: true });
  const unzip = spawnSync("unzip", ["-q", "-o", zipPath, "-d", extractRoot], { encoding: "utf8" });
  if (unzip.status !== 0) {
    const ditto = spawnSync("ditto", ["-x", "-k", zipPath, extractRoot], { encoding: "utf8" });
    if (ditto.status !== 0) {
      rmSync(extractRoot, { recursive: true, force: true });
      throw new Error(`解压失败：${unzip.stderr.trim() || ditto.stderr.trim()}`);
    }
  }
  pruneJunk(extractRoot);
  const entries = readdirSync(extractRoot).filter((name) => !name.startsWith("."));
  if (entries.length === 0) {
    rmSync(extractRoot, { recursive: true, force: true });
    throw new Error("zip 解压后为空（或仅包含系统垃圾文件）。");
  }
  const contentRoot = entries.length === 1 && statSync(resolve(extractRoot, entries[0])).isDirectory()
    ? resolve(extractRoot, entries[0])
    : extractRoot;
  mkdirSync(dirname(target), { recursive: true });
  renameSync(contentRoot, target);
  rmSync(extractRoot, { recursive: true, force: true });
}

function requiredSourceHash(path: string): string {
  const hash = computeSourceHash(path);
  if (!hash) {
    throw new Error(`无法计算内容哈希：${path}`);
  }
  return hash;
}

function commitScope(projects: string[]): string {
  return projects.length === 1 ? projects[0] : "sources";
}

function gitAddAndCommit(gitRunner: GitRunner, cwd: string, paths: string[], message: string): string {
  for (const path of paths) {
    const add = gitRunner(["add", "--", path], { cwd });
    if (add.status !== 0) throw new Error(`git add 失败（${path}）：${add.stderr.trim()}`);
  }
  const commit = gitRunner(["commit", "-m", message, "--", ...paths], { cwd });
  if (commit.status !== 0) throw new Error(`git commit 失败：${commit.stderr.trim() || commit.stdout.trim()}`);
  const rev = gitRunner(["rev-parse", "--short", "HEAD"], { cwd });
  if (rev.status !== 0) throw new Error(`读取提交哈希失败：${rev.stderr.trim()}`);
  return rev.stdout.trim();
}

export function slugifyMaterialId(fileName: string): string {
  const stem = basename(fileName, extname(fileName));
  return stem
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/(19|20)\d{6}$/, "")
    .replace(/v\d+([._]\d+)*$/, "")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Executes one approved pending item.
 *
 * - `register` copies the staged file into sources/, appends (or version-bumps)
 *   the manifest entry, marks covering indexes stale on version replacement and
 *   creates exactly one reviewable Git commit; on commit failure the manifest
 *   backup is restored and filesystem changes are rolled back.
 * - `request-scoped` / `ignore` only record the decision in inbox state.
 *
 * Version replacement keeps exactly one current file in the working tree: the
 * new file overwrites the old path when names match, otherwise the new file is
 * added and the old one removed — its content stays retrievable via Git history
 * and the manifest `version_history` records when and in which commit it was
 * superseded.
 */
export function applyPendingItem(options: ApplyOptions): ApplyResult {
  const item = findPendingItem(options.itemId, options);
  if (!item) {
    throw new Error(`找不到待登记项 ${options.itemId}；请先运行扫描。`);
  }
  const warnings: string[] = [];
  const actions: string[] = [];
  const base: Pick<ApplyResult, "itemId" | "mode" | "classification"> = {
    itemId: item.itemId,
    mode: options.mode,
    classification: item.classification
  };

  if (options.mode === "request-scoped" || options.mode === "ignore") {
    const detail =
      options.mode === "request-scoped"
        ? "按请求内来源使用；读取后在 plan.md 请求内来源记录路径、定位与 SHA-256。"
        : "用户确认忽略；不登记、不复制。";
    actions.push(`记录决策 ${options.mode}：${detail}`);
    if (item.sensitivity === "suspect") {
      warnings.push("该文件敏感初筛为 suspect：即使忽略也不得将其内容复制进 Git 或回复。");
    }
    if (!options.dryRun) {
      recordHandledDecision({ sha256: item.file.sha256, fileName: item.file.fileName, decision: options.mode, detail }, options);
    }
    return { ...base, status: options.dryRun ? "dry-run" : "applied", actions, warnings };
  }

  if (item.sensitivity === "suspect") {
    return {
      ...base,
      status: "rejected",
      actions: [],
      warnings: ["敏感初筛命中 suspect；登记前必须人工复核并显式说明该文件不含敏感数据。"]
    };
  }
  const { absolutePath } = verifyPendingFile(item);
  const manifestPaths: SourcesManifestPaths = options.manifestPaths ?? {};
  const sourcesRoot = resolve(manifestPaths.sourcesRoot ?? defaultSourcesRoot);
  const manifestFile = resolveManifestPath(manifestPaths);
  const projectDir = resolve(sourcesRoot, "..");
  const loaded = loadSourcesManifest(manifestPaths);
  const gitRunner = options.gitRunner ?? spawnGitRunner;

  const asVersionReplacement = item.classification === "new-version-candidate" || (item.classification === "ambiguous" && Boolean(options.supersedes));
  if (asVersionReplacement) {
    const materialId = options.supersedes;
    if (!materialId) {
      throw new Error("换版登记必须通过 --supersedes 指认被取代的资料编号。");
    }
    const material = asRecords(loaded.raw.materials).find((entry) => String(entry.id ?? "") === materialId);
    if (!material) {
      throw new Error(`--supersedes 指向的资料不存在：${materialId}`);
    }
    if (item.matchedMaterialIds.length > 0 && !item.matchedMaterialIds.includes(materialId)) {
      warnings.push(`用户指认 ${materialId}，但扫描匹配的是 ${item.matchedMaterialIds.join("、")}；已按用户指认执行。`);
    }
    const oldRelativePath = String(material.path ?? "");
    const oldAbsolutePath = resolve(sourcesRoot, oldRelativePath);
    const targetDir = dirname(oldRelativePath);
    const logicalName = logicalFileName(item.file.fileName);
    const isPackage = logicalName.toLowerCase().endsWith(".zip");
    const nextName = isPackage ? basename(logicalName, ".zip") : logicalName;
    const { target, overwrites } = isPackage
      ? { target: uniqueTargetPath(sourcesRoot, targetDir, nextName, item.file.sha256).target, overwrites: false }
      : uniqueTargetPath(sourcesRoot, targetDir, nextName, item.file.sha256, oldAbsolutePath);
    const relativeTarget = target.slice(sourcesRoot.length + 1);
    const sourceVersion = options.sourceVersion ?? "unknown";
    actions.push(overwrites ? `覆盖 ${relativeTarget}（同名换版）` : isPackage ? `解压包 → ${relativeTarget}/（markdown+附件目录包）` : `复制暂存文件 → ${relativeTarget}`);
    if (!overwrites && oldRelativePath && oldRelativePath !== relativeTarget) {
      actions.push(`移除旧路径 ${oldRelativePath}（内容保留在 Git 历史）`);
    }
    actions.push(`manifest：${materialId} 主字段指向新版本，旧版本沉入 version_history`);
    const staleTargets = markCoveringIndexesStale(loaded.raw, materialId);
    if (staleTargets.length > 0) {
      actions.push(`知识索引置 stale（需重新提取审核）：${staleTargets.join("、")}`);
    }
    actions.push("git 提交（可用 git log/git show 回溯旧版本）");
    if (options.dryRun) {
      return { ...base, status: "dry-run", actions, warnings, staleIndexes: staleTargets };
    }
    const manifestBackup = readFileSync(manifestFile, "utf8");
    const oldBackupPath = `${oldAbsolutePath}.ingest-rollback`;
    let oldFileMoved = false;
    if (isPackage) {
      extractZipPackage(absolutePath, target);
    } else {
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(absolutePath, target);
    }
    const nextSha256 = isPackage ? requiredSourceHash(target) : item.file.sha256;
    supersedeMaterialVersion(loaded.raw, materialId, { path: relativeTarget, sha256: nextSha256, sourceVersion }, defaultNow());
    if (!overwrites && existsSync(oldAbsolutePath) && oldAbsolutePath !== target) {
      renameSync(oldAbsolutePath, oldBackupPath);
      oldFileMoved = true;
    }
    try {
      writeSourcesManifest(loaded.raw, manifestPaths);
      const commitPaths = [manifestFile, target];
      if (oldFileMoved) commitPaths.push(oldAbsolutePath);
      const scope = commitScope(asRecordProjects(material));
      const commit = gitAddAndCommit(gitRunner, projectDir, commitPaths, `test(${scope}): 更新资料 ${materialId} 至新版本`);
      if (oldFileMoved) rmSync(oldBackupPath, { force: true });
      const history = asRecords(material.version_history);
      const last = history[history.length - 1];
      if (last) {
        last.superseded_in_commit = commit;
        writeSourcesManifest(loaded.raw, manifestPaths);
        const amend = gitRunner(["commit", "--amend", "--no-edit", "--", manifestFile], { cwd: projectDir });
        if (amend.status !== 0) {
          warnings.push(`回填 superseded_in_commit 失败（非致命）：${amend.stderr.trim()}`);
        }
      }
      recordHandledDecision({ sha256: item.file.sha256, fileName: item.file.fileName, decision: "register-version", detail: `取代 ${materialId}，提交 ${commit}` }, options);
      return { ...base, status: "applied", actions, commit, staleIndexes: staleTargets, warnings };
    } catch (error) {
      writeFileSync(manifestFile, manifestBackup);
      if (oldFileMoved && existsSync(oldBackupPath)) renameSync(oldBackupPath, oldAbsolutePath);
      if (!overwrites && existsSync(target) && target !== oldAbsolutePath) rmSync(target, { recursive: true, force: true });
      throw new Error(`登记失败已回滚（manifest 恢复、文件系统还原）：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (item.classification === "ambiguous" && !options.forceNew) {
    throw new Error(
      `ambiguous 项必须由用户指认：是 ${item.matchedMaterialIds.join("、")} 之一的新版本（--supersedes <id>），还是独立新资料（--force-new）。`
    );
  }

  const logicalName = logicalFileName(item.file.fileName);
  const isPackage = logicalName.toLowerCase().endsWith(".zip");
  const slug = slugifyMaterialId(logicalName);
  const materialId = options.materialId ?? (slug || `uploaded-${item.file.sha256.slice(0, 10)}`);
  if (!options.materialId && !slug) {
    warnings.push(`文件名无法推导 ASCII 编号，已使用 ${materialId}；建议通过 --material-id 提供语义编号。`);
  }
  if (loaded.materials.some((material) => material.id === materialId)) {
    throw new Error(`资料编号已存在：${materialId}；请通过 --material-id 指定其他编号。`);
  }
  const targetDir = options.targetDir ?? item.suggestion.targetDir ?? "需求";
  const nextName = isPackage ? basename(logicalName, ".zip") : logicalName;
  const { target } = uniqueTargetPath(sourcesRoot, targetDir, nextName, item.file.sha256);
  const relativeTarget = target.slice(sourcesRoot.length + 1);
  const projects = options.projects ?? [];
  const scopes = options.scopes ?? [];
  if (projects.length === 0) {
    warnings.push("applicable_projects 为空（未知不得默认适用）；后续确认项目后需修订 manifest。");
  }
  actions.push(isPackage ? `解压包 → ${relativeTarget}/（markdown+附件目录包）` : `复制暂存文件 → ${relativeTarget}`);
  actions.push(`manifest 追加新条目 ${materialId}（type=${options.targetType ?? item.suggestion.targetType}）`);
  actions.push("git 提交");
  if (options.dryRun) {
    return { ...base, status: "dry-run", actions, warnings };
  }
  const manifestBackup = readFileSync(manifestFile, "utf8");
  if (isPackage) {
    extractZipPackage(absolutePath, target);
  } else {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(absolutePath, target);
  }
  const nextSha256 = isPackage ? requiredSourceHash(target) : item.file.sha256;
  appendMaterialEntry(loaded.raw, {
    id: materialId,
    type: options.targetType ?? item.suggestion.targetType,
    path: relativeTarget,
    sha256: nextSha256,
    sourceVersion: options.sourceVersion ?? "unknown",
    applicableProjects: projects,
    referenceScopes: scopes,
    notes: options.notes ?? "上传摄取登记；适用项目与范围待确认。"
  });
  try {
    writeSourcesManifest(loaded.raw, manifestPaths);
    const commit = gitAddAndCommit(gitRunner, projectDir, [manifestFile, target], `test(${commitScope(projects)}): 登记新资料 ${materialId}`);
    recordHandledDecision({ sha256: item.file.sha256, fileName: item.file.fileName, decision: "register-new", detail: `新增 ${materialId}，提交 ${commit}` }, options);
    return { ...base, status: "applied", actions, commit, warnings };
  } catch (error) {
    writeFileSync(manifestFile, manifestBackup);
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    throw new Error(`登记失败已回滚（manifest 恢复、复制文件移除）：${error instanceof Error ? error.message : String(error)}`);
  }
}

function asRecordProjects(material: Record<string, unknown>): string[] {
  const projects = material.applicable_projects;
  return Array.isArray(projects) ? projects.filter((entry): entry is string => typeof entry === "string") : [];
}
