import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  ExecutionAuthorizationSnapshot
} from "./formal-execution/authorization.js";
import { FormalExecutionStore } from "./formal-execution/formalExecutionStore.js";
import {
  digestFormalExecutionManifest,
  loadFormalExecutionManifestFromPath,
  validateFormalExecutionManifest
} from "./formal-execution/manifest.js";
import type {
  FormalExecutionManifest,
  FormalExecutionSummary
} from "./formal-execution/types.js";
import {
  assertFormalBuildAuthorizationCompatibility,
  verifyFrozenBuildIdentity
} from "./formal-execution/selectorBuildIdentity.js";
import {
  deriveFormalTestOutcome,
  parseFormalExecutionWorkflowEvidence
} from "./task-workflow/formalCompletionEvidence.js";
import type { FormalExecutionWorkflowEvidence } from "./task-workflow/types.js";

export interface FormalCompletionContext {
  snapshot: ExecutionAuthorizationSnapshot;
  manifest: FormalExecutionManifest;
  manifestDigest: string;
  store: FormalExecutionStore;
}

export interface FormalDeterministicOutcomeAssessment {
  status: "settled" | "pending" | "terminal_unknown";
  pendingUnknownCount: number;
  terminalUnknownCount: number;
  terminalSelectorRepairCount?: number;
  selectorRepairIncidentPaths?: string[];
  allTerminalUnknownsRepairable?: boolean;
}

export interface DerivedFormalRunCompletion {
  evidence: FormalExecutionWorkflowEvidence;
  summary: FormalExecutionSummary;
}

export interface DerivedFormalReportCompletion extends DerivedFormalRunCompletion {
  publishId: string;
  artifacts: Array<{ targetPath: string; content: Buffer }>;
}

export async function loadFormalCompletionContext(
  requestId: string,
  workspaceRoot: string
): Promise<FormalCompletionContext> {
  const {
    assertCurrentAuthorizedScripts,
    loadConfirmedExecutionAuthorization
  } = await import(
    "./formal-execution/authorization.js"
  );
  const snapshot = await loadConfirmedExecutionAuthorization(
    requestId,
    undefined,
    [],
    workspaceRoot
  );
  const entryPaths = snapshot.schemaVersion === "execution-authorization-v5"
    ? snapshot.entryScriptPaths ?? []
    : await formalExecutionEntryPathsAtWorkspace(requestId, workspaceRoot);
  assertCurrentAuthorizedScripts(snapshot, entryPaths, workspaceRoot);
  const manifest = snapshot.schemaVersion === "execution-authorization-v5"
    ? await loadFormalExecutionManifestFromPath(snapshot.formalManifestPath!, {
        workspaceRoot,
        expectedSuiteId: snapshot.suiteId
      })
    : await loadFormalManifestAtWorkspace(requestId, workspaceRoot);
  assertFormalBuildAuthorizationCompatibility({
    manifest,
    authorizationSchemaVersion: snapshot.schemaVersion
  });
  if (snapshot.schemaVersion === "execution-authorization-v5"
    && manifest.schemaVersion === "formal-execution-manifest-v4"
    && manifest.suiteId !== snapshot.suiteId) {
    throw new Error("Formal manifest suite identity differs from execution-authorization-v5.");
  }
  const manifestDigest = digestFormalExecutionManifest(manifest);
  if (snapshot.environment !== manifest.environment) {
    throw new Error("Formal manifest environment differs from the accepted execution subject.");
  }
  if (
    snapshot.schemaVersion === "execution-authorization-v3"
    || snapshot.schemaVersion === "execution-authorization-v4"
    || snapshot.schemaVersion === "execution-authorization-v5"
  ) {
    await verifyFrozenBuildIdentity({
      manifest,
      workspaceRoot,
      targetBuildDigest: snapshot.targetBuildDigest!,
      selectorEvidenceDigests: snapshot.selectorEvidenceDigests ?? []
    });
  }
  return {
    snapshot,
    manifest,
    manifestDigest,
    store: new FormalExecutionStore(
      resolve(workspaceRoot, ".local/test-ledger"),
      resolve(workspaceRoot, "artifacts/test-results/formal")
    )
  };
}

export async function deriveFormalRunCompletion(
  requestId: string,
  workspaceRoot: string
): Promise<DerivedFormalRunCompletion> {
  const context = await loadFormalCompletionContext(requestId, workspaceRoot);
  assertDeterministicOutcomeSettled(
    deriveFormalDeterministicOutcomeAssessment(
      await context.store.summarize(context.snapshot.digest)
    )
  );
  const sealed = await context.store.sealForWorkflow(sealInput(requestId, context));
  return {
    evidence: workflowEvidence(sealed.summary, sealed.seal.resultDigest),
    summary: sealed.summary
  };
}

