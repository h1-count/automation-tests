import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import {
  asRecords,
  asStringList,
  defaultInboxRoot,
  fileSha256,
  loadSourcesManifest,
  type LoadedSourcesManifest,
  type MaterialRecord
} from "./sourcesManifest.js";

export type IngestClassification =
  | "duplicate"
  | "new-version-candidate"
  | "new-material-candidate"
  | "not-source-candidate"
  | "belongs-to-test-assets"
  | "ambiguous";

export type Sensitivity = "clean" | "suspect" | "manual-review";

export type SuggestedMode = "register" | "request-scoped" | "ignore" | "test-assets" | "confirm";

export interface StagedFile {
  absolutePath: string;
  displayPath: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
}

export interface ClassificationOutcome {
  classification: IngestClassification;
  matchedMaterialIds: string[];
  suggestedMode: SuggestedMode;
  suggestedType: string;
  suggestedDir: string;
  reason: string;
}

export interface PendingItem {
  itemId: string;
  classification: IngestClassification;
  sensitivity: Sensitivity;
  matchedMaterialIds: string[];
  suggestion: { mode: SuggestedMode; targetType: string; targetDir: string; reason: string };
  file: { paths: string[]; fileName: string; sizeBytes: number; sha256: string };
  firstSeenAt: string;
}

export interface InboxState {
  schemaVersion: 1;
  handled: Array<{ sha256: string; fileName: string; decision: string; decidedAt: string; detail: string }>;
}

export interface ScanOptions {
  stagingRoots?: string[];
  inboxDir?: string;
  manifestPaths?: Parameters<typeof loadSourcesManifest>[0];
  now?: () => string;
}

export interface ScanResult {
  pending: PendingItem[];
  scannedFiles: number;
  duplicates: number;
  alreadyHandled: number;
}

const INBOX_SCHEMA_VERSION = 1;
const SENSITIVE_SCAN_BYTES = 2 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".json", ".yaml", ".yml", ".csv", ".tsv", ".html", ".htm", ".xml", ".js", ".ts", ".mjs", ".log", ".properties", ".ini", ".conf"]);
const BINARY_EXTENSIONS = new Set([".doc", ".docx", ".pdf", ".xlsx", ".xls", ".ppt", ".pptx", ".zip", ".apk", ".ipa", ".bin", ".hex", ".img", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".7z", ".rar", ".tar", ".gz"]);
const TEST_ASSET_EXTENSIONS = new Set([".apk", ".ipa", ".bin", ".hex", ".img"]);

const SENSITIVE_PATTERNS: RegExp[] = [
  /(?:api[_-]?key|secret|token|passwd|password|authorization)\s*[:=]\s*["']?[A-Za-z0-9+/_\-.=]{16,}/i,
  /\bAKID[A-Za-z0-9]{10,}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\beyJ[A-Za-z0-9_-]{20,}\./,
  /\bBEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY\b/
];

const NOT_SOURCE_PATTERNS: RegExp[] = [/cases-review/i, /review-workbook/i, /测试用例$/];

const TYPE_BY_NAME_HINT: Array<{ pattern: RegExp; type: string; dir: string }> = [
  { pattern: /接口|api|openapi|云端|回调/i, type: "api-documentation", dir: "接口" },
  { pattern: /协议|protocol|蓝牙|ble|mqtt/i, type: "device-protocol", dir: "_shared/设备协议" },
  { pattern: /原型|prototype|axure/i, type: "prototype", dir: "原型包" },
  { pattern: /需求|规格|prd/i, type: "requirement", dir: "需求" },
  { pattern: /平台|帮助|中心|指南|guide|help/i, type: "platform-documentation", dir: "平台文档" },
  { pattern: /物模型|topic|payload/i, type: "integration-guide", dir: "物模型" }
];

function inboxDir(options: ScanOptions = {}): string {
  return resolve(options.inboxDir ?? defaultInboxRoot);
}

function readInboxState(options: ScanOptions = {}): InboxState {
  const path = resolve(inboxDir(options), "state.json");
  if (!existsSync(path)) {
    return { schemaVersion: INBOX_SCHEMA_VERSION, handled: [] };
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as InboxState;
  if (parsed.schemaVersion !== INBOX_SCHEMA_VERSION || !Array.isArray(parsed.handled)) {
    return { schemaVersion: INBOX_SCHEMA_VERSION, handled: [] };
  }
  return parsed;
}

function writeInboxState(state: InboxState, options: ScanOptions = {}): void {
  const dir = inboxDir(options);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "state.json"), `${JSON.stringify(state, null, 2)}\n`);
}

export function recordHandledDecision(decision: { sha256: string; fileName: string; decision: string; detail?: string }, options: ScanOptions = {}): InboxState {
  const state = readInboxState(options);
  state.handled.push({
    sha256: decision.sha256,
    fileName: decision.fileName,
    decision: decision.decision,
    decidedAt: (options.now ?? defaultNow)(),
    detail: decision.detail ?? ""
  });
  writeInboxState(state, options);
  return state;
}

