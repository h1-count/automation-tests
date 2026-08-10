import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const BROWSER_EXPLORATION_POLICY_SCHEMA = "browser-exploration-policy-v1" as const;
export const BROWSER_EXPLORATION_EVIDENCE_SCHEMA = "browser-exploration-evidence-v1" as const;
export const CHROME_DEVTOOLS_MCP_PACKAGE = "chrome-devtools-mcp@1.6.0" as const;

export type BrowserExplorationStatus = "eligible" | "fallback" | "ineligible";
export type BrowserExplorationOutcome = "observed" | "unavailable" | "unsafe" | "mismatch";

export interface BrowserExplorationPolicy {
  schemaVersion: typeof BROWSER_EXPLORATION_POLICY_SCHEMA;
  adapter: "chrome_devtools_mcp";
  package: typeof CHROME_DEVTOOLS_MCP_PACKAGE;
  allowedTools: string[];
  forbiddenTools: string[];
  mcpArguments: string[];
  screenshotApprovalRequired: boolean;
}

export interface BrowserExplorationEligibility {
  schemaVersion: "browser-exploration-eligibility-v1";
  requestDigest: string;
  status: BrowserExplorationStatus;
  reasonCodes: string[];
  targetEnvironment?: "test" | "pre";
}

export interface BrowserExplorationCandidateLocator {
  strategy: "role" | "label" | "test_id" | "text" | "css";
  value: string;
}

export interface BrowserExplorationEvidence {
  schemaVersion: typeof BROWSER_EXPLORATION_EVIDENCE_SCHEMA;
  adapter: "chrome_devtools_mcp";
  adapterVersion: "1.6.0";
  subjectDigest: string;
  outcome: BrowserExplorationOutcome;
  environment: "test" | "pre";
  routeState: string;
  locale: string;
  role: string;
  caseIds: string[];
  candidateLocators: BrowserExplorationCandidateLocator[];
  ariaSummary: Array<{ role: string; name?: string }>;
  networkSummary: Array<{ method: string; path: string; status: number }>;
  consoleSummary: Array<{ category: string; count: number }>;
  reachableBoundary: string;
  blockedMutationCounts: Record<string, number>;
  unresolved: string[];
}

export async function loadBrowserExplorationPolicy(
  workspaceRoot = process.cwd()
): Promise<BrowserExplorationPolicy> {
  const policyPath = resolve(workspaceRoot, "config/browser-exploration/chrome-devtools-mcp-policy.json");
  const parsed = JSON.parse(await readFile(policyPath, "utf8")) as BrowserExplorationPolicy;
  validateBrowserExplorationPolicy(parsed);
  return parsed;
}

export function validateBrowserExplorationPolicy(policy: BrowserExplorationPolicy): void {
  if (
    policy.schemaVersion !== BROWSER_EXPLORATION_POLICY_SCHEMA
    || policy.adapter !== "chrome_devtools_mcp"
    || policy.package !== CHROME_DEVTOOLS_MCP_PACKAGE
    || policy.screenshotApprovalRequired !== true
  ) {
    throw new Error("Browser exploration policy has an unsupported identity.");
  }
  const expectedAllowedTools = new Set([
    "list_pages",
    "select_page",
    "navigate_page",
    "wait_for",
    "take_snapshot",
    "take_screenshot",
    "list_console_messages",
    "get_console_message",
    "list_network_requests"
  ]);
  if (
    !Array.isArray(policy.allowedTools)
    || policy.allowedTools.length !== expectedAllowedTools.size
    || policy.allowedTools.some((tool) => !expectedAllowedTools.delete(tool))
  ) {
    throw new Error("Browser exploration policy must expose exactly the approved read-only tools.");
  }
  if (
    !Array.isArray(policy.forbiddenTools)
    || policy.forbiddenTools.some((tool) => !tool.trim())
    || policy.forbiddenTools.some((tool) => policy.allowedTools.includes(tool))
  ) {
    throw new Error("Browser exploration policy has invalid forbidden tools.");
  }
  if (
    !Array.isArray(policy.mcpArguments)
    || policy.mcpArguments.some((argument) => !argument.startsWith("--"))
  ) {
    throw new Error("Browser exploration policy has invalid MCP arguments.");
  }
}

