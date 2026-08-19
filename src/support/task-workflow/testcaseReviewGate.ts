import type { WorkflowGateView } from "./workflowManager.js";

export function assertTestcaseReviewExportReady(
  view: WorkflowGateView,
  callbackSubjectDigest: string
): void {
  if (view.definitionVersion !== "v7") {
    throw new Error("Testcase review workbooks are only available for version-7 requests.");
  }
  const resolution = view.activities["case-review-resolution"];
  if (resolution?.state !== "SUCCEEDED" || resolution.outcome !== "converged") {
    throw new Error("Testcase review preparation requires a converged case-review-resolution.");
  }
  const confirmation = view.activities["case-confirmation"];
  if (!confirmation || !["READY", "WAITING_CALLBACK"].includes(confirmation.state)) {
    throw new Error("case-confirmation must be ready or waiting on the current callback.");
  }
  if (!view.checkpoint.safe) {
    throw new Error(`Testcase review preparation requires a safe checkpoint: ${view.checkpoint.reason}`);
  }
  if (
    confirmation.state === "WAITING_CALLBACK"
    && confirmation.callbackSubjectDigest !== callbackSubjectDigest
  ) {
    throw new Error("The pending case-confirmation digest is stale; resume the workflow before export.");
  }
}