function defaultNow(): string {
  return new Date().toISOString();
}

export function listStagedFiles(stagingRoot: string): StagedFile[] {
  if (!existsSync(stagingRoot)) {
    return [];
  }
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const entryPath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (entry.isFile()) {
        const stats = statSync(entryPath);
        if (stats.size > 0) files.push(entryPath);
      }
    }
  };
  walk(stagingRoot);
  return files.map((absolutePath) => {
    const stats = statSync(absolutePath);
    return {
      absolutePath,
      displayPath: absolutePath,
      fileName: basename(absolutePath),
      sizeBytes: stats.size,
      sha256: fileSha256(absolutePath)
    };
  });
}

/**
 * Strips the DSH upload prefix (`<6-16 hex>-`) from staged file names so
 * classification matches against the material's real name.
 */
export function logicalFileName(fileName: string): string {
  return fileName.replace(/^[0-9a-f]{6,16}-/, "");
}

/**
 * Normalizes a file base name for same-material matching: case folding, whitespace
 * removal, trailing YYYYMMDD dates and explicit version tokens. Used only to
 * propose version relationships; the user always confirms the supersedes target.
 */
export function normalizeBaseName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^.]+$/, "");
  return withoutExtension
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/(19|20)\d{6}$/, "")
    .replace(/v\d+([._]\d+)*$/, "")
    .replace(/version\d+$/, "");
}

function buildMaterialIndex(manifest: LoadedSourcesManifest): { bySha256: Map<string, string[]>; byNormalizedBase: Map<string, string[]> } {
  const bySha256 = new Map<string, string[]>();
  const byNormalizedBase = new Map<string, string[]>();
  for (const material of manifest.materials) {
    if (material.sha256) {
      bySha256.set(material.sha256, [...(bySha256.get(material.sha256) ?? []), material.id]);
    }
    const base = basename(material.path);
    const normalized = normalizeBaseName(base);
    byNormalizedBase.set(normalized, [...(byNormalizedBase.get(normalized) ?? []), material.id]);
  }
  return { bySha256, byNormalizedBase };
}

export function classifyStagedFile(file: StagedFile, manifest: LoadedSourcesManifest): ClassificationOutcome {
  const { bySha256, byNormalizedBase } = buildMaterialIndex(manifest);
  const extension = extname(file.fileName).toLowerCase();
  const logicalName = logicalFileName(file.fileName);
  const logicalStem = logicalName.replace(/\.[^.]+$/, "");

  const shaMatches = bySha256.get(file.sha256) ?? [];
  if (shaMatches.length > 0) {
    return {
      classification: "duplicate",
      matchedMaterialIds: shaMatches,
      suggestedMode: "ignore",
      suggestedType: "",
      suggestedDir: "",
      reason: `内容哈希与已登记资料一致：${shaMatches.join("、")}。无需登记。`
    };
  }

  if (TEST_ASSET_EXTENSIONS.has(extension)) {
    return {
      classification: "belongs-to-test-assets",
      matchedMaterialIds: [],
      suggestedMode: "test-assets",
      suggestedType: "",
      suggestedDir: "",
      reason: "安装包/固件类二进制属于静态测试资产，应登记到 test-assets/manifest.yaml 而不是 sources/。"
    };
  }

  if (NOT_SOURCE_PATTERNS.some((pattern) => pattern.test(logicalStem))) {
    return {
      classification: "not-source-candidate",
      matchedMaterialIds: [],
      suggestedMode: "ignore",
      suggestedType: "",
      suggestedDir: "",
      reason: "文件名符合本工程评审工作簿/交付物命名，属于工程产物而非原始需求资料。"
    };
  }

  const normalized = normalizeBaseName(logicalName);
  const normalizedMatches = (byNormalizedBase.get(normalized) ?? []).filter((id) => id.length > 0);
  const exactBaseMatches = manifest.materials.filter((material) => basename(material.path) === logicalName).map((material) => material.id);
  const versionMatches = exactBaseMatches.length > 0 ? exactBaseMatches : normalizedMatches;
  if (versionMatches.length === 1) {
    return {
      classification: "new-version-candidate",
      matchedMaterialIds: versionMatches,
      suggestedMode: "confirm",
      suggestedType: "",
      suggestedDir: "",
      reason: `与资料 ${versionMatches[0]} 的文件名规约匹配但内容哈希不同，疑似新版本；必须由用户确认取代关系。`
    };
  }
  if (versionMatches.length > 1) {
    return {
      classification: "ambiguous",
      matchedMaterialIds: versionMatches,
      suggestedMode: "confirm",
      suggestedType: "",
      suggestedDir: "",
      reason: `文件名与多个已登记资料相近：${versionMatches.join("、")}；需要用户指认是哪份资料的新版本或独立资料。`
    };
  }

  const hint = TYPE_BY_NAME_HINT.find((candidate) => candidate.pattern.test(logicalName));
  return {
    classification: "new-material-candidate",
    matchedMaterialIds: [],
    suggestedMode: "request-scoped",
    suggestedType: hint?.type ?? "unknown",
    suggestedDir: hint?.dir ?? "requirements",
    reason: hint
      ? `按文件名启发建议类型 ${hint.type}；默认按请求内来源使用，跨请求复用才晋升全局登记（流程规范 §3.1 第 4 条）。`
      : "无匹配资料；类型与适用项目未知，登记前必须由用户确认。默认按请求内来源使用。"
  };
}

