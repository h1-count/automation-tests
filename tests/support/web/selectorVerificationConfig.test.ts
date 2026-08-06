import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import selectorVerificationConfig from "../../../playwright.selector-verification.config.js";

const root = resolve(import.meta.dirname, "../../..");

test("selector verification is headless, zero-artifact and separate from formal execution", () => {
  assert.equal(selectorVerificationConfig.metadata?.automationMode, "explore");
  assert.equal(selectorVerificationConfig.metadata?.selectorEvidenceMode, "headless_runtime");
  assert.equal(selectorVerificationConfig.testDir, "./tests");
  assert.equal(selectorVerificationConfig.workers, 1);
  assert.equal(selectorVerificationConfig.retries, 0);
  assert.equal(selectorVerificationConfig.preserveOutput, "never");
  assert.equal(selectorVerificationConfig.outputDir, ".local/playwright-selector-verification");
  assert.equal(selectorVerificationConfig.testMatch, "**/*.selector-verify.spec.ts");
  assert.equal(selectorVerificationConfig.use?.headless, true);
  assert.equal(selectorVerificationConfig.use?.trace, "off");
  assert.equal(selectorVerificationConfig.use?.screenshot, "off");
  assert.equal(selectorVerificationConfig.use?.video, "off");
  assert.equal(selectorVerificationConfig.projects?.length, 1);
  assert.deepEqual(
    selectorVerificationConfig.projects?.[0]?.testIgnore,
    ["**/*.formal.spec.ts"]
  );
});

test("selector verification template uses the guarded fixture and trial actionability", async () => {
  const template = await readFile(
    resolve(
      root,
      "skills/iot-automation-testing/templates/playwright-selector-verification.spec.template.ts"
    ),
    "utf8"
  );
  assert.match(template, /src\/fixtures\/webAutomationFixture/);
  assert.match(template, /toHaveCount\(1\)/);
  assert.match(template, /toHaveAccessibleName/);
  assert.match(template, /click\(\{ trial: true \}\)/);
  assert.match(template, /automationGuard\.blockedAttempts/);
  assert.match(template, /reachableBoundary/);
  assert.equal(template.match(/\.click\(/g)?.length, 1);
  assert.doesNotMatch(template, /\.(?:fill|check|setInputFiles|press)\(/);
});

test("package exposes only the headless selector verification command for this stage", async () => {
  const packageJson = JSON.parse(
    await readFile(resolve(root, "package.json"), "utf8")
  ) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.["test:web:verify-selectors"],
    "tsx scripts/verify-web-selectors.ts"
  );
});

test("formal Playwright config registers the structured evidence reporter", async () => {
  const configSource = await readFile(resolve(root, "playwright.config.ts"), "utf8");
  assert.match(configSource, /playwrightEvidenceReporter\.ts/);
  assert.match(configSource, /PLAYWRIGHT_HAS_SENSITIVE_CASES/);
  assert.match(configSource, /trace: containsSensitiveEvidenceCase \? "off" : "on-first-retry"/);
  assert.match(configSource, /retries: containsSensitiveEvidenceCase \? 0/);
});