export function isSupportedChromeDevtoolsNodeVersion(version = process.versions.node): boolean {
  const [majorText, minorText] = version.split(".");
  const major = Number(majorText);
  const minor = Number(minorText);
  return (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major >= 23;
}

export function browserExplorationRequestDigest(requestId: string): string {
  if (!/^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/u.test(requestId)) {
    throw new Error("Browser exploration request must use type/project/request format.");
  }
  return createHash("sha256").update(requestId, "utf8").digest("hex");
}

export function evaluateBrowserExplorationEligibility(input: {
  requestId: string;
  environment?: string;
  hostConfigured: boolean;
  nodeVersion?: string;
  authenticatedStateConfigured?: boolean;
}): BrowserExplorationEligibility {
  const requestDigest = browserExplorationRequestDigest(input.requestId);
  const capability = input.requestId.split("/")[0]!;
  if (capability !== "web" && capability !== "h5") {
    return { schemaVersion: "browser-exploration-eligibility-v1", requestDigest, status: "ineligible", reasonCodes: ["unsupported_capability"] };
  }
  const environment = input.environment?.trim().toLowerCase();
  if (environment === "prod" || environment === "production") {
    return { schemaVersion: "browser-exploration-eligibility-v1", requestDigest, status: "ineligible", reasonCodes: ["production_forbidden"] };
  }
  if (environment !== "test" && environment !== "pre") {
    return { schemaVersion: "browser-exploration-eligibility-v1", requestDigest, status: "fallback", reasonCodes: ["environment_unavailable"] };
  }
  if (!isSupportedChromeDevtoolsNodeVersion(input.nodeVersion)) {
    return { schemaVersion: "browser-exploration-eligibility-v1", requestDigest, status: "fallback", reasonCodes: ["node_version_unsupported"], targetEnvironment: environment };
  }
  if (!input.hostConfigured) {
    return { schemaVersion: "browser-exploration-eligibility-v1", requestDigest, status: "fallback", reasonCodes: ["host_adapter_not_configured"], targetEnvironment: environment };
  }
  if (input.authenticatedStateConfigured) {
    return { schemaVersion: "browser-exploration-eligibility-v1", requestDigest, status: "fallback", reasonCodes: ["authenticated_state_not_supported"], targetEnvironment: environment };
  }
  return { schemaVersion: "browser-exploration-eligibility-v1", requestDigest, status: "eligible", reasonCodes: [], targetEnvironment: environment };
}

export function createBrowserExplorationEvidence(
  input: BrowserExplorationEvidence
): BrowserExplorationEvidence {
  const evidence: BrowserExplorationEvidence = {
    ...input,
    caseIds: [...input.caseIds].sort(),
    candidateLocators: input.candidateLocators.map((locator) => ({
      strategy: locator.strategy,
      value: safeObservationText(locator.value, "candidate locator")
    })),
    ariaSummary: input.ariaSummary.map((item) => ({
      role: safeObservationText(item.role, "ARIA role"),
      ...(item.name === undefined ? {} : { name: safeObservationText(item.name, "ARIA name") })
    })),
    networkSummary: input.networkSummary.map((item) => ({
      method: normalizeMethod(item.method),
      path: sanitizeNetworkPath(item.path),
      status: normalizeStatus(item.status)
    })),
    consoleSummary: input.consoleSummary.map((item) => ({
      category: safeCategory(item.category),
      count: normalizeCount(item.count)
    })),
    reachableBoundary: safeObservationText(input.reachableBoundary, "reachable boundary"),
    unresolved: input.unresolved.map((value) => safeObservationText(value, "unresolved observation")),
    blockedMutationCounts: Object.fromEntries(
      Object.entries(input.blockedMutationCounts).map(([method, count]) => [normalizeMethod(method), normalizeCount(count)])
    )
  };
  validateBrowserExplorationEvidence(evidence);
  return evidence;
}

export function validateBrowserExplorationEvidence(value: unknown): asserts value is BrowserExplorationEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Browser exploration evidence must be an object.");
  }
  const evidence = value as BrowserExplorationEvidence;
  if (
    evidence.schemaVersion !== BROWSER_EXPLORATION_EVIDENCE_SCHEMA
    || evidence.adapter !== "chrome_devtools_mcp"
    || evidence.adapterVersion !== "1.6.0"
    || !/^[a-f0-9]{64}$/u.test(evidence.subjectDigest)
    || !["observed", "unavailable", "unsafe", "mismatch"].includes(evidence.outcome)
    || !["test", "pre"].includes(evidence.environment)
    || !Array.isArray(evidence.caseIds)
    || !Array.isArray(evidence.candidateLocators)
    || !Array.isArray(evidence.ariaSummary)
    || !Array.isArray(evidence.networkSummary)
    || !Array.isArray(evidence.consoleSummary)
    || !Array.isArray(evidence.unresolved)
    || !evidence.blockedMutationCounts
  ) {
    throw new Error("Browser exploration evidence has an invalid structure.");
  }
  for (const text of [evidence.routeState, evidence.locale, evidence.role, evidence.reachableBoundary, ...evidence.caseIds, ...evidence.unresolved]) {
    safeObservationText(text, "evidence text");
  }
  for (const locator of evidence.candidateLocators) {
    if (!locator || !["role", "label", "test_id", "text", "css"].includes(locator.strategy)) {
      throw new Error("Browser exploration evidence has an invalid candidate locator.");
    }
    safeObservationText(locator.value, "candidate locator");
  }
  for (const item of evidence.ariaSummary) {
    safeObservationText(item.role, "ARIA role");
    if (item.name !== undefined) safeObservationText(item.name, "ARIA name");
  }
  for (const item of evidence.networkSummary) {
    normalizeMethod(item.method);
    if (item.path !== sanitizeNetworkPath(item.path) || item.path.includes("?") || item.path.includes("#")) {
      throw new Error("Browser exploration evidence network paths must be normalized and query-free.");
    }
    normalizeStatus(item.status);
  }
  for (const item of evidence.consoleSummary) {
    safeCategory(item.category);
    normalizeCount(item.count);
  }
  for (const [method, count] of Object.entries(evidence.blockedMutationCounts)) {
    normalizeMethod(method);
    normalizeCount(count);
  }
}

