import {
  abandonCandidate,
  addCandidate,
  promoteCandidate,
  readCandidateQueue,
  type EvidenceType
} from "../src/support/project-knowledge/candidateStore.js";
import { upsertProjectExperience } from "../src/support/project-knowledge/projectExperienceStore.js";

function required(args: string[], name: string): string {
  const value = args[args.indexOf(name) + 1];
  if (!value) throw new Error(`缺少 ${name}。`);
  return value;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const project = required(args, "--project");

  if (command === "candidate-add") {
    const candidate = await addCandidate(process.cwd(), {
      project,
      scope: required(args, "--scope"),
      observation: required(args, "--observation"),
      judgment: required(args, "--judgment"),
      proposedStrategy: required(args, "--strategy"),
      evidenceRefs: [required(args, "--evidence")],
      validationCondition: required(args, "--validation")
    });
    process.stdout.write(`${candidate.id}\n`);
    return;
  }

  if (command === "experience-add" || command === "candidate-promote") {
    const evidenceType = required(args, "--evidence-type") as EvidenceType;
    if (!( ["受控探索", "正式执行"] as string[]).includes(evidenceType)) {
      throw new Error("--evidence-type 只能为“受控探索”或“正式执行”。");
    }
    if (command === "candidate-promote") {
      const promoted = await promoteCandidate(
        process.cwd(),
        project,
        required(args, "--id"),
        project === "automation-engineering"
          ? "docs/testing/knowledge/MEMORY.md"
          : `docs/testing/knowledge/${project}-testing-knowledge.md`,
        evidenceType
      );
      process.stdout.write(`${promoted.promotedKnowledgeRef}\n`);
      return;
    }
    const reference = await upsertProjectExperience(process.cwd(), {
      project,
      scope: required(args, "--scope"),
      observation: required(args, "--observation"),
      judgment: required(args, "--judgment"),
      strategy: required(args, "--strategy"),
      evidenceRefs: [required(args, "--evidence")],
      validationCondition: "已通过当前证据验证；后续发现同范围冲突时以最新可审查记录更新",
      evidenceStatus: evidenceType === "受控探索" ? "受控探索已验证" : "正式执行已验证"
    });
    process.stdout.write(`${reference}\n`);
    return;
  }

  if (command === "candidate-abandon") {
    await abandonCandidate(process.cwd(), project, required(args, "--id"), required(args, "--reason"));
    process.stdout.write("已放弃候选。\n");
    return;
  }

  if (command === "candidate-reconcile") {
    const queue = await readCandidateQueue(process.cwd(), project);
    process.stdout.write(`${JSON.stringify(queue.candidates.map((item) => ({
      id: item.id,
      status: item.status,
      knowledgeRef: item.knowledgeRef,
      promotedKnowledgeRef: item.promotedKnowledgeRef
    })), null, 2)}\n`);
    return;
  }

  throw new Error(
    "Usage: manage-project-knowledge.ts <candidate-add|candidate-promote|candidate-abandon|candidate-reconcile|experience-add> --project <project> ..."
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
