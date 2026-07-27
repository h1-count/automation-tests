describe("${MODULE}", () => {
  it("${CASE_ID}: ${TITLE}", async () => {
    // Preconditions: configure either APPIUM_APP_PATH or
    // APPIUM_APP_PACKAGE together with APPIUM_APP_ACTIVITY in .env.

    const target = await $("~${ACCESSIBILITY_ID}");
    await expect(target).toBeDisplayed();

    // Execute the confirmed business action and assert the expected result.
    // await target.click();
    // await expect($("~${EXPECTED_ACCESSIBILITY_ID}")).toBeDisplayed();
  });
});
