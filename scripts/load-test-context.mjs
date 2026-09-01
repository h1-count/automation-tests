import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ingestUploadedSources } from "./source-library.mjs";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const searchableExtensions = new Set([".html", ".json", ".md", ".txt", ".yaml", ".yml"]);
const manualReviewExtensions = new Set([".docx", ".pdf"]);
const scopeAliases = {
  "login-register": ["login", "register", "登录", "注册", "短信", "验证码", "手机号"],
  "create-product": ["create", "product", "创建产品", "产品开发", "产品类别", "智能化方式", "产品名称", "产品型号"],
};
const scopeSourceHints = {
  "open-platform/login-register": ["sources/open-platform/需求/AIoT平台项目.docx"],
  "open-platform/create-product": ["sources/open-platform/接口/开放平台接口文档.docx"],
};

function option(argumentsList, name) {
  const index = argumentsList.indexOf(name);
  return index >= 0 ? argumentsList[index + 1] : undefined;
}

function required(argumentsList, name) {
  const value = option(argumentsList, name);
  if (!value) throw new Error(`缺少参数：${name}`);
  return value;
}

function normalize(value) {
  return value.toLocaleLowerCase("zh-CN");
}

async function isFile(filePath) {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function collectFiles(directory) {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const children = await Promise.all(entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? collectFiles(entryPath) : [entryPath];
    }));
    return children.flat();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function findMatches(files, terms) {
  const matches = [];
  for (const filePath of files) {
    if (!searchableExtensions.has(path.extname(filePath).toLocaleLowerCase("en-US"))) continue;
    const relativePath = path.relative(rootDirectory, filePath);
    const content = await fs.readFile(filePath, "utf8");
    const haystack = normalize(`${relativePath}\n${content}`);
    const matchedTerms = terms.filter((term) => haystack.includes(normalize(term)));
    if (matchedTerms.length > 0) matches.push({ path: relativePath, matchedTerms });
  }
  return matches;
}

function parseIndexedSections(indexContent) {
  const sections = [];
  let sourcePath = "";
  let section;
  let readingKeywords = false;
  for (const line of indexContent.split("\n")) {
    const sourceMatch = line.match(/^  - source_path:\s*(.+)$/u);
    if (sourceMatch) {
      sourcePath = sourceMatch[1].replace(/^"|"$/gu, "");
      section = undefined;
      readingKeywords = false;
      continue;
    }
    const sectionMatch = line.match(/^      - (?:section_)?id:\s*(.+)$/u);
    if (sectionMatch && sourcePath) {
      section = { sourcePath, id: sectionMatch[1].replace(/^"|"$/gu, ""), title: "", keywords: [] };
      sections.push(section);
      readingKeywords = false;
      continue;
    }
    const titleMatch = line.match(/^        title:\s*(.+)$/u);
    if (titleMatch && section) {
      section.title = titleMatch[1].replace(/^"|"$/gu, "");
      continue;
    }
    if (/^        keywords:\s*$/u.test(line) && section) {
      readingKeywords = true;
      continue;
    }
    const keywordMatch = readingKeywords ? line.match(/^          -\s*(.+)$/u) : undefined;
    if (keywordMatch && section) {
      section.keywords.push(keywordMatch[1].replace(/^"|"$/gu, ""));
      continue;
    }
    if (/^        \S/u.test(line)) readingKeywords = false;
  }
  return sections;
}

const argumentsList = process.argv.slice(2);
const project = required(argumentsList, "--project");
const scope = required(argumentsList, "--scope");
const query = option(argumentsList, "--query");
const ingestion = await ingestUploadedSources({
  project,
  fromDirectory: path.join(rootDirectory, ".dsh-filess", project),
});
const projectSourceDirectory = path.join(rootDirectory, "sources", project);
const indexPath = path.join(rootDirectory, "sources", "indexes", `${project}.yaml`);
const experiencePaths = [
  path.join(rootDirectory, "experience", "general.md"),
  path.join(rootDirectory, "experience", `${project}.md`),
];
const experienceFiles = [];
for (const experiencePath of experiencePaths) {
  if (await isFile(experiencePath)) experienceFiles.push(path.relative(rootDirectory, experiencePath));
}
const indexFiles = (await isFile(indexPath)) ? [path.relative(rootDirectory, indexPath)] : [];

const terms = [...new Set([
  ...scopeAliases[scope] ?? scope.split(/[-_/\s]+/u),
  ...query?.split(/[\s,，]+/u) ?? [],
].filter(Boolean))];
const sourceFiles = await collectFiles(projectSourceDirectory);
const matchedSources = await findMatches(sourceFiles, terms);
const indexedSections = indexFiles.length > 0
  ? parseIndexedSections(await fs.readFile(indexPath, "utf8"))
    .filter((section) => section.keywords.some((keyword) => terms.some((term) => normalize(keyword).includes(normalize(term)) || normalize(term).includes(normalize(keyword)))))
  : [];
const manuallyReviewedSources = [...new Set([
  ...(scopeSourceHints[`${project}/${scope}`] ?? []),
  ...sourceFiles
    .filter((filePath) => manualReviewExtensions.has(path.extname(filePath).toLocaleLowerCase("en-US")))
    .filter((filePath) => terms.some((term) => normalize(path.basename(filePath)).includes(normalize(term))))
    .map((filePath) => path.relative(rootDirectory, filePath)),
])];

console.log(JSON.stringify({
  project,
  scope,
  query: query ?? null,
  terms,
  experienceFiles,
  indexFiles,
  indexedSections,
  ingestion,
  sourceDirectory: path.relative(rootDirectory, projectSourceDirectory),
  matchedSources,
  manuallyReviewedSources,
  nextStep: "阅读匹配资料和与范围直接相关的二进制资料；本清单只定位上下文，不替代需求判断。",
}, null, 2));
