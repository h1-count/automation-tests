import type { WorkflowGateView } from "./workflowManager.js";

export function assertTestcaseReviewExportReady(
  view: WorkflowGateView,
  callbackSubjectDigest: string
): void {
  if (!["v7", "v8"].includes(view.definitionVersion)) {
    throw new Error("Testcase review workbooks are only available for version-7 or version-8 requests.");
  }
  const resolution = view.activities["case-review-resolution"];
  // The design_reconfirm branch revalidates a registered, user-accepted design
  // with zero drift; its design-revalidation activity carries the converged
  // review evidence, so a per-round review workbook is still mandatory before
  // the reconfirm confirmation (§4.3 forbids reusing a previous round's file).
  const designRevalidation = view.activities["design-revalidation"];
  const converged = (resolution?.state === "SUCCEEDED" && resolution.outcome === "converged")
    || (designRevalidation?.state === "SUCCEEDED"
      && designRevalidation.outcome === "zero_drift_reconfirmed");
  if (!converged) {
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
