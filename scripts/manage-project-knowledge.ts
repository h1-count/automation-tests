import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { abandonCandidate, addCandidate, promoteCandidate, readCandidateQueue, type EvidenceType } from "../src/support/project-knowledge/candidateStore.js";

const sensitive = /(password|passwd|token|secret|cookie|session|authorization|credential|api[_-]?key|验证码|身份证|银行卡)/i;
function required(args: string[], name: string): string { const value = args[args.indexOf(name) + 1]; if (!value) throw new Error(`缺少 ${name}。`); return value; }
async function appendVerifiedExperience(project: string, scope: string, observation: string, judgment: string, strategy: string, evidence: string, evidenceType: EvidenceType): Promise<string> {
  [scope, observation, judgment, strategy, evidence].forEach((value) => { if (!value.trim() || sensitive.test(value)) throw new Error("项目经验字段为空或包含敏感信息。"); });
  const path = resolve(process.cwd(), "docs/testing/knowledge", `${project}-testing-knowledge.md`);
  await mkdir(resolve(path, ".."), { recursive: true });
  let content: string; try { content = await readFile(path, "utf8"); } catch { content = `# ${project} 项目测试经验\n\n`; }
  const entry = `## ${new Date().toISOString().slice(0, 10)}：${scope}\n\n- 适用范围：${scope}\n- 观察：${observation}\n- 判断：${judgment}\n- 下次优先策略：${strategy}\n- 验证证据：${evidenceType}；${evidence}\n`;
  await writeFile(path, `${content.trimEnd()}\n\n${entry}`, "utf8");
  return `docs/testing/knowledge/${project}-testing-knowledge.md`;
}
async function main(): Promise<void> {
  const args = process.argv.slice(2); const command = args[0]; const project = required(args, "--project");
  if (command === "candidate-add") { const candidate = await addCandidate(process.cwd(), { project, scope: required(args, "--scope"), observation: required(args, "--observation"), proposedStrategy: required(args, "--strategy"), evidenceRefs: [required(args, "--evidence")], validationCondition: required(args, "--validation") }); process.stdout.write(`${candidate.id}\n`); return; }
  if (command === "experience-add" || command === "candidate-promote") { const evidenceType = required(args, "--evidence-type") as EvidenceType; if (!( ["受控探索", "正式执行"] as string[]).includes(evidenceType)) throw new Error("--evidence-type 只能为“受控探索”或“正式执行”。"); const reference = await appendVerifiedExperience(project, required(args, "--scope"), required(args, "--observation"), required(args, "--judgment"), required(args, "--strategy"), required(args, "--evidence"), evidenceType); if (command === "candidate-promote") await promoteCandidate(process.cwd(), project, required(args, "--id"), reference, evidenceType); process.stdout.write(`${reference}\n`); return; }
  if (command === "candidate-abandon") { await abandonCandidate(process.cwd(), project, required(args, "--id"), required(args, "--reason")); process.stdout.write("已放弃候选。\n"); return; }
  if (command === "candidate-reconcile") { const queue = await readCandidateQueue(process.cwd(), project); process.stdout.write(JSON.stringify(queue.candidates.map((item) => ({ id: item.id, status: item.status, promotedKnowledgeRef: item.promotedKnowledgeRef })), null, 2) + "\n"); return; }
  throw new Error("Usage: manage-project-knowledge.ts <candidate-add|candidate-promote|candidate-abandon|candidate-reconcile|experience-add> --project <project> ...");
}
main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