export async function deriveFormalReportCompletion(
  requestId: string,
  workspaceRoot: string
): Promise<DerivedFormalReportCompletion> {
  const context = await loadFormalCompletionContext(requestId, workspaceRoot);
  assertDeterministicOutcomeSettled(
    deriveFormalDeterministicOutcomeAssessment(
      await context.store.summarize(context.snapshot.digest)
    )
  );
  const sealed = await context.store.sealForWorkflow(sealInput(requestId, context));
  const materialized = await context.store.materializeSealedReport(context.snapshot.digest);
  const evidence = workflowEvidence(materialized.summary, sealed.seal.resultDigest);
  const artifacts = await Promise.all(materialized.artifacts.map(async (artifact) => {
    const content = await readFile(resolve(workspaceRoot, artifact.path));
    const actualDigest = createHash("sha256").update(content).digest("hex");
    if (actualDigest !== artifact.digest) {
      throw new Error(
        `Sealed formal report digest mismatch for ${artifact.path}; expected ${artifact.digest}, read ${actualDigest}.`
      );
    }
    return { targetPath: artifact.path, content };
  }));
  return {
    evidence,
    summary: materialized.summary,
    publishId: `formal-report-${evidence.resultDigest.slice(0, 24)}`,
    artifacts
  };
}

export function deriveFormalDeterministicOutcomeAssessment(
  summary: FormalExecutionSummary
): FormalDeterministicOutcomeAssessment {
  const terminalUnknownCount = summary.cases.filter((item) =>
    item.status === "unknown" && item.attemptFinality === "terminal"
  ).length;
  const pendingUnknownCount = summary.cases.filter((item) =>
    item.status === "unknown" && item.attemptFinality !== "terminal"
  ).length;
  const repairable = summary.cases.filter((item) =>
    item.status === "unknown"
    && item.attemptFinality === "terminal"
    && item.selectorRepairIncident?.eligibility === "eligible"
  );
  return {
    status: terminalUnknownCount > 0
      ? "terminal_unknown"
      : pendingUnknownCount > 0
        ? "pending"
        : "settled",
    pendingUnknownCount,
    terminalUnknownCount,
    terminalSelectorRepairCount: repairable.length,
    selectorRepairIncidentPaths: [...new Set(repairable.map((item) =>
      item.selectorRepairIncident!.path
    ))].sort(),
    allTerminalUnknownsRepairable: terminalUnknownCount > 0
      && repairable.length === terminalUnknownCount
  };
}

function assertDeterministicOutcomeSettled(
  assessment: FormalDeterministicOutcomeAssessment
): void {
  if (assessment.status === "terminal_unknown") {
    throw new Error(
      "Formal execution has a terminal unknown outcome and requires deterministic reconciliation."
    );
  }
  if (assessment.status === "pending") {
    throw new Error("Formal execution still has pending or unstarted cases.");
  }
}

function sealInput(requestId: string, context: FormalCompletionContext) {
  return {
    authorizationDigest: context.snapshot.digest,
    requestId,
    environment: context.snapshot.environment,
    manifestDigest: context.manifestDigest,
    targetBuildDigest: context.snapshot.targetBuildDigest,
    runnableCaseIds: context.snapshot.caseIds,
    deferredCaseIds: (context.snapshot.deferredCases ?? []).map((item) => item.caseId)
  };
}

async function loadFormalManifestAtWorkspace(
  requestId: string,
  workspaceRoot: string
): Promise<FormalExecutionManifest> {
  const [type, ...requestParts] = requestId.split("/");
  const path = resolve(
    workspaceRoot,
    "tests",
    type!,
    requestParts.join("/"),
    "execution.manifest.ts"
  );
  const imported = await import(pathToFileURL(path).href) as {
    formalExecutionManifest?: FormalExecutionManifest;
  };
  if (!imported.formalExecutionManifest) {
    throw new Error(`Formal execution manifest is missing at ${path}.`);
  }
  validateFormalExecutionManifest(imported.formalExecutionManifest);
  if (imported.formalExecutionManifest.requestId !== requestId) {
    throw new Error("Formal execution manifest belongs to another request.");
  }
  return imported.formalExecutionManifest;
}

async function formalExecutionEntryPathsAtWorkspace(
  requestId: string,
  workspaceRoot: string
): Promise<string[]> {
  const [type, ...requestParts] = requestId.split("/");
  const requestDirectory = resolve(
    workspaceRoot,
    "tests",
    type!,
    requestParts.join("/")
  );
  const formalSpecPaths = (await readdir(requestDirectory))
    .filter((name) => name.endsWith(".formal.spec.ts"))
    .sort()
    .map((name) => resolve(requestDirectory, name));
  if (!formalSpecPaths.length) {
    throw new Error(`Formal completion found no *.formal.spec.ts files for ${requestId}.`);
  }
  return [resolve(requestDirectory, "execution.manifest.ts"), ...formalSpecPaths];
}

function workflowEvidence(
  summary: FormalExecutionSummary,
  resultDigest: string
): FormalExecutionWorkflowEvidence {
  const caseCounts = {
    ...summary.counts,
    deferred: summary.deferredCases.length
  };
  const derivedTestOutcome = deriveFormalTestOutcome(caseCounts, summary.scopeStatus);
  if (derivedTestOutcome !== summary.testOutcome) {
    throw new Error(
      `Formal execution summary testOutcome ${summary.testOutcome} differs from derived ${derivedTestOutcome}.`
    );
  }
  return parseFormalExecutionWorkflowEvidence({
    schemaVersion: "formal-execution-workflow-evidence-v1",
    executionSubjectDigest: summary.authorizationDigest,
    manifestDigest: summary.manifestDigest,
    resultDigest,
    caseCounts,
    scopeStatus: summary.scopeStatus,
    dataHygieneStatus: summary.dataHygieneStatus,
    testOutcome: summary.testOutcome
  });
}
