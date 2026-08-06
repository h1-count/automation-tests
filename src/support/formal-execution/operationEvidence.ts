import type { Page, Response } from "@playwright/test";
import type {
  FormalOperationEvidenceDefinition,
  FormalOperationEvidenceRecord
} from "./types.js";

const safeIdentifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const effectfulOperations = new Set([
  "authenticate_test_account",
  "send_test_otp",
  "upload_synthetic_file",
  "submit_registration",
  "create_test_resource",
  "update_test_resource",
  "delete_test_resource",
  "change_test_permission",
  "invoke_test_device_action",
  "cleanup_test_resource"
]);

export interface ParsedWebOperationOutcome {
  outcome: "succeeded" | "rejected";
  finality: "accepted" | "final";
  stableResourceId?: string;
  /** Runtime-only value for asserting that the UI consumed this response; never persisted. */
  runtimeUiValue?: string;
}

export async function captureWebOperationOutcome(input: {
  page: Page;
  operation: FormalOperationEvidenceRecord["operation"];
  method: string;
  path: string;
  contractId: string;
  timeoutMs: number;
  trigger(): Promise<void>;
  parse(response: Response): Promise<ParsedWebOperationOutcome>;
  uiRejection?: {
    contractId: string;
    detect(): Promise<boolean>;
  };
}): Promise<{
  response?: Response;
  parsed?: ParsedWebOperationOutcome;
  evidence: FormalOperationEvidenceRecord;
}> {
  const method = input.method.trim().toUpperCase();
  const path = normalizePath(input.path);
  const matches: Response[] = [];
  const listener = (response: Response): void => {
    if (response.request().method().toUpperCase() !== method) return;
    if (!matchesOperationPath(response.url(), path)) return;
    matches.push(response);
  };
  input.page.on("response", listener);
  try {
    const responsePromise = input.page.waitForResponse((response) =>
      response.request().method().toUpperCase() === method
      && matchesOperationPath(response.url(), path),
    { timeout: input.timeoutMs }).catch(() => undefined);
    await input.trigger();
    const winner = input.uiRejection
      ? await Promise.race([
          responsePromise.then((response) => ({ kind: "response" as const, response })),
          input.uiRejection.detect().then((rejected) => ({ kind: "ui" as const, rejected }))
        ])
      : { kind: "response" as const, response: await responsePromise };
    if (winner.kind === "ui" && winner.rejected) {
      return {
        parsed: { outcome: "rejected", finality: "final" },
        evidence: sanitizeOperationEvidenceRecord({
          operation: input.operation,
          source: "ui_state",
          contractId: input.uiRejection!.contractId,
          outcome: "rejected",
          finality: "final",
          stableIdentity: "not_required",
          fallbackUsed: false,
          reconciliation: "not_required"
        })
      };
    }
    const response = winner.kind === "response" ? winner.response : await responsePromise;
    await Promise.resolve();
    if (!response || matches.length !== 1) {
      return {
        response,
        evidence: unknownEvidence(input.operation, input.contractId, method, path, response)
      };
    }
    try {
      const parsed = await input.parse(response);
      return {
        response,
        parsed,
        evidence: sanitizeOperationEvidenceRecord({
          operation: input.operation,
          source: "browser_response",
          contractId: input.contractId,
          outcome: parsed.outcome,
          finality: parsed.finality,
          method,
          path,
          statusCode: response.status(),
          stableIdentity: parsed.stableResourceId ? "observed" : "not_required",
          fallbackUsed: false,
          reconciliation: "not_required"
        })
      };
    } catch {
      return {
        response,
        evidence: unknownEvidence(input.operation, input.contractId, method, path, response)
      };
    }
  } finally {
    input.page.off("response", listener);
  }
}

export function operationEvidenceDefinitionIssues(input: {
  requiredOperations: readonly string[];
  requiredCapabilities: readonly string[];
  definitions: readonly FormalOperationEvidenceDefinition[] | undefined;
  dataWritePolicy?: string;
}): string[] {
  const required = input.requiredOperations.filter((operation) =>
    effectfulOperations.has(operation)
    || (operation === "query_postcondition"
      && input.definitions?.some((definition) => definition.operation === operation))
  );
  if (!required.length && !input.definitions?.length) return [];
  if (!input.definitions?.length) {
    return [`Effectful operations require operationEvidence: ${required.join(", ")}.`];
  }
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const definition of input.definitions) {
    if (seen.has(definition.operation)) {
      issues.push(`operationEvidence duplicates ${definition.operation}.`);
      continue;
    }
    seen.add(definition.operation);
    if (!required.includes(definition.operation)) {
      issues.push(`operationEvidence references non-effectful or undeclared operation ${definition.operation}.`);
    }
    if (definition.strategy === "ui_state") {
      if (!safeContractId(definition.uiContractId)
        || definition.responseContractId !== undefined
        || definition.queryCapabilityId !== undefined
        || definition.finality !== "final"
        || definition.stableIdentityRequired) {
        issues.push(`${definition.operation} ui_state requires only a safe final UI contract without stable identity.`);
      }
      continue;
    }
    if (definition.strategy === "response_or_ui_rejection") {
      if (!safeContractId(definition.responseContractId)
        || !safeContractId(definition.uiContractId)
        || definition.queryCapabilityId !== undefined
        || definition.finality !== "final") {
        issues.push(`${definition.operation} response_or_ui_rejection requires reviewed response and UI contracts.`);
      }
      continue;
    }
    if (definition.uiContractId !== undefined) {
      issues.push(`${definition.operation} ${definition.strategy} cannot declare uiContractId.`);
    }
    const responseStrategy = definition.strategy !== "query_only";
    const queryStrategy = definition.strategy !== "response_contract";
    if (responseStrategy && !safeContractId(definition.responseContractId)) {
      issues.push(`${definition.operation} ${definition.strategy} requires a safe responseContractId.`);
    }
    if (!responseStrategy && definition.responseContractId !== undefined) {
      issues.push(`${definition.operation} query_only cannot declare responseContractId.`);
    }
    if (queryStrategy) {
      if (!definition.queryCapabilityId?.trim()) {
        issues.push(`${definition.operation} ${definition.strategy} requires queryCapabilityId.`);
      } else if (!input.requiredCapabilities.includes(definition.queryCapabilityId)) {
        issues.push(`${definition.operation} query capability is not required by the case.`);
      }
    } else if (definition.queryCapabilityId !== undefined) {
      issues.push(`${definition.operation} response_contract cannot declare queryCapabilityId.`);
    }
    if (definition.strategy === "response_then_query" && definition.finality !== "accepted") {
      issues.push(`${definition.operation} response_then_query must declare accepted finality.`);
    }
    if (definition.strategy !== "response_then_query" && definition.finality !== "final") {
      issues.push(`${definition.operation} ${definition.strategy} must declare final finality.`);
    }
  }
  for (const operation of required) {
    if (!seen.has(operation)) issues.push(`operationEvidence is missing ${operation}.`);
  }
  if (input.dataWritePolicy === "tracked_residual") {
    for (const operation of required.filter((item) =>
      ["upload_synthetic_file", "submit_registration", "create_test_resource", "update_test_resource", "delete_test_resource"]
        .includes(item)
    )) {
      const definition = input.definitions.find((item) => item.operation === operation);
      if (definition?.strategy === "ui_state") continue;
      if (!definition?.stableIdentityRequired) {
        issues.push(`tracked_residual ${operation} requires stable resource identity evidence.`);
      }
    }
  }
  return issues;
}

