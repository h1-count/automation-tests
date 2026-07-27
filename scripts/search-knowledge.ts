import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

type UnknownRecord = Record<string, unknown>;

const projectRoot = resolve(import.meta.dirname, "..");
const sourcesRoot = resolve(projectRoot, "sources");

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

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function normalize(value: string) {
  return value.toLocaleLowerCase().replace(/[\s，,、/／；;：:()（）]/g, "");
}

function terms(value: string | undefined) {
  if (!value) {
    return [];
  }
  return value.split(/[\s，,、/／；;：:]+/).map(normalize).filter(Boolean);
}

const project = argument("--project");
const scope = argument("--scope");
const query = argument("--query");
if (!project || (!scope && !query)) {
  console.error("用法：npm run knowledge:search -- --project <project> --scope <scope> [--query <text>]。");
  process.exit(2);
}

const manifest = readYaml(resolve(sourcesRoot, "manifest.yaml"));
const registration = asRecords(manifest.knowledge_indexes).find((item) => item.project === project && item.status === "reviewed");
if (!registration || typeof registration.path !== "string") {
  console.error(`未找到项目 ${project} 的已审核知识索引。`);
  process.exit(2);
}

const index = readYaml(resolve(sourcesRoot, registration.path));
const materialPaths = new Map(
  asRecords(manifest.materials)
    .filter((item) => typeof item.id === "string" && typeof item.path === "string")
    .map((item) => [item.id as string, item.path as string])
);
const scopeTerm = normalize(scope ?? "");
const queryTerms = terms(query);
const matches = asRecords(index.documents).flatMap((document) => {
  const materialId = String(document.material_id);
  const sourcePath = materialPaths.get(materialId) ?? String(document.source_path);
  return asRecords(document.sections).flatMap((section) => {
    const topics = asStrings(section.topics);
    const keywords = asStrings(section.keywords);
    const searchable = [String(section.title ?? ""), String(section.summary ?? ""), ...topics, ...keywords].map(normalize);
    const reasons: string[] = [];
    let score = 0;
    if (scopeTerm) {
      const matchingTopic = topics.find((topic) => normalize(topic) === scopeTerm || normalize(topic).includes(scopeTerm) || scopeTerm.includes(normalize(topic)));
      if (!matchingTopic) {
        return [];
      }
      score += 100;
      reasons.push(`范围匹配：${matchingTopic}`);
    }
    for (const term of queryTerms) {
      const exactTopic = topics.find((topic) => normalize(topic) === term);
      const matched = searchable.find((value) => value.includes(term) || term.includes(value));
      if (exactTopic) {
        score += 40;
        reasons.push(`主题匹配：${exactTopic}`);
      } else if (matched) {
        score += 15;
        reasons.push(`关键词匹配：${term}`);
      }
    }
    if (queryTerms.length > 0 && reasons.length === 0) {
      return [];
    }
    return [{
      materialId,
      sectionId: String(section.section_id),
      title: String(section.title),
      sourcePath,
      locator: section.locator,
      topics,
      summary: String(section.summary),
      visualReadRequired: Boolean(section.visual_read_required),
      score,
      matchReasons: reasons
    }];
  });
});

matches.sort((left, right) => right.score - left.score || left.materialId.localeCompare(right.materialId) || left.sectionId.localeCompare(right.sectionId));
console.log(JSON.stringify({ project, scope: scope ?? null, query: query ?? null, matches }, null, 2));
