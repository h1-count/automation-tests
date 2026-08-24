import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type ProjectExperienceEvidenceStatus = "待验证" | "受控探索已验证" | "正式执行已验证";

export interface ProjectExperienceInput {
  project: string;
  scope: string;
  observation: string;
  judgment: string;
  strategy: string;
  evidenceRefs: string[];
  validationCondition: string;
  evidenceStatus: ProjectExperienceEvidenceStatus;
}

const projectName = /^[a-z0-9][a-z0-9-]*$/;
const sensitive = /(?:password|passwd|token|secret|cookie|session|authorization|credential|api[_-]?key)\s*[:=]\s*\S+|(?:验证码|身份证|银行卡)(?:值|号|号码)?\s*[:：=]\s*[A-Za-z0-9-]{4,}/i;
const evidenceStatuses = new Set<ProjectExperienceEvidenceStatus>([
  "待验证",
  "受控探索已验证",
  "正式执行已验证"
]);

function assertSafe(value: string, field: string): void {
  if (!value.trim()) throw new Error(`${field} 不能为空。`);
  if (sensitive.test(value)) throw new Error(`${field} 不得包含敏感信息。`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function experienceId(project: string, scope: string): string {
  return createHash("sha256").update(`${project}\0${scope}`, "utf8").digest("hex").slice(0, 12).toUpperCase();
}

function renderEntry(input: ProjectExperienceInput, id: string, updatedAt: string): string {
  const lines = [
    `<!-- project-experience:${id}:start -->`,
    `<a id="exp-${id.toLowerCase()}"></a>`,
    `## ${updatedAt.slice(0, 10)}：${input.scope}`,
    "",
    `- 经验编号：EXP-${id}`,
    `- 适用范围：${input.scope}`,
    `- 证据状态：${input.evidenceStatus}`,
    `- 观察：${input.observation}`,
    `- 判断：${input.judgment}`,
  ];
  lines.push(
    `- 当前优先策略：${input.strategy}`,
    `- 证据引用：${input.evidenceRefs.join("、")}`,
    `- 验证条件：${input.validationCondition}`,
    `- 最近更新：${updatedAt}`,
    `<!-- project-experience:${id}:end -->`
  );
  return lines.join("\n");
}

export async function upsertProjectExperience(root: string, input: ProjectExperienceInput): Promise<string> {
  if (!projectName.test(input.project)) throw new Error("项目标识只能使用小写字母、数字和连字符。");
  if (!evidenceStatuses.has(input.evidenceStatus)) throw new Error("项目经验证据状态无效。");
  if (input.evidenceRefs.length === 0) throw new Error("项目经验至少需要一条证据引用。");

  const normalized: ProjectExperienceInput = {
    ...input,
    scope: input.scope.trim(),
    observation: input.observation.trim(),
    judgment: input.judgment.trim(),
    strategy: input.strategy.trim(),
    evidenceRefs: [...new Set(input.evidenceRefs.map((reference) => reference.trim()))],
    validationCondition: input.validationCondition.trim()
  };
  [normalized.scope, normalized.observation, normalized.judgment, normalized.strategy,
    normalized.validationCondition, ...normalized.evidenceRefs]
    .forEach((value) => assertSafe(value, "项目经验字段"));

  const id = experienceId(normalized.project, normalized.scope);
  // automation-engineering 是测试工程自身（非被测产品），其经验文件固定为 EXPERIENCE.md。
  const relativePath = normalized.project === "automation-engineering"
    ? "docs/testing/knowledge/EXPERIENCE.md"
    : `docs/testing/knowledge/${normalized.project}-testing-knowledge.md`;
  const path = resolve(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    content = `# ${normalized.project} 项目测试经验\n`;
  }

  const entry = renderEntry(normalized, id, new Date().toISOString());
  const marked = new RegExp(`<!-- project-experience:${id}:start -->[\\s\\S]*?<!-- project-experience:${id}:end -->`, "u");
  if (marked.test(content)) {
    content = content.replace(marked, entry);
  } else {
    const legacyHeading = new RegExp(`^## \\d{4}-\\d{2}-\\d{2}：${escapeRegExp(normalized.scope)}\\n[\\s\\S]*?(?=^## |(?![\\s\\S]))`, "mu");
    content = legacyHeading.test(content)
      ? content.replace(legacyHeading, `${entry}\n\n`)
      : `${content.trimEnd()}\n\n${entry}\n`;
  }

  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  await rename(temporary, path);
  return `${relativePath}#exp-${id.toLowerCase()}`;
}