export function scanSensitivity(absolutePath: string): Sensitivity {
  const extension = extname(absolutePath).toLowerCase();
  if (BINARY_EXTENSIONS.has(extension)) {
    return "manual-review";
  }
  if (!TEXT_EXTENSIONS.has(extension)) {
    return "manual-review";
  }
  const sample = Buffer.alloc(SENSITIVE_SCAN_BYTES);
  const handle = openSync(absolutePath, "r");
  let bytes = 0;
  try {
    bytes = readSync(handle, sample, 0, sample.length, 0);
  } finally {
    closeSync(handle);
  }
  const text = sample.subarray(0, bytes).toString("utf8");
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(text)) ? "suspect" : "clean";
}

/**
 * Scans upload staging roots, classifies every unseen file against the sources
 * manifest and refreshes the pending queue. Read-only with respect to sources/
 * and Git; re-running produces the same pending list (idempotent by content hash).
 */
export function runScan(options: ScanOptions = {}): ScanResult {
  const manifest = loadSourcesManifest(options.manifestPaths);
  const state = readInboxState(options);
  const handledHashes = new Set(state.handled.map((entry) => entry.sha256));
  const roots = options.stagingRoots ?? [];
  const stagedByHash = new Map<string, StagedFile[]>();
  for (const root of roots) {
    for (const file of listStagedFiles(root)) {
      stagedByHash.set(file.sha256, [...(stagedByHash.get(file.sha256) ?? []), file]);
    }
  }
  const now = (options.now ?? defaultNow)();
  const pending: PendingItem[] = [];
  let duplicates = 0;
  let alreadyHandled = 0;
  for (const [sha256, files] of stagedByHash) {
    if (handledHashes.has(sha256)) {
      alreadyHandled += files.length;
      continue;
    }
    const primary = files[0];
    const outcome = classifyStagedFile(primary, manifest);
    if (outcome.classification === "duplicate") {
      duplicates += files.length;
      continue;
    }
    pending.push({
      itemId: `item-${sha256.slice(0, 12)}`,
      classification: outcome.classification,
      sensitivity: scanSensitivity(primary.absolutePath),
      matchedMaterialIds: outcome.matchedMaterialIds,
      suggestion: { mode: outcome.suggestedMode, targetType: outcome.suggestedType, targetDir: outcome.suggestedDir, reason: outcome.reason },
      file: {
        paths: files.map((file) => file.displayPath),
        fileName: primary.fileName,
        sizeBytes: primary.sizeBytes,
        sha256
      },
      firstSeenAt: now
    });
  }
  pending.sort((left, right) => left.file.fileName.localeCompare(right.file.fileName));
  const dir = inboxDir(options);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "pending.json"), `${JSON.stringify({ schemaVersion: INBOX_SCHEMA_VERSION, generatedAt: now, pending }, null, 2)}\n`);
  return { pending, scannedFiles: [...stagedByHash.values()].reduce((total, files) => total + files.length, 0), duplicates, alreadyHandled };
}

export function readPendingItems(options: ScanOptions = {}): PendingItem[] {
  const path = resolve(inboxDir(options), "pending.json");
  if (!existsSync(path)) {
    return [];
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { pending?: PendingItem[] };
  return Array.isArray(parsed.pending) ? parsed.pending : [];
}

export function findPendingItem(itemId: string, options: ScanOptions = {}): PendingItem | undefined {
  return readPendingItems(options).find((item) => item.itemId === itemId);
}

export function materialById(manifest: LoadedSourcesManifest, materialId: string): MaterialRecord | undefined {
  return manifest.materials.find((material) => material.id === materialId);
}

export function renderScanReport(result: { pending: PendingItem[]; duplicates: number; alreadyHandled: number; scannedFiles: number }): string {
  if (result.pending.length === 0 && result.duplicates === 0) {
    return `上传摄取扫描：暂存区无可登记内容（扫描 ${result.scannedFiles} 个文件，已处理 ${result.alreadyHandled} 个）。`;
  }
  const lines = [
    `上传摄取扫描：${result.scannedFiles} 个文件，${result.pending.length} 项待确认，${result.duplicates} 项重复（内容已登记）。`,
    ""
  ];
  for (const item of result.pending) {
    lines.push(`- ${item.itemId}：${item.file.fileName}（${item.classification}，敏感=${item.sensitivity}）`);
    lines.push(`  ${item.suggestion.reason}`);
    lines.push(`  建议：${item.suggestion.mode}${item.suggestion.targetType ? `（type=${item.suggestion.targetType}，dir=${item.suggestion.targetDir}）` : ""}`);
  }
  return lines.join("\n");
}
