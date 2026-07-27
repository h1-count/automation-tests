import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const agents = read("AGENTS.md");
const automation = read("docs/testing/automation-guideline.md");
const testcase = read("docs/testing/testcase-guideline.md");
const selector = read("docs/testing/selector-guideline.md");
const skill = read("skills/iot-automation-testing/SKILL.md");
const template = read("skills/iot-automation-testing/templates/test-plan.template.md");
const playwrightTemplate = read("skills/iot-automation-testing/templates/playwright.spec.template.ts");
const scriptsReadme = read("scripts/README.md");
const docsIndex = read("docs/testing/README.md");
const hook = read("scripts/codex-stop-stage-envelope.mjs");
const hookConfig = read(".codex/hooks.json");
const taskTypes = read("src/support/task-state/types.ts");
const gate = read("src/support/task-state/gate.ts");
const environment = read("docs/testing/environment-guideline.md");
const report = read("docs/testing/report-guideline.md");
const automationMode = read("src/support/web/automationMode.ts");
const testDataTypes = read("src/support/test-data/types.ts");
const taskManager = read("src/support/task-state/testTaskStateManager.ts");
const playwrightConfig = read("playwright.config.ts");
const playwrightDebugConfig = read("playwright.debug.config.ts");

test("workflow lifecycle has one normative owner", () => {
  assert.match(automation, /owns: automation\.lifecycle/);
  assert.match(automation, /\| `active` \|[\s\S]*\| `cancelled` \|/);
  assert.doesNotMatch(testcase, /\| `active` \|/);
  assert.doesNotMatch(skill, /只有 `waiting_confirmation`/);
  assert.doesNotMatch(template, /stage-run-envelope-v1|终止回复资格|wake 契约/);
});

test("global and skill entrypoints use the executable final gate", () => {
  assert.match(agents, /task:gate[\s\S]*--assert-final/);
  assert.match(skill, /task:gate --assert-final/);
  assert.match(gate, /executionEnvelope/);
  assert.match(gate, /process\.exitCode = 2/);
});

test("runtime owns the six states and host continuation contract", () => {
  for (const state of ["active", "internal_wait", "waiting_confirmation", "blocked", "completed", "cancelled"]) {
    assert.match(taskTypes, new RegExp(`"${state}"`));
  }
  assert.match(taskTypes, /ExecutionEnvelope/);
  assert.match(taskTypes, /HostContinuationBinding/);
});

test("Codex Stop hook delegates to the gate instead of duplicating lifecycle rules", () => {
  assert.match(hookConfig, /"Stop"/);
  assert.match(hook, /gate\.ts/);
  assert.match(hook, /--assert-final/);
  assert.match(hook, /decision: "block"/);
  assert.doesNotMatch(hook, /continue: false/);
  assert.match(hook, /session_id/);
  assert.doesNotMatch(hook, /waiting_confirmation|internal_wait|cancelled/);
});

test("the skill uses a deduplicated thread heartbeat prompt", () => {
  assert.match(skill, /thread-heartbeat\.prompt\.md/);
  assert.match(skill, /host-bind/);
  const prompt = read("skills/iot-automation-testing/templates/thread-heartbeat.prompt.md");
  assert.match(prompt, /<request-id>/);
  assert.match(prompt, /task:gate/);
  assert.doesNotMatch(prompt, /REQ-|RULE-|caseId/);
});

test("environment guideline exclusively owns explore, execute, and data lifecycle semantics", () => {
  assert.match(environment, /业务写入预算[\s\S]*`explore`/);
  assert.match(environment, /`execute`[\s\S]*唯一可见 BrowserServer[\s\S]*PageSessionGroup/);
  assert.match(environment, /CreateIntent[\s\S]*creation_unknown → reconciled/);
  assert.match(automationMode, /AutomationMode = "explore" \| "execute"/);
  assert.match(testDataTypes, /DataWritePolicy = "no_write" \| "managed_cleanup" \| "tracked_residual"/);
  assert.doesNotMatch(automation, /type DataWritePolicy/);
  assert.doesNotMatch(testcase, /planned → creating/);
  assert.doesNotMatch(skill, /planned → creating/);
});

test("formal execution is bound to an immutable authorization and project lifecycle", () => {
  assert.match(taskTypes, /ExecutionAuthorizationSnapshot/);
  assert.match(taskTypes, /test-task-state-v10/);
  assert.match(taskManager, /createExecutionAuthorization/);
  assert.match(taskManager, /reopenExecutionScope/);
  assert.match(playwrightConfig, /formal-setup[\s\S]*dependencies: \["formal-setup"\][\s\S]*formal-teardown/);
  assert.match(playwrightConfig, /"\*\*\/\*\.formal\.spec\.ts"/);
  assert.match(playwrightConfig, /maxFailures: 0/);
  assert.match(playwrightDebugConfig, /testIgnore: \[[^\]]*"\*\*\/\*\.formal\.spec\.ts"/);
});

