import { resolve } from "node:path";
import {
  deriveFormalDeterministicOutcomeAssessment,
  loadFormalCompletionContext,
  type FormalDeterministicOutcomeAssessment
} from "../formalCompletionService.js";
import {
  DurableWorkflowManager,
  formalDataHygieneBlockerId,
  formalDeterministicOutcomeBlockerId,
  type WorkflowGateView
} from "../task-workflow/workflowManager.js";
import type { FormalExecutionWorkflowEvidence } from "../task-workflow/types.js";
import type { FormalExecutionSummary } from "./types.js";
import { finalizeFormalExecution } from "./finalize.js";
import { TestDataManager } from "../test-data/testDataManager.js";

const acceptedDataHygieneStatuses = new Set(["clean", "reusable", "retained"]);

export type FormalRunWorkflowFinalization =
  | {
      kind: "completed";
      evidence: FormalExecutionWorkflowEvidence;
      workflow: WorkflowGateView;
    }
  | {
      kind: "parked";
      blockerId: string;
      parkReason: "deterministic_outcome" | "data_hygiene";
      dataHygieneStatus: FormalExecutionSummary["dataHygieneStatus"];
      outcomeAssessment: FormalDeterministicOutcomeAssessment;
      workflow: WorkflowGateView;
    };

export async function finalizeFormalRunWorkflow(input: {
  manager: DurableWorkflowManager;
  claimToken?: string;
}): Promise<FormalRunWorkflowFinalization> {
  if (!input.claimToken) throw new Error("Formal run finalization requires --claim.");
  const context = await loadFormalCompletionContext(
    input.manager.requestId,
    input.manager.workspaceRoot
  );
  const record = await context.store.read(context.snapshot.digest);
  if (!record) {
    throw new Error("Formal execution state is not initialized for the accepted execution subject.");
  }
  const hygieneBlockerId = formalDataHygieneBlockerId(context.snapshot.digest);
  const deterministicBlockerId = formalDeterministicOutcomeBlockerId(
    context.snapshot.digest
  );
  const prepared = await input.manager.prepareFormalCompletionClaim({
    activityId: "run",
    claimToken: input.claimToken,
    owner: "formal-run-settlement",
    dataHygieneSubjectDigest: context.snapshot.digest,
    deterministicOutcomeSubjectDigest: context.snapshot.digest
  });
  let releasePrepared = prepared.acquired;
  try {
    let summary = await context.store.summarize(context.snapshot.digest);
    const gate = await input.manager.gate();
    const hygieneBlockerActive = gate.activities.run?.blockerIds.includes(hygieneBlockerId) === true;
    const deterministicBlockerActive = gate.activities.run?.blockerIds.includes(
      deterministicBlockerId
    ) === true;
    if (hygieneBlockerActive && deterministicBlockerActive) {
      throw new Error("Formal run cannot carry both reserved settlement blockers.");
    }
    let outcomeAssessment = deriveFormalDeterministicOutcomeAssessment(summary);
    if (outcomeAssessment.status === "terminal_unknown") {
      if (hygieneBlockerActive) {
        throw new Error(
          "Formal run became terminal unknown while a data hygiene blocker was active."
        );
      }
      if (deterministicBlockerActive) {
        await input.manager.releaseFormalCompletionClaim("run", prepared.claimToken);
        releasePrepared = false;
        return {
          kind: "parked",
          blockerId: deterministicBlockerId,
          parkReason: "deterministic_outcome",
          dataHygieneStatus: summary.dataHygieneStatus,
          outcomeAssessment,
          workflow: await input.manager.gate()
        };
      }
      const parked = await input.manager.parkRunForDeterministicOutcome({
        claimToken: prepared.claimToken,
        executionSubjectDigest: context.snapshot.digest,
        outcomeAssessment
      });
      releasePrepared = false;
      return {
        kind: "parked",
        blockerId: parked.blockerId,
        parkReason: "deterministic_outcome",
        dataHygieneStatus: summary.dataHygieneStatus,
        outcomeAssessment,
        workflow: parked.projection
      };
    }
    if (outcomeAssessment.status === "pending") {
      throw new Error("Formal execution still has pending or unstarted case outcomes.");
    }
    if (!acceptedDataHygieneStatuses.has(summary.dataHygieneStatus)) {
      assertDataHygieneSettlementScope(summary);
      if (hygieneBlockerActive || deterministicBlockerActive) {
        const settlement = await finalizeFormalExecution(input.manager.requestId, {
          snapshot: context.snapshot,
          manifest: context.manifest,
          store: context.store,
          managerFactory: (projectId, environment) => new TestDataManager({
            projectId,
            envId: environment,
            ledgerRoot: resolve(input.manager.workspaceRoot, ".local/test-ledger"),
            artifactRoot: resolve(input.manager.workspaceRoot, "artifacts/test-results")
          })
        });
        if (settlement.kind === "parked") {
          throw new Error("Data hygiene settlement cannot run while external transitions are pending.");
        }
        summary = settlement.summary;
        outcomeAssessment = deriveFormalDeterministicOutcomeAssessment(summary);
        if (outcomeAssessment.status !== "settled") {
          throw new Error("Formal execution outcome changed while settling data hygiene.");
        }
        if (!acceptedDataHygieneStatuses.has(summary.dataHygieneStatus)) {
          const unsettled = normalizeUnsettledDataHygieneStatus(summary.dataHygieneStatus);
          if (deterministicBlockerActive) {
            const converted = await input.manager
              .replaceDeterministicOutcomeBlockerWithDataHygiene({
                claimToken: prepared.claimToken,
                executionSubjectDigest: context.snapshot.digest,
                outcomeAssessment,
                dataHygieneStatus: unsettled
              });
            releasePrepared = false;
            return {
              kind: "parked",
              blockerId: converted.blockerId,
              parkReason: "data_hygiene",
              dataHygieneStatus: unsettled,
              outcomeAssessment,
              workflow: converted.projection
            };
          }
          await input.manager.releaseFormalCompletionClaim("run", prepared.claimToken);
          releasePrepared = false;
          return {
            kind: "parked",
            blockerId: hygieneBlockerId,
            parkReason: "data_hygiene",
            dataHygieneStatus: unsettled,
            outcomeAssessment,
            workflow: await input.manager.gate()
          };
        }
      } else {
        const unsettled = normalizeUnsettledDataHygieneStatus(summary.dataHygieneStatus);
        const parked = await input.manager.parkRunForDataHygiene({
          claimToken: prepared.claimToken,
          executionSubjectDigest: context.snapshot.digest,
          dataHygieneStatus: unsettled
        });
        releasePrepared = false;
        return {
          kind: "parked",
          blockerId: parked.blockerId,
          parkReason: "data_hygiene",
          dataHygieneStatus: unsettled,
          outcomeAssessment,
          workflow: parked.projection
        };
      }
    }

    const completed = await input.manager.completeFormalRun({
      claimToken: prepared.claimToken
    });
    releasePrepared = false;
    return { kind: "completed", ...completed };
  } catch (error) {
    if (releasePrepared) {
      await input.manager.releaseFormalCompletionClaim("run", prepared.claimToken);
    }
    throw error;
  }
}

export async function finalizeFormalReportWorkflow(input: {
  manager: DurableWorkflowManager;
  claimToken: string;
}): Promise<{ evidence: FormalExecutionWorkflowEvidence; workflow: WorkflowGateView }> {
  return input.manager.publishFormalReportAndComplete({ claimToken: input.claimToken });
}

function assertDataHygieneSettlementScope(summary: FormalExecutionSummary): void {
  if (
    deriveFormalDeterministicOutcomeAssessment(summary).status !== "settled"
    || summary.pendingTransitions.length > 0
  ) {
    throw new Error(
      "Formal execution scope is still pending; it cannot be parked as a data hygiene settlement."
    );
  }
}

function normalizeUnsettledDataHygieneStatus(
  value: FormalExecutionSummary["dataHygieneStatus"]
): "cleanup_failed" | "manual_required" | "unknown" {
  return value === "cleanup_failed" || value === "manual_required" ? value : "unknown";
}
