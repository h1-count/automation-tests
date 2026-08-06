import {
  configureFormalSuite,
  expect,
  formalCase,
  formalSuite as test
} from "../../../../src/support/formal-execution/formalCase.js";
import { formalExecutionManifest } from "./execution.manifest.js";

configureFormalSuite(formalExecutionManifest);

formalCase("${CASE_ID}", "${TITLE}", async ({ page }, runtime) => {
  await test.step("建立页面基线", async () => {
    // Navigate with the configured baseURL; do not hardcode an environment URL.
    await page.goto("${PAGE_PATH}");
    await expect(page.getByTestId("${TARGET_TEST_ID}")).toBeVisible();
  });

  await test.step("执行已确认的业务操作", async () => {
    // Keep the complete source-derived candidate here, including steps after a
    // runtime_validation_pending boundary. Runtime providers are acquired with
    // runtime.useCapability(); do not replace the body with a fixed blocker.
    await page.getByTestId("${TARGET_TEST_ID}").click();
  });

  await test.step("验证结果并登记结构化断言", async () => {
    // Assert one case only. Add soft assertions here when this case has multiple boundaries.
    await expect(page.getByTestId("${EXPECTED_TEST_ID}")).toBeVisible();
    runtime.addAssertion("${EXPECTED_ASSERTION}");
    // Do not capture a passing screenshot by default. Playwright and the
    // formal evidence reporter retain failure/retry attachments when safe.
  });
});
