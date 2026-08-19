import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { addCandidate, promoteCandidate, readCandidateQueue } from "../../src/support/project-knowledge/candidateStore.ts";

test("经验立即入库、同范围覆盖、验证提升并拒绝敏感信息", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "knowledge-candidates-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const input = {
    project: "demo",
    scope: "登录页",
    observation: "ARIA 名称稳定",
    judgment: "语义名称稳定时应优先使用角色定位",
    proposedStrategy: "优先 getByRole",
    evidenceRefs: ["artifacts/trace.zip"],
    validationCondition: "受控探索再次确认"
  };
  const candidate = await addCandidate(root, input);
  assert.match(candidate.knowledgeRef ?? "", /^docs\/testing\/knowledge\/demo-testing-knowledge\.md#exp-/);
  assert.equal((await addCandidate(root, input)).id, candidate.id);
  const knowledgePath = resolve(root, "docs/testing/knowledge/demo-testing-knowledge.md");
  assert.match(await readFile(knowledgePath, "utf8"), /证据状态：待验证/);
  const promoted = await promoteCandidate(root, "demo", candidate.id, "docs/testing/knowledge/demo-testing-knowledge.md#登录页", "受控探索");
  assert.equal(promoted.status, "已提升");
  assert.match((await readCandidateQueue(root, "demo")).candidates[0]?.promotedKnowledgeRef ?? "", /^docs\/testing\/knowledge\/demo-testing-knowledge\.md#exp-/);
  assert.match(await readFile(knowledgePath, "utf8"), /证据状态：受控探索已验证/);

  const revised = await addCandidate(root, {
    ...input,
    observation: "ARIA 名称已变更",
    judgment: "旧语义定位已经失效",
    proposedStrategy: "优先使用最新语义定位"
  });
  assert.notEqual(revised.id, candidate.id);
  const revisedKnowledge = await readFile(knowledgePath, "utf8");
  assert.match(revisedKnowledge, /当前优先策略：优先使用最新语义定位/);
  assert.doesNotMatch(revisedKnowledge, /当前优先策略：优先 getByRole/);
  assert.equal((revisedKnowledge.match(/<!-- project-experience:[A-F0-9]+:start -->/g) ?? []).length, 1);

  const restored = await addCandidate(root, {
    ...input,
    observation: "ARIA 名称恢复且已有新证据",
    judgment: "最新证据重新支持角色定位",
    evidenceRefs: ["artifacts/new-trace.zip"]
  });
  assert.equal(restored.id, candidate.id);
  assert.equal(restored.status, "待验证");
  assert.match(restored.knowledgeRef ?? "", /^docs\/testing\/knowledge\/demo-testing-knowledge\.md#exp-/);
  assert.equal(restored.promotedKnowledgeRef, undefined);
  const restoredQueue = await readCandidateQueue(root, "demo");
  assert.equal(restoredQueue.candidates.find((item) => item.id === revised.id)?.status, "已放弃");
  const restoredKnowledge = await readFile(knowledgePath, "utf8");
  assert.match(restoredKnowledge, /观察：ARIA 名称恢复且已有新证据/);
  assert.match(restoredKnowledge, /判断：最新证据重新支持角色定位/);
  assert.match(restoredKnowledge, /当前优先策略：优先 getByRole/);
  assert.doesNotMatch(restoredKnowledge, /当前优先策略：优先使用最新语义定位/);
  assert.equal((restoredKnowledge.match(/<!-- project-experience:[A-F0-9]+:start -->/g) ?? []).length, 1);
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

test("当前项目经验文件保持单一锚点和固定决策记录字段", async () => {
  const knowledgePath = resolve(
    process.cwd(),
    "docs/testing/knowledge/open-platform-testing-knowledge.md"
  );
  const content = await readFile(knowledgePath, "utf8");
  const blocks = [...content.matchAll(
    /<!-- project-experience:([A-F0-9]{12}):start -->\n([\s\S]*?)<!-- project-experience:\1:end -->/gu
  )];
  assert.ok(blocks.length > 0);

  const scopes = new Set<string>();
  for (const [, id, body] of blocks) {
    assert.ok(id && body);
    const titleScope = body.match(/^## \d{4}-\d{2}-\d{2}：(.+)$/mu)?.[1];
    const fieldScope = body.match(/^- 适用范围：(.+)$/mu)?.[1];
    assert.equal(titleScope, fieldScope);
    assert.ok(fieldScope && !scopes.has(fieldScope), `重复适用范围：${fieldScope}`);
    scopes.add(fieldScope!);
    assert.match(body, new RegExp(`<a id="exp-${id.toLowerCase()}"></a>`, "u"));
    assert.match(body, new RegExp(`^- 经验编号：EXP-${id}$`, "mu"));
    assert.match(body, /^- 证据状态：(待验证|受控探索已验证|正式执行已验证)$/mu);
    assert.match(body, /^- 观察：.+$/mu);
    assert.match(body, /^- 判断：.+$/mu);
    assert.match(body, /^- 当前优先策略：.+$/mu);
    assert.match(body, /^- 证据引用：.+$/mu);
    assert.match(body, /^- 验证条件：.+$/mu);
    assert.match(body, /^- 最近更新：\d{4}-\d{2}-\d{2}T.+Z$/mu);
  }
});
