import {
  configureFormalSuite,
  expect,
  formalCase,
  formalSuite as test
} from "../../../../src/support/formal-execution/formalCase.js";
import { formalExecutionManifest } from "./execution.manifest.js";

configureFormalSuite(formalExecutionManifest);

formalCase("${CASE_ID}", "${TITLE}", async ({ page }, _runtime, testInfo) => {
  await test.step("建立页面基线", async () => {
    // Navigate with the configured baseURL; do not hardcode an environment URL.
    await page.goto("${PAGE_PATH}");
    await expect(page.getByTestId("${TARGET_TEST_ID}")).toBeVisible();
  });

  await test.step("执行已确认的业务操作", async () => {
    // Use the selector and operation confirmed by the visible Inspector exploration.
    // await page.getByTestId("${TARGET_TEST_ID}").click();
  });

  await test.step("验证结果并登记安全证据", async () => {
    // Assert one case only. Add soft assertions here when this case has multiple boundaries.
    // await expect(page.getByTestId("${EXPECTED_TEST_ID}")).toBeVisible();

    // Attach only a checkpoint that the environment policy marks safe to capture.
    await testInfo.attach("${CASE_ID}-checkpoint", {
      body: await page.screenshot(),
      contentType: "image/png"
    });
  });
});
