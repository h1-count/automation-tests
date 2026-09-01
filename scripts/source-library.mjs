import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceExtensions = new Set([".doc", ".docx", ".html", ".htm", ".md", ".pdf", ".txt"]);

function option(argumentsList, name) {
  const index = argumentsList.indexOf(name);
  return index >= 0 ? argumentsList[index + 1] : undefined;
}

function required(argumentsList, name) {
  const value = option(argumentsList, name);
  if (!value) throw new Error(`缺少参数：${name}`);
  return value;
}

function projectPath(project) {
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(project)) throw new Error(`非法项目名：${project}`);
  return project;
}

function yamlText(value) {
  return JSON.stringify(value);
}

function slug(value) {
  const normalized = value.normalize("NFKD").replace(/[^a-zA-Z0-9\u4e00-\u9fff]+/gu, "-");
  return normalized.replace(/^-+|-+$/gu, "").toLowerCase().slice(0, 60) || "uploaded-source";
}

function targetCategory(fileName) {
  if (/接口|api|openapi|回调/iu.test(fileName)) return "接口";
  if (/原型|prototype|axure/iu.test(fileName)) return "原型包";
  if (/需求|规格|prd/iu.test(fileName)) return "需求";
  return "平台文档";
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectUploadFiles(directory) {
  if (!(await exists(directory))) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    if (entry.name.startsWith(".")) return [];
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectUploadFiles(entryPath);
    return sourceExtensions.has(path.extname(entry.name).toLocaleLowerCase("en-US")) ? [entryPath] : [];
  }));
  return nested.flat();
}

async function writeAtomically(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await writeFile(temporaryPath, content, "utf8");
  await rename(temporaryPath, filePath);
}

function generatedDocumentEntry(project, relativeSourcePath) {
  const baseName = path.basename(relativeSourcePath);
  const title = path.basename(baseName, path.extname(baseName));
  const id = `uploaded-${slug(title)}`;
  const keyword = title.slice(0, 80);
  return [
    `  - source_path: ${yamlText(`${project}/${relativeSourcePath}`)}`,
    "    sections:",
    `      - id: ${yamlText(id)}`,
    `        title: ${yamlText(title)}`,
    "        keywords:",
    `          - ${yamlText(keyword)}`,
    "        summary: 新上传资料，待阅读原文后补充章节、关键词和测试影响。",
  ].join("\n");
}

async function appendIndexEntry(project, relativeSourcePath) {
  const indexPath = path.join(rootDirectory, "sources", "indexes", `${project}.yaml`);
  const sourcePath = `${project}/${relativeSourcePath}`;
  const current = (await exists(indexPath))
    ? await readFile(indexPath, "utf8")
    : `version: 1\nproject: ${project}\npurpose: 快速定位原始测试资料；不替代原始资料。\ndocuments:\n`;
  if (current.includes(`source_path: ${yamlText(sourcePath)}`)) return false;
  await writeAtomically(indexPath, `${current.trimEnd()}\n${generatedDocumentEntry(project, relativeSourcePath)}\n`);
  return true;
}

export async function ingestUploadedSources({ project, fromDirectory }) {
  projectPath(project);
  const files = await collectUploadFiles(fromDirectory);
  const result = { scanned: files.length, archived: [], skipped: [], indexUpdated: [] };
  for (const sourceFile of files) {
    const fileName = path.basename(sourceFile);
    const category = targetCategory(fileName);
    const destinationDirectory = path.join(rootDirectory, "sources", project, category);
    let destination = path.join(destinationDirectory, fileName);
    if (await exists(destination)) {
      const [sourceContent, destinationContent] = await Promise.all([readFile(sourceFile), readFile(destination)]);
      if (sourceContent.equals(destinationContent)) {
        result.skipped.push(path.relative(fromDirectory, sourceFile));
        const relativeSourcePath = path.relative(path.join(rootDirectory, "sources", project), destination);
        if (await appendIndexEntry(project, relativeSourcePath)) {
          result.indexUpdated.push(path.join("sources", "indexes", `${project}.yaml`));
        }
        continue;
      }
      const extension = path.extname(fileName);
      const stem = path.basename(fileName, extension);
      destination = path.join(destinationDirectory, `${stem}-${Date.now()}${extension}`);
    }
    await mkdir(destinationDirectory, { recursive: true });
    await copyFile(sourceFile, destination);
    const relativeSourcePath = path.relative(path.join(rootDirectory, "sources", project), destination);
    result.archived.push(path.join("sources", project, relativeSourcePath));
    if (await appendIndexEntry(project, relativeSourcePath)) {
      result.indexUpdated.push(path.join("sources", "indexes", `${project}.yaml`));
    }
  }
  return result;
}

function compactLegacyIndex(content, project) {
  const ignoredFields = /^\s*(?:-\s+)?(?:material_id|source_sha256|extraction|visual_review|content_type|visual_read_required):/u;
  const body = content
    .replace(/^  - material_id:.*\n    source_path:/gmu, "  - source_path:")
    .split("\n")
    .filter((line) => !ignoredFields.test(line))
    .filter((line) => !/^(version|project|index_status):/u.test(line))
    .filter((line) => line !== "documents:")
    .join("\n")
    .trimEnd();
  return [
    "version: 1",
    `project: ${project}`,
    "purpose: 快速定位原始测试资料；不替代原始资料。",
    "documents:",
    body,
    "",
  ].join("\n");
}

async function bootstrapFromLegacyIndex(project, legacyReference) {
  projectPath(project);
  const legacy = execFileSync("git", ["show", legacyReference], { cwd: rootDirectory, encoding: "utf8" });
  const indexPath = path.join(rootDirectory, "sources", "indexes", `${project}.yaml`);
  await writeAtomically(indexPath, compactLegacyIndex(legacy, project));
  return indexPath;
}

async function main() {
  const argumentsList = process.argv.slice(2);
  const command = argumentsList[0] ?? "ingest";
  const project = required(argumentsList, "--project");
  if (command === "bootstrap") {
    const indexPath = await bootstrapFromLegacyIndex(
      project,
      option(argumentsList, "--legacy-ref") ?? "HEAD:sources/indexes/open-platform.yaml"
    );
    process.stdout.write(`已重建资料索引：${path.relative(rootDirectory, indexPath)}\n`);
    return;
  }
  if (command === "ingest") {
    const fromDirectory = path.resolve(rootDirectory, option(argumentsList, "--from") ?? path.join(".dsh-filess", project));
    const result = await ingestUploadedSources({ project, fromDirectory });
    process.stdout.write(`${JSON.stringify({ fromDirectory, ...result }, null, 2)}\n`);
    return;
  }
  throw new Error(`未知命令：${command}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
