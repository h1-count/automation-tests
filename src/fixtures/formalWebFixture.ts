import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, test as base } from "@playwright/test";
import {
  formalCaseIdFromTestTitle,
  formalPageSessionGroupForCase
} from "../support/formal-execution/pageSessionGroups.js";
import type { FormalPageSessionGroupDefinition } from "../support/formal-execution/types.js";

const formalBrowserEndpoint = process.env.PLAYWRIGHT_FORMAL_BROWSER_WS_ENDPOINT?.trim();

type FormalTestFixtures = {
  formalSession: FormalBrowserSession;
  formalContext: BrowserContext;
  formalPage: Page;
};

type FormalWorkerFixtures = {
  formalSessionPool: FormalSessionPool;
};

interface FormalBrowserSession {
  context: BrowserContext;
  page: Page;
}

interface SharedFormalBrowserSession extends FormalBrowserSession {
  lastExecutionIndex?: number;
}

interface FormalSessionPool {
  acquire(
    group: FormalPageSessionGroupDefinition,
    caseId: string,
    baseURL: string | undefined
  ): Promise<FormalBrowserSession>;
}

export const test = base.extend<FormalTestFixtures, FormalWorkerFixtures>({
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
  formalSessionPool: [async ({ browser }, use) => {
    const sessions = new Map<string, SharedFormalBrowserSession>();
    await use({
      acquire: async (group, caseId, baseURL) => {
        let session = sessions.get(group.sessionGroupId);
        if (!session || session.page.isClosed()) {
          await closeSession(session);
          session = await createSession(browser, baseURL);
          sessions.set(group.sessionGroupId, session);
        }
        const executionIndex = group.executionOrder.indexOf(caseId);
        if (executionIndex < 0) {
          throw new Error(`${caseId} is missing from ${group.sessionGroupId} executionOrder.`);
        }
        if (session.lastExecutionIndex !== undefined && executionIndex <= session.lastExecutionIndex) {
          throw new Error(`${group.sessionGroupId} received non-monotonic case order at ${caseId}.`);
        }
        session.lastExecutionIndex = executionIndex;
        if (
          group.resetStrategy === "reload_route"
          || !pageMatchesRoute(session.page, group.targetRoute)
        ) {
          await session.page.goto(group.targetRoute);
        }
        return session;
      }
    });
    await Promise.all([...sessions.values()].map(closeSession));
  }, { scope: "worker" }],
  formalSession: async ({ browser, formalSessionPool, baseURL }, use, testInfo) => {
    const requestId = process.env.AUTOMATION_REQUEST_ID?.trim();
    const caseId = formalCaseIdFromTestTitle(testInfo.title);
    const group = requestId
      ? formalPageSessionGroupForCase(requestId, caseId)
      : undefined;
    if (group && group.resetStrategy !== "new_context_per_case") {
      await use(await formalSessionPool.acquire(group, caseId, baseURL));
      return;
    }
    const session = await createSession(browser, baseURL);
    try {
      await use(session);
    } finally {
      await closeSession(session);
    }
  },
  formalContext: async ({ formalSession }, use) => use(formalSession.context),
  formalPage: async ({ formalSession }, use) => use(formalSession.page),
  context: async ({ formalContext }, use) => {
    await use(formalContext);
  },
  page: async ({ formalPage }, use) => {
    await use(formalPage);
  }
});

export { expect };

async function createSession(
  browser: Browser,
  baseURL: string | undefined
): Promise<SharedFormalBrowserSession> {
  const context = await browser.newContext(baseURL ? { baseURL } : undefined);
  return {
    context,
    page: await context.newPage()
  };
}

async function closeSession(session: FormalBrowserSession | undefined): Promise<void> {
  if (!session) return;
  try {
    await session.context.close();
  } catch (error) {
    if (!session.page.isClosed()) throw error;
  }
}

function pageMatchesRoute(page: Page, targetRoute: string): boolean {
  if (page.isClosed()) return false;
  try {
    const current = new URL(page.url());
    const target = new URL(targetRoute, current.origin);
    return current.pathname === target.pathname && current.search === target.search;
  } catch {
    return false;
  }
}
