import assert from "node:assert/strict";
import test from "node:test";
import {
  assertTestcaseReviewExportReady,
  type WorkflowGateView
} from "../../../src/support/task-workflow/index.js";

const digest = "a".repeat(64);

function gate(input: {
  version?: string;
  resolutionState?: string;
  resolutionOutcome?: string;
  confirmationState?: string;
  callbackSubjectDigest?: string;
  safe?: boolean;
  designRevalidationState?: string;
  designRevalidationOutcome?: string;
} = {}): WorkflowGateView {
  const activities: Record<string, unknown> = {
    "case-review-resolution": {
      state: input.resolutionState ?? "SUCCEEDED",
      outcome: input.resolutionOutcome ?? "converged"
    },
    "case-confirmation": {
      state: input.confirmationState ?? "READY",
      callbackSubjectDigest: input.callbackSubjectDigest
    }
  };
  if (input.designRevalidationState !== undefined
    || input.designRevalidationOutcome !== undefined) {
    activities["design-revalidation"] = {
      state: input.designRevalidationState ?? "SUCCEEDED",
      outcome: input.designRevalidationOutcome ?? "zero_drift_reconfirmed"
    };
  }
  return {
    definitionVersion: input.version ?? "v7",
    activities,
    checkpoint: {
      safe: input.safe ?? true,
      reason: input.safe === false ? "activity in flight" : "safe"
    }
  } as unknown as WorkflowGateView;
}

test("testcase review export accepts converged READY and current WAITING_CALLBACK states", () => {
  assert.doesNotThrow(() => assertTestcaseReviewExportReady(gate(), digest));
  assert.doesNotThrow(() => assertTestcaseReviewExportReady(gate({
    confirmationState: "WAITING_CALLBACK",
    callbackSubjectDigest: digest
  }), digest));
});

test("testcase review export rejects old, unconverged, unsafe, and stale states", () => {
  assert.throws(() => assertTestcaseReviewExportReady(gate({ version: "v6" }), digest), /version-7/u);
  assert.throws(() => assertTestcaseReviewExportReady(gate({
    resolutionOutcome: "human_conflict"
  }), digest), /converged/u);
  assert.throws(() => assertTestcaseReviewExportReady(gate({ safe: false }), digest), /safe checkpoint/u);
  assert.throws(() => assertTestcaseReviewExportReady(gate({
    confirmationState: "WAITING_CALLBACK",
    callbackSubjectDigest: "b".repeat(64)
  }), digest), /stale/u);
});

test("testcase review export accepts the design_reconfirm zero-drift branch", () => {
  const designGate = gate({
    resolutionState: undefined,
    designRevalidationState: "SUCCEEDED",
    designRevalidationOutcome: "zero_drift_reconfirmed"
  });
  designGate.activities["case-review-resolution"] = undefined;
  assert.doesNotThrow(() => assertTestcaseReviewExportReady(designGate, digest));
  assert.doesNotThrow(() => assertTestcaseReviewExportReady(gate({
    designRevalidationState: "SUCCEEDED",
    confirmationState: "WAITING_CALLBACK",
    callbackSubjectDigest: digest
  }), digest));
});

test("testcase review export rejects an unfinished design revalidation", () => {
  const pending = gate({ designRevalidationState: "RUNNING" });
  pending.activities["case-review-resolution"] = undefined;
  assert.throws(
    () => assertTestcaseReviewExportReady(pending, digest),
    /converged/u
  );
});
