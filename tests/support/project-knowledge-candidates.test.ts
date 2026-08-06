import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { addCandidate, promoteCandidate, readCandidateQueue } from "../../src/support/project-knowledge/candidateStore.ts";

test("经验立即入库、同范围覆盖、验证提升并拒绝敏感信息", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "knowledge-candidates-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const input = { project: "demo", scope: "登录页", observation: "ARIA 名称稳定", proposedStrategy: "优先 getByRole", evidenceRefs: ["artifacts/trace.zip"], validationCondition: "受控探索再次确认" };
  const candidate = await addCandidate(root, input);
  assert.equal((await addCandidate(root, input)).id, candidate.id);
  const knowledgePath = resolve(root, "docs/testing/knowledge/demo-testing-knowledge.md");
  assert.match(await readFile(knowledgePath, "utf8"), /证据状态：待验证/);
  const promoted = await promoteCandidate(root, "demo", candidate.id, "docs/testing/knowledge/demo-testing-knowledge.md#登录页", "受控探索");
  assert.equal(promoted.status, "已提升");
  assert.match((await readCandidateQueue(root, "demo")).candidates[0]?.promotedKnowledgeRef ?? "", /^docs\/testing\/knowledge\/demo-testing-knowledge\.md#exp-/);
  assert.match(await readFile(knowledgePath, "utf8"), /证据状态：受控探索已验证/);

  const revised = await addCandidate(root, { ...input, observation: "ARIA 名称已变更", proposedStrategy: "优先使用最新语义定位" });
  assert.notEqual(revised.id, candidate.id);
  const revisedKnowledge = await readFile(knowledgePath, "utf8");
  assert.match(revisedKnowledge, /当前优先策略：优先使用最新语义定位/);
  assert.doesNotMatch(revisedKnowledge, /当前优先策略：优先 getByRole/);
  assert.equal((revisedKnowledge.match(/<!-- project-experience:[A-F0-9]+:start -->/g) ?? []).length, 1);
  await assert.rejects(() => addCandidate(root, { ...input, observation: "token=secret" }), /敏感/);
  const otpPolicy = await addCandidate(root, {
    ...input,
    scope: "验证码页面接管",
    observation: "验证码只在页面内由用户输入",
    proposedStrategy: "使用有界可见会话等待，不保存原始值"
  });
  assert.equal(otpPolicy.status, "待验证");
  await assert.rejects(
    () => addCandidate(root, { ...input, observation: "验证码=123456" }),
    /敏感/
  );
  await assert.rejects(() => promoteCandidate(root, "demo", candidate.id, "docs/testing/knowledge/other-testing-knowledge.md", "正式执行"), /同一项目/);
});
