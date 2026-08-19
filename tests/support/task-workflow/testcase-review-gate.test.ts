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
} = {}): WorkflowGateView {
  return {
    definitionVersion: input.version ?? "v7",
    activities: {
      "case-review-resolution": {
        state: input.resolutionState ?? "SUCCEEDED",
        outcome: input.resolutionOutcome ?? "converged"
      },
      "case-confirmation": {
        state: input.confirmationState ?? "READY",
        callbackSubjectDigest: input.callbackSubjectDigest
      }
    },
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