function safeObservationText(value: string, label: string): string {
  if (!value || value.length > 240 || /[\r\n]/u.test(value)) {
    throw new Error(`Browser exploration ${label} is empty, multiline, or too long.`);
  }
  if (
    /(?:bearer\s+|authorization|cookie|token|password|secret|api[_-]?key|eyJ[a-zA-Z0-9_-]{10,})/iu.test(value)
    || /\b[0-9]{7,}\b/u.test(value)
    || /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/iu.test(value)
  ) {
    throw new Error(`Browser exploration ${label} contains a sensitive-looking value.`);
  }
  return value.trim();
}

function normalizeMethod(value: string): string {
  const method = value.trim().toUpperCase();
  if (!/^[A-Z]{3,10}$/u.test(method)) throw new Error("Browser exploration method is invalid.");
  return method;
}

function normalizeStatus(value: number): number {
  if (!Number.isInteger(value) || value < 100 || value > 599) {
    throw new Error("Browser exploration network status is invalid.");
  }
  return value;
}

function normalizeCount(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new Error("Browser exploration count is invalid.");
  }
  return value;
}

function safeCategory(value: string): string {
  if (!/^[a-z][a-z0-9_-]{0,63}$/u.test(value)) {
    throw new Error("Browser exploration console category is invalid.");
  }
  return value;
}

function sanitizeNetworkPath(value: string): string {
  let pathname: string;
  try {
    const parsed = value.startsWith("http://") || value.startsWith("https://") ? new URL(value) : undefined;
    pathname = parsed ? parsed.pathname : value;
  } catch {
    throw new Error("Browser exploration network path is invalid.");
  }
  if (!pathname.startsWith("/") || pathname.includes("?") || pathname.includes("#") || pathname.length > 240) {
    throw new Error("Browser exploration network path is invalid.");
  }
  return pathname.split("/").map((segment) => {
    if (/^(?:[0-9]{2,}|[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}|[a-f0-9]{24,})$/iu.test(segment)) {
      return ":id";
    }
    return segment;
  }).join("/");
}
