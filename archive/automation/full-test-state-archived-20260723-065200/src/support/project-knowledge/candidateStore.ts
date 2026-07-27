import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type CandidateStatus = "待验证" | "已提升" | "已放弃";
export type EvidenceType = "受控探索" | "正式执行";

export interface ProjectKnowledgeCandidate {
  id: string;
  project: string;
  scope: string;
  observation: string;
  proposedStrategy: string;
  evidenceRefs: string[];
  validationCondition: string;
  status: CandidateStatus;
  createdAt: string;
  updatedAt: string;
  promotedKnowledgeRef?: string;
  abandonedReason?: string;
}

type CandidateQueue = { schemaVersion: "project-knowledge-candidates-v1"; project: string; candidates: ProjectKnowledgeCandidate[] };

const sensitive = /(password|passwd|token|secret|cookie|session|authorization|credential|api[_-]?key|验证码|身份证|银行卡)/i;
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
    if (queue.schemaVersion !== "project-knowledge-candidates-v1" || queue.project !== project || !Array.isArray(queue.candidates)) throw new Error("候选队列格式无效。");
    return queue;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: "project-knowledge-candidates-v1", project, candidates: [] };
    throw error;
  }
}

export async function addCandidate(root: string, input: Omit<ProjectKnowledgeCandidate, "id" | "status" | "createdAt" | "updatedAt">): Promise<ProjectKnowledgeCandidate> {
  assertProject(input.project);
  [input.scope, input.observation, input.proposedStrategy, input.validationCondition, ...input.evidenceRefs].forEach((value) => assertSafe(value, "候选字段"));
  const queue = await readCandidateQueue(root, input.project);
  const duplicate = queue.candidates.find((item) => item.status === "待验证" && item.scope === input.scope && item.proposedStrategy === input.proposedStrategy);
  if (duplicate) return duplicate;
  if (queue.candidates.filter((item) => item.status === "待验证").length >= 10) throw new Error("待验证候选已达 10 条；请先合并或放弃旧候选。");
  const timestamp = new Date().toISOString();
  const id = `CAND-${createHash("sha256").update(`${input.project}\0${input.scope}\0${input.proposedStrategy}`, "utf8").digest("hex").slice(0, 10).toUpperCase()}`;
  const candidate: ProjectKnowledgeCandidate = { ...input, id, status: "待验证", createdAt: timestamp, updatedAt: timestamp };
  queue.candidates.push(candidate);
  await atomicJson(queuePath(root, input.project), queue);
  return candidate;
}

export async function promoteCandidate(root: string, project: string, id: string, promotedKnowledgeRef: string, evidenceType: EvidenceType): Promise<ProjectKnowledgeCandidate> {
  assertProject(project);
  assertSafe(promotedKnowledgeRef, "经验库引用");
  if (!promotedKnowledgeRef.includes(`docs/testing/knowledge/${project}-testing-knowledge.md`)) throw new Error("经验库引用必须指向同一项目的知识文件。");
  if (!evidenceType) throw new Error("提升项目经验必须提供受控探索或正式执行证据类型。");
  const queue = await readCandidateQueue(root, project);
  const candidate = queue.candidates.find((item) => item.id === id);
  if (!candidate) throw new Error(`不存在候选：${id}`);
  if (candidate.status !== "待验证") throw new Error(`候选 ${id} 当前状态为 ${candidate.status}，不能提升。`);
  candidate.status = "已提升";
  candidate.promotedKnowledgeRef = promotedKnowledgeRef;
  candidate.updatedAt = new Date().toISOString();
  await atomicJson(queuePath(root, project), queue);
  return candidate;
}

export async function abandonCandidate(root: string, project: string, id: string, reason: string): Promise<ProjectKnowledgeCandidate> {
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
