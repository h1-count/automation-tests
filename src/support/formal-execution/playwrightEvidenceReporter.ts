import { existsSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import type {
  Reporter,
  TestCase,
  TestResult
} from "@playwright/test/reporter";
import { sanitizeFormalArtifact } from "./artifactRedaction.js";
import { FormalExecutionStore } from "./formalExecutionStore.js";

export default class PlaywrightEvidenceReporter implements Reporter {
  async onTestEnd(test: TestCase, result: TestResult): Promise<void> {
    const authorizationDigest = process.env.PLAYWRIGHT_AUTHORIZATION_DIGEST?.trim();
    const caseId = test.title.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)：/)?.[1];
    if (!authorizationDigest || !caseId) return;
    const references: string[] = [];
    for (const attachment of result.attachments) {
      if (!attachment.path || !existsSync(attachment.path)) continue;
      const absolute = resolve(attachment.path);
      const relativePath = relative(process.cwd(), absolute);
      if (
        !relativePath.startsWith(`artifacts${sep}`)
        || relativePath.includes(`..${sep}`)
        || !(await sanitizeFormalArtifact(absolute))
      ) {
        continue;
      }
      references.push(relativePath.split(sep).join("/"));
    }
    if (references.length > 0) {
      await new FormalExecutionStore().appendEvidenceRefs(
        authorizationDigest,
        caseId,
        references
      );
    }
  }
}
