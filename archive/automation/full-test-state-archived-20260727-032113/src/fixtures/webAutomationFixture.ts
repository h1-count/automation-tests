import { expect, test as base } from "@playwright/test";
import {
  installExploreMutationGuard,
  resolveAutomationMode,
  type BlockedMutationAttempt
} from "../support/web/automationMode.js";

type AutomationFixtures = {
  automationGuard: {
    mode: "explore" | "execute";
    blockedAttempts: BlockedMutationAttempt[];
  };
};

export const test = base.extend<AutomationFixtures>({
  automationGuard: [async ({ context }, use, testInfo) => {
    const mode = resolveAutomationMode(testInfo.project.metadata.automationMode);
    const blockedAttempts: BlockedMutationAttempt[] = [];
    if (mode === "explore") {
      await installExploreMutationGuard(context, {
        onBlocked: (attempt) => {
          blockedAttempts.push(attempt);
          console.info(`[探索零写入] 已阻止 ${attempt.method} ${attempt.url}`);
        }
      });
    }
    await use({ mode, blockedAttempts });
  }, { auto: true }]
});

export { expect };
