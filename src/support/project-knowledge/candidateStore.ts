import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { upsertProjectExperience } from "./projectExperienceStore.js";

export type CandidateStatus = "待验证" | "已提升" | "已放弃";
export type EvidenceType = "受控探索" | "正式执行";

export interface ProjectKnowledgeCandidate {
  id: string;
  project: string;
  scope: string;
  observation: string;
  judgment?: string;
  proposedStrategy: string;
  evidenceRefs: string[];
  validationCondition: string;
  status: CandidateStatus;
  createdAt: string;
  updatedAt: string;
  knowledgeRef?: string;
  promotedKnowledgeRef?: string;
  abandonedReason?: string;
}

export type ProjectKnowledgeCandidateInput = Omit<
  ProjectKnowledgeCandidate,
  "id" | "status" | "createdAt" | "updatedAt" | "knowledgeRef" | "promotedKnowledgeRef" | "abandonedReason" | "judgment"
> & { judgment: string };

type CandidateQueue = {
  schemaVersion: "project-knowledge-candidates-v1";
  project: string;
  candidates: ProjectKnowledgeCandidate[];
};

const sensitive = /(?:password|passwd|token|secret|cookie|session|authorization|credential|api[_-]?key)\s*[:=]\s*\S+|(?:验证码|身份证|银行卡)(?:值|号|号码)?\s*[:：=]\s*[A-Za-z0-9-]{4,}/i;
const projectName = /^[a-z0-9][a-z0-9-]*$/;

function assertSafe(value: string, field: string): void {
  if (!value.trim()) throw new Error(`${field} 不能为空。`);
  if (sensitive.test(value)) throw new Error(`${field} 不得包含敏感信息。`);
}

function assertProject(project: string): void {
  if (!projectName.test(project)) throw new Error("项目标识只能使用小写字母、数字和连字符。");
}

function queuePath(root: string, project: string): string {
  return resolve(root, ".local/project-knowledge-candidates", `${project}.json`);
}

function candidateId(input: Pick<ProjectKnowledgeCandidateInput, "project" | "scope" | "proposedStrategy">): string {
  return `CAND-${createHash("sha256")
    .update(`${input.project}\0${input.scope}\0${input.proposedStrategy}`, "utf8")
    .digest("hex")
    .slice(0, 10)
    .toUpperCase()}`;
}

async function atomicJson(path: string, value: CandidateQueue): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export async function readCandidateQueue(root: string, project: string): Promise<CandidateQueue> {
  assertProject(project);
  try {
    const queue = JSON.parse(await readFile(queuePath(root, project), "utf8")) as CandidateQueue;
    if (
      queue.schemaVersion !== "project-knowledge-candidates-v1"
      || queue.project !== project
      || !Array.isArray(queue.candidates)
    ) {
      throw new Error("候选队列格式无效。");
    }
    return queue;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { schemaVersion: "project-knowledge-candidates-v1", project, candidates: [] };
    }
    throw error;
  }
}

export async function addCandidate(
  root: string,
  input: ProjectKnowledgeCandidateInput
): Promise<ProjectKnowledgeCandidate> {
  assertProject(input.project);
  [input.scope, input.observation, input.judgment, input.proposedStrategy,
    input.validationCondition, ...input.evidenceRefs]
    .forEach((value) => assertSafe(value, "候选字段"));
  if (input.evidenceRefs.length === 0) throw new Error("候选至少需要一条证据引用。");

  const normalized: ProjectKnowledgeCandidateInput = {
    ...input,
    scope: input.scope.trim(),
    observation: input.observation.trim(),
    judgment: input.judgment.trim(),
    proposedStrategy: input.proposedStrategy.trim(),
    evidenceRefs: [...new Set(input.evidenceRefs.map((reference) => reference.trim()))],
    validationCondition: input.validationCondition.trim()
  };
  const queue = await readCandidateQueue(root, normalized.project);
  const timestamp = new Date().toISOString();
  const id = candidateId(normalized);
  const otherPendingCount = queue.candidates.filter(
    (item) => item.status === "待验证" && item.scope !== normalized.scope
  ).length;
  if (otherPendingCount >= 10) {
    throw new Error("待验证候选已达 10 条；请先合并或放弃旧候选。");
  }

  for (const item of queue.candidates) {
    if (item.status === "待验证" && item.scope === normalized.scope && item.id !== id) {
      item.status = "已放弃";
      item.abandonedReason = `同一适用范围已由最新候选 ${id} 覆盖`;
      item.updatedAt = timestamp;
    }
  }

  let candidate = queue.candidates.find((item) => item.id === id);
  if (candidate) {
    Object.assign(candidate, normalized, { status: "待验证", updatedAt: timestamp });
    delete candidate.promotedKnowledgeRef;
    delete candidate.abandonedReason;
  } else {
    candidate = {
      ...normalized,
      id,
      status: "待验证",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    queue.candidates.push(candidate);
  }

  candidate.knowledgeRef = await upsertProjectExperience(root, {
    project: normalized.project,
    scope: normalized.scope,
    observation: normalized.observation,
    judgment: normalized.judgment,
    strategy: normalized.proposedStrategy,
    evidenceRefs: normalized.evidenceRefs,
    validationCondition: normalized.validationCondition,
    evidenceStatus: "待验证"
  });
  await atomicJson(queuePath(root, normalized.project), queue);
  return candidate;
}

export async function promoteCandidate(
  root: string,
  project: string,
  id: string,
  promotedKnowledgeRef: string,
  evidenceType: EvidenceType
): Promise<ProjectKnowledgeCandidate> {
  assertProject(project);
  assertSafe(promotedKnowledgeRef, "经验库引用");
  if (!promotedKnowledgeRef.includes(`docs/testing/knowledge/${project}-testing-knowledge.md`)) {
    throw new Error("经验库引用必须指向同一项目的知识文件。");
  }
  if (!evidenceType) throw new Error("提升项目经验必须提供受控探索或正式执行证据类型。");

  const queue = await readCandidateQueue(root, project);
  const candidate = queue.candidates.find((item) => item.id === id);
  if (!candidate) throw new Error(`不存在候选：${id}`);
  if (candidate.status !== "待验证") {
    throw new Error(`候选 ${id} 当前状态为 ${candidate.status}，不能提升。`);
  }

  const knowledgeRef = await upsertProjectExperience(root, {
    project,
    scope: candidate.scope,
    observation: candidate.observation,
    judgment: candidate.judgment ?? "该观察已满足所列验证条件，可作为当前适用范围内的优先测试策略。",
    strategy: candidate.proposedStrategy,
    evidenceRefs: candidate.evidenceRefs,
    validationCondition: candidate.validationCondition,
    evidenceStatus: evidenceType === "受控探索" ? "受控探索已验证" : "正式执行已验证"
  });
  candidate.status = "已提升";
  candidate.knowledgeRef = knowledgeRef;
  candidate.promotedKnowledgeRef = knowledgeRef;
  candidate.updatedAt = new Date().toISOString();
  await atomicJson(queuePath(root, project), queue);
  return candidate;
}

export async function abandonCandidate(
  root: string,
  project: string,
  id: string,
  reason: string
): Promise<ProjectKnowledgeCandidate> {
  assertSafe(reason, "放弃原因");
  const queue = await readCandidateQueue(root, project);
  const candidate = queue.candidates.find((item) => item.id === id);
  if (!candidate) throw new Error(`不存在候选：${id}`);
  candidate.status = "已放弃";
  candidate.abandonedReason = reason;
  candidate.updatedAt = new Date().toISOString();
  await atomicJson(queuePath(root, project), queue);
  return candidate;
}
