import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { computeSourceHash } from "../src/support/sources-ingest/sourcesManifest.js";

type UnknownRecord = Record<string, unknown>;

const projectRoot = resolve(import.meta.dirname, "..");
const sourcesRoot = resolve(projectRoot, "sources");
const forbiddenIndexContent = [".local/", ".local", ".auth", "repositories/", "artifacts/"];
let failures = 0;

function fail(message: string) {
  failures += 1;
  console.error(`[FAIL] ${message}`);
}

function pass(message: string) {
  console.log(`[PASS] ${message}`);
}

function readYaml(path: string): UnknownRecord {
  const value = parse(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} 不是 YAML 对象。`);
  }
  return value as UnknownRecord;
}

function asRecords(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.filter((item): item is UnknownRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function sourceSha256(path: string) {
  return computeSourceHash(path);
}

function hasLocator(section: UnknownRecord) {
  const locator = section.locator;
  return Boolean(locator && typeof locator === "object" && !Array.isArray(locator) && ("pages" in locator || "heading" in locator || "page" in locator));
}

function validateIndex(indexPath: string, project: string, expectedMaterialIds: Set<string>, materialPaths: Map<string, string>) {
  const index = readYaml(indexPath);
  if (index.project !== project) {
    fail(`${indexPath} 的 project 必须为 ${project}。`);
  }
  if (index.index_status !== "reviewed") {
    fail(`${indexPath} 的 index_status 必须为 reviewed。`);
  }

  const documents = asRecords(index.documents);
  const indexedIds = new Set<string>();
  const sectionIds = new Set<string>();
  const serializedIndex = JSON.stringify(index);
  for (const forbidden of forbiddenIndexContent) {
    if (serializedIndex.includes(forbidden)) {
      fail(`${indexPath} 不得包含受保护路径：${forbidden}`);
    }
  }

  for (const document of documents) {
    const materialId = document.material_id;
    const sourcePath = document.source_path;
    const sourceHash = document.source_sha256;
    if (typeof materialId !== "string" || !expectedMaterialIds.has(materialId)) {
      fail(`${indexPath} 包含未知或非 active 的资料编号：${String(materialId)}。`);
      continue;
    }
    if (indexedIds.has(materialId)) {
      fail(`${indexPath} 重复登记资料编号：${materialId}。`);
    }
    indexedIds.add(materialId);
    if (sourcePath !== materialPaths.get(materialId)) {
      fail(`${materialId} 的 source_path 必须与 manifest 一致。`);
    }
    const sourceFile = resolve(sourcesRoot, String(sourcePath));
    if (!existsSync(sourceFile)) {
      fail(`${materialId} 的原始资料不存在：${String(sourcePath)}。`);
    } else if (typeof sourceHash !== "string" || sourceSha256(sourceFile) !== sourceHash) {
      fail(`${materialId} 的原始资料已变化，章节索引需要重新审核。`);
    }
    if (!["native-text", "structured-html"].includes(String(document.extraction)) || document.visual_review !== "on-demand") {
      fail(`${materialId} 必须声明支持的文本/结构提取方式与 on-demand 视觉读取策略。`);
    }

    const sections = asRecords(document.sections);
    if (sections.length === 0) {
      fail(`${materialId} 缺少章节索引。`);
    }
    for (const section of sections) {
      const sectionId = section.section_id;
      const title = section.title;
      const summary = section.summary;
      const topics = asStrings(section.topics);
      const keywords = asStrings(section.keywords);
      const contentType = section.content_type;
      if (typeof sectionId !== "string" || !sectionId || sectionIds.has(sectionId)) {
        fail(`${materialId} 存在缺失或重复的 section_id：${String(sectionId)}。`);
      } else {
        sectionIds.add(sectionId);
      }
      if (typeof title !== "string" || !title || !hasLocator(section)) {
        fail(`${materialId}/${String(sectionId)} 缺少标题或页码/标题定位。`);
      }
      if (topics.length === 0 || keywords.length === 0 || typeof summary !== "string" || !summary || summary.length > 120) {
        fail(`${materialId}/${String(sectionId)} 缺少主题、关键词或有效简短摘要。`);
      }
      if (!["text-and-table", "text-and-image"].includes(String(contentType)) || typeof section.visual_read_required !== "boolean") {
        fail(`${materialId}/${String(sectionId)} 缺少内容类型或视觉读取标记。`);
      }
    }
  }

  const missing = [...expectedMaterialIds].filter((materialId) => !indexedIds.has(materialId));
  if (missing.length > 0) {
    fail(`${project} 缺少章节索引的 active 原始资料：${missing.join("、")}。`);
  }
  if (failures === 0) {
    pass(`${project}：${documents.length} 份原始资料、${sectionIds.size} 个章节条目均可回链且未过期。`);
  }
}

try {
  const manifest = readYaml(resolve(sourcesRoot, "manifest.yaml"));
  if (manifest.version !== 4) {
    fail("sources/manifest.yaml 必须使用版本 4（材料级 sha256 + version_history）。`knowledge_indexes` 是章节索引的唯一登记入口。");
  }
  const materials = asRecords(manifest.materials);
  for (const material of materials) {
    if (material.status !== "active") continue;
    const materialId = String(material.id ?? "<unknown>");
    const materialPath = typeof material.path === "string" ? material.path : "";
    if (typeof material.sha256 !== "string" || !material.sha256) {
      fail(`active 材料 ${materialId} 缺少材料级 sha256；请运行 npm run sources:ingest -- backfill。`);
      continue;
    }
    const materialFile = resolve(sourcesRoot, materialPath);
    if (!existsSync(materialFile)) {
      fail(`active 材料 ${materialId} 的文件不存在：${materialPath}。`);
    } else if (sourceSha256(materialFile) !== material.sha256) {
      fail(`active 材料 ${materialId} 的内容哈希与 manifest 不一致；文件可能被静默修改，需重新登记版本。`);
    }
  }
  const materialPaths = new Map(
    materials.filter((item) => typeof item.id === "string" && typeof item.path === "string").map((item) => [item.id as string, item.path as string])
  );
  const openPlatformMaterials = materials.filter(
    (item) =>
      item.status === "active" &&
      asStrings(item.applicable_projects).includes("open-platform") &&
      typeof item.path === "string"
  );
  const expectedMaterialIds = new Set(openPlatformMaterials.map((item) => item.id as string));
  const indexes = asRecords(manifest.knowledge_indexes);
  const registration = indexes.find((item) => item.id === "open-platform-knowledge-index");
  if (!registration || registration.project !== "open-platform" || registration.status !== "reviewed" || typeof registration.path !== "string") {
    fail("manifest 缺少 reviewed 状态的 open-platform-knowledge-index 登记。");
  } else {
    const covered = new Set(asStrings(registration.covered_material_ids));
    const missingRegistered = [...expectedMaterialIds].filter((id) => !covered.has(id));
    const extraRegistered = [...covered].filter((id) => !expectedMaterialIds.has(id));
    if (missingRegistered.length > 0 || extraRegistered.length > 0) {
      fail(`manifest 的开放平台索引覆盖清单不一致：缺少 ${missingRegistered.join("、") || "无"}；多余 ${extraRegistered.join("、") || "无"}。`);
    }
    const indexPath = resolve(sourcesRoot, registration.path);
    if (!existsSync(indexPath)) {
      fail(`章节索引文件不存在：${registration.path}。`);
    } else {
      validateIndex(indexPath, "open-platform", expectedMaterialIds, materialPaths);
    }
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log("知识资料索引检查通过（未读取原始资料正文）。");
}
