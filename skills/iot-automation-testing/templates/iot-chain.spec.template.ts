import { expect, test } from "@playwright/test";

test.describe("${MODULE}", () => {
  test("${CASE_ID}: ${TITLE}", async ({ page }) => {
    // 1. Prepare a confirmed test device and test data.
    // 2. Publish the confirmed MQTT payload through src/clients/.
    // 3. Poll the API or data store until the confirmed condition is met.
    // 4. Assert the Web/App result with a stable selector.

    // await publishTelemetry({ topic: "${MQTT_TOPIC}", payload: ${PAYLOAD} });
    // await waitForCondition("${WAIT_CONDITION}", ${TIMEOUT_MS});
    // await page.goto("${PAGE_PATH}");
    // await expect(page.getByTestId("${EXPECTED_TEST_ID}")).toBeVisible();
  });
});
