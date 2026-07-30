import { expect, test } from "../../../src/fixtures/formalWebFixture.js";
import { loadConfirmedExecutionAuthorization } from "../../../src/support/formal-execution/authorization.js";
import { finalizeFormalExecution } from "../../../src/support/formal-execution/finalize.js";

test("正式执行 teardown：核验清单并生成原子结果摘要", async () => {
  const requestId = process.env.AUTOMATION_REQUEST_ID?.trim();
  expect(requestId).toBeTruthy();
  const snapshot = await loadConfirmedExecutionAuthorization(requestId!);
  expect(snapshot.status).toBe("confirmed");
  const summary = await finalizeFormalExecution(requestId!);
  expect(summary.cases).toHaveLength(snapshot.caseIds.length);
  expect(summary.complete, "Every authorized caseId must have one formal result.").toBe(true);
});
