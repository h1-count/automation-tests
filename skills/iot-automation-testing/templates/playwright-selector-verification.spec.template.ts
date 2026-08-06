import {
  expect,
  test
} from "../../../../src/fixtures/webAutomationFixture.js";

test("${CASE_ID} verifies a source-derived selector without business mutation", async ({
  page,
  automationGuard
}) => {
  await page.goto("${PAGE_PATH}");

  // Scope the target to its business container. Replace with getByLabel or
  // getByTestId when that is the source-backed contract.
  const scope = page.getByTestId("${SCOPE_TEST_ID}");
  const target = scope.getByRole("${TARGET_ROLE}" as "button", {
    name: "${ACCESSIBLE_NAME}",
    exact: true
  });
  const matchCount = await target.count();

  await expect(target).toHaveCount(1);
  await expect(target).toBeVisible();
  await expect(target).toHaveAccessibleName("${ACCESSIBLE_NAME}");
  // Trial mode checks actionability without dispatching the business action.
  await target.click({ trial: true });
  // Add a source-backed ARIA state assertion when the contract includes one.
  // await expect(target).toHaveAttribute("aria-expanded", "false");

  expect(automationGuard.blockedAttempts).toEqual([]);
  console.info(`[selector-verification] ${JSON.stringify({
    caseId: "${CASE_ID}",
    route: "${PAGE_PATH}",
    selectorType: "role_name",
    matchCount,
    result: "runtime_verified",
    reachableBoundary: "${REACHABLE_BOUNDARY}"
  })}`);
});