export function sanitizeOperationEvidenceRecord(
  value: FormalOperationEvidenceRecord
): FormalOperationEvidenceRecord {
  if (!safeContractId(value.contractId)) throw new Error("Operation evidence contractId is unsafe.");
  const method = value.method?.trim().toUpperCase();
  if (method && !/^[A-Z]+$/u.test(method)) throw new Error("Operation evidence method is unsafe.");
  const path = value.path === undefined ? undefined : normalizePath(value.path);
  if (value.statusCode !== undefined && (
    !Number.isInteger(value.statusCode) || value.statusCode < 100 || value.statusCode > 599
  )) {
    throw new Error("Operation evidence statusCode is invalid.");
  }
  return {
    ...value,
    ...(method ? { method } : {}),
    ...(path ? { path } : {})
  };
}

export function operationEvidenceCompletionIssues(input: {
  definitions: readonly FormalOperationEvidenceDefinition[] | undefined;
  records: readonly FormalOperationEvidenceRecord[];
}): string[] {
  if (!input.definitions?.length) return [];
  const issues: string[] = [];
  for (const definition of input.definitions) {
    const records = input.records.filter((item) => item.operation === definition.operation);
    const completed = records.find((record) => {
      if (record.outcome === "unknown" || record.reconciliation === "pending") return false;
      if (definition.stableIdentityRequired
        && record.outcome === "succeeded"
        && record.stableIdentity !== "observed") return false;
      if (definition.strategy === "response_then_query") {
        return record.source === "response_and_query"
          && record.finality === "final"
          && record.reconciliation === "completed";
      }
      if (definition.strategy === "query_only") {
        return record.source === "postcondition_query"
          && record.finality === "final"
          && record.reconciliation === "completed";
      }
      if (definition.strategy === "response_contract") {
        return record.source === "browser_response"
          && record.finality === "final";
      }
      if (definition.strategy === "response_or_ui_rejection") {
        return (
          record.source === "browser_response"
          && record.contractId === definition.responseContractId
          && record.finality === "final"
        ) || (
          record.source === "ui_state"
          && record.contractId === definition.uiContractId
          && record.outcome === "rejected"
          && record.finality === "final"
        );
      }
      if (definition.strategy === "ui_state") {
        return record.source === "ui_state"
          && record.contractId === definition.uiContractId
          && record.finality === "final";
      }
      return record.finality === "final"
        && (
          record.source === "browser_response"
          || record.source === "response_and_query"
        );
    });
    if (!completed) {
      issues.push(`${definition.operation} has no conclusive structured operation evidence.`);
    }
  }
  return issues;
}

function unknownEvidence(
  operation: FormalOperationEvidenceRecord["operation"],
  contractId: string,
  method: string,
  path: string,
  response?: Response
): FormalOperationEvidenceRecord {
  return sanitizeOperationEvidenceRecord({
    operation,
    source: "browser_response",
    contractId,
    outcome: "unknown",
    finality: "final",
    method,
    path,
    ...(response ? { statusCode: response.status() } : {}),
    stableIdentity: "missing",
    fallbackUsed: false,
    reconciliation: "pending"
  });
}

function safeContractId(value: string | undefined): boolean {
  return Boolean(value && safeIdentifier.test(value));
}

function normalizePath(value: string): string {
  const url = new URL(value, "https://formal.invalid");
  if (!url.pathname.startsWith("/") || url.pathname.includes("..")) {
    throw new Error("Operation evidence path is unsafe.");
  }
  return url.pathname;
}

/**
 * API base paths vary by environment (for example `/open-platform` in test).
 * Operation contracts therefore freeze the reviewed endpoint path and match it
 * at a complete path-segment boundary, while still rejecting lookalike suffixes.
 */
export function matchesOperationPath(actualUrl: string, endpointPath: string): boolean {
  const actualPath = normalizePath(actualUrl);
  const expectedPath = normalizePath(endpointPath);
  return actualPath === expectedPath || actualPath.endsWith(expectedPath);
}