test("reports preserve separate functional and data hygiene conclusions", () => {
  assert.match(environment, /功能结论与数据卫生结论[\s\S]*报告规范/);
  assert.match(report, /functionalStatus/);
  assert.match(report, /dataHygieneStatus/);
});

test("mature Web automation rules have one owner per concern", () => {
  const ownerDocuments = [automation, environment, testcase, selector, report];
  for (const marker of [
    "owns: automation.lifecycle",
    "owns: automation.environment",
    "owns: automation.testcases",
    "owns: automation.selectors",
    "owns: automation.reporting"
  ]) {
    const count = ownerDocuments.reduce((total, document) => total + document.split(marker).length - 1, 0);
    assert.equal(count, 1, `${marker} must have exactly one normative owner`);
  }
  assert.match(docsIndex, /Inspector\/ARIA 探索/);
  assert.match(docsIndex, /PageSessionGroup/);
  assert.match(docsIndex, /CaseEvidenceBundle/);
});

test("visible Inspector and ARIA exploration gates formal Web script generation", () => {
  assert.match(automation, /新建或重新打开执行范围的 Web\/H5 请求/);
  assert.match(automation, /正式脚本阶段保持关闭/);
  assert.match(selector, /专用 Chrome 与 Playwright Inspector/);
  assert.match(selector, /DOM、ARIA 无障碍树/);
  assert.match(selector, /候选 locator、匹配数量/);
  assert.match(selector, /未解决问题和零写入结论/);
  assert.match(skill, /test:web:inspect/);
  assert.match(skill, /test:web:explore:reuse:inspect/);
  assert.match(skill, /test:web:explore` 只用于该门禁后的确定性重放/);
  assert.match(scriptsReadme, /test:web:inspect/);
  assert.match(scriptsReadme, /test:web:explore:reuse:inspect/);
});

test("PageSessionGroup reuses one BrowserServer and isolates only stateful scenarios", () => {
  for (const field of [
    "sessionGroupId",
    "targetRoute",
    "caseIds",
    "resetStrategy",
    "isolationReason",
    "executionOrder"
  ]) {
    assert.match(environment, new RegExp(field));
    assert.match(template, new RegExp(field));
  }
  assert.match(environment, /异常 → 边界 → 正常/);
  assert.match(environment, /重建 Context\/Page/);
  assert.match(environment, /不得重启 Chrome/);
  assert.match(environment, /远端写入、认证或验证码[\s\S]*新的 Context\/Page[\s\S]*同一个 BrowserServer/);
  assert.match(testcase, /每个正式 `caseId` 恰好映射一个[\s\S]*PageSessionGroup/);
  assert.match(testcase, /单 case 场景组/);
  assert.match(template, /结构版本：page-session-group-v1/);
  assert.match(template, /#### 页面场景组映射/);
  for (const document of [automation, testcase, selector, report, skill, scriptsReadme]) {
    assert.doesNotMatch(document, /sessionGroupId|targetRoute|resetStrategy|isolationReason|executionOrder/);
  }
});

test("formal coverage remains atomic and cannot silently omit an applicable case", () => {
  assert.match(testcase, /正式执行清单和正式脚本中恰好出现一次/);
  assert.match(testcase, /不得成为静默省略依据/);
  assert.match(testcase, /每个 case 必须独立建立前置、复位和断言边界/);
  assert.match(playwrightTemplate, /formalCase\(/);
});

test("CaseEvidenceBundle controls passed, failed, unknown, and redacted evidence", () => {
  for (const field of [
    "caseId",
    "startedAt / endedAt",
    "businessSteps",
    "assertionResults",
    "checkpointScreenshots",
    "videoReference",
    "traceReference",
    "sanitizedNetworkSummary",
    "sanitizedConsoleSummary",
    "redactionStatus"
  ]) {
    assert.match(report, new RegExp(field.replace("/", "\\/")));
  }
  assert.match(report, /`passed` \| 所有已定义断言通过，证据包完整且脱敏状态有效/);
  assert.match(report, /failed`、`blocked`、`unknown`[\s\S]*非敏感采集区间的完整 Trace/);
  assert.match(report, /证据不足时状态只能为 `unknown`/);
  assert.match(report, /安全替代证据/);
  assert.match(template, /结构版本：case-evidence-policy-v1/);
  assert.match(template, /#### 证据策略映射/);
  assert.match(playwrightTemplate, /test\.step/);
  assert.match(playwrightTemplate, /testInfo\.attach/);
  for (const document of [automation, environment, testcase, selector, skill, scriptsReadme, template]) {
    assert.doesNotMatch(document, /checkpointScreenshots|sanitizedConsoleSummary|redactionStatus/);
  }
});

test("mature Web rules are opt-in for new or reopened execution scope", () => {
  assert.match(automation, /成熟化规则不迁移或改写生效前已有的计划、用例、脚本、运行记录与本机台账/);
  assert.match(template, /结构版本：web-script-governance-v1/);
});
