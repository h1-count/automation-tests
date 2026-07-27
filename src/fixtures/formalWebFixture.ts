import type { BrowserContext, Page } from "@playwright/test";
import { expect, test as base } from "@playwright/test";

const formalBrowserEndpoint = process.env.PLAYWRIGHT_FORMAL_BROWSER_WS_ENDPOINT?.trim();

type FormalWorkerFixtures = {
  formalContext: BrowserContext;
  formalPage: Page;
};

export const test = base.extend<{}, FormalWorkerFixtures>({
  browser: [async ({ playwright }, use) => {
    if (!formalBrowserEndpoint) {
      throw new Error("Formal execution requires the Runner-owned Playwright browser endpoint.");
    }
    const browser = await playwright.chromium.connect(formalBrowserEndpoint);
    try {
      await use(browser);
    } finally {
      // A connected Browser closes its own contexts and disconnects without
      // terminating the BrowserServer process owned by the formal Runner.
      await browser.close();
    }
  }, { scope: "worker" }],
  formalContext: [async ({ browser }, use) => {
    const context = await browser.newContext();
    try {
      await use(context);
    } finally {
      await context.close();
    }
  }, { scope: "worker" }],
  formalPage: [async ({ formalContext }, use) => {
    const page = await formalContext.newPage();
    try {
      await use(page);
    } finally {
      await page.close();
    }
  }, { scope: "worker" }],
  context: async ({ formalContext }, use) => {
    await use(formalContext);
  },
  page: async ({ formalPage }, use) => {
    await use(formalPage);
  }
});

export { expect };
