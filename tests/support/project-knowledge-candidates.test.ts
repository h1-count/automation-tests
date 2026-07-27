import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { addCandidate, promoteCandidate, readCandidateQueue } from "../../src/support/project-knowledge/candidateStore.ts";

test("候选去重、验证提升并拒绝敏感信息和跨项目引用", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "knowledge-candidates-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const input = { project: "demo", scope: "登录页", observation: "ARIA 名称稳定", proposedStrategy: "优先 getByRole", evidenceRefs: ["artifacts/trace.zip"], validationCondition: "受控探索再次确认" };
  const candidate = await addCandidate(root, input);
  assert.equal((await addCandidate(root, input)).id, candidate.id);
  const promoted = await promoteCandidate(root, "demo", candidate.id, "docs/testing/knowledge/demo-testing-knowledge.md#登录页", "受控探索");
  assert.equal(promoted.status, "已提升");
  assert.equal((await readCandidateQueue(root, "demo")).candidates[0]?.promotedKnowledgeRef, "docs/testing/knowledge/demo-testing-knowledge.md#登录页");
  await assert.rejects(() => addCandidate(root, { ...input, observation: "token=secret" }), /敏感/);
  await assert.rejects(() => promoteCandidate(root, "demo", candidate.id, "docs/testing/knowledge/other-testing-knowledge.md", "正式执行"), /同一项目/);
});
