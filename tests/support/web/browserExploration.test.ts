import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  createBrowserExplorationEvidence,
  evaluateBrowserExplorationEligibility,
  loadBrowserExplorationPolicy,
  validateBrowserExplorationPolicy
} from "../../../src/support/web/browserExploration.js";
import {
  ensureLocalHostConfig,
  inspectLocalHostConfig,
  removeLocalHostConfig
} from "../../../src/support/web/browserExplorationHostConfig.js";

const root = resolve(import.meta.dirname, "../../..");

test("browser exploration policy pins the MCP version and exposes only approved read-only tools", async () => {
  const policy = await loadBrowserExplorationPolicy(root);
  assert.equal(policy.package, "chrome-devtools-mcp@1.6.0");
  assert.deepEqual(policy.allowedTools, [
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
  for (const forbidden of ["click", "fill", "evaluate_script", "get_network_request", "upload_file"]) {
    assert.ok(policy.forbiddenTools.includes(forbidden));
    assert.ok(!policy.allowedTools.includes(forbidden));
  }
  assert.throws(() => validateBrowserExplorationPolicy({ ...policy, package: "chrome-devtools-mcp@latest" } as never));
});

test("browser exploration eligibility is limited to non-production unauthenticated web and h5", () => {
  const base = {
    environment: "test",
    hostConfigured: true,
    nodeVersion: "22.12.0",
    authenticatedStateConfigured: false
  };
  assert.equal(evaluateBrowserExplorationEligibility({ ...base, requestId: "web/open-platform/register" }).status, "eligible");
  assert.equal(evaluateBrowserExplorationEligibility({ ...base, requestId: "h5/open-platform/register" }).status, "eligible");
  assert.deepEqual(
    evaluateBrowserExplorationEligibility({ ...base, requestId: "web/open-platform/register", environment: "prod" }).reasonCodes,
    ["production_forbidden"]
  );
  assert.deepEqual(
    evaluateBrowserExplorationEligibility({ ...base, requestId: "webview/open-platform/register" }).reasonCodes,
    ["unsupported_capability"]
  );
  assert.deepEqual(
    evaluateBrowserExplorationEligibility({ ...base, requestId: "web/open-platform/register", hostConfigured: false }).reasonCodes,
    ["host_adapter_not_configured"]
  );
  assert.deepEqual(
    evaluateBrowserExplorationEligibility({ ...base, requestId: "web/open-platform/register", authenticatedStateConfigured: true }).reasonCodes,
    ["authenticated_state_not_supported"]
  );
});

test("browser exploration evidence keeps only sanitized candidate observations", () => {
  const evidence = createBrowserExplorationEvidence({
    schemaVersion: "browser-exploration-evidence-v1",
    adapter: "chrome_devtools_mcp",
    adapterVersion: "1.6.0",
    subjectDigest: "a".repeat(64),
    outcome: "observed",
    environment: "test",
    routeState: "registration_initial",
    locale: "zh-CN",
    role: "anonymous",
    caseIds: ["CASE-002", "CASE-001"],
    candidateLocators: [{ strategy: "role", value: "button:提交注册" }],
    ariaSummary: [{ role: "form", name: "企业注册" }],
    networkSummary: [{ method: "get", path: "https://example.test/api/items/123456?token=never", status: 200 }],
    consoleSummary: [{ category: "page_error", count: 1 }],
    reachableBoundary: "registration_form_visible",
    blockedMutationCounts: { post: 2 },
    unresolved: ["otp_delivery"]
  });
  assert.deepEqual(evidence.caseIds, ["CASE-001", "CASE-002"]);
  assert.equal(evidence.networkSummary[0]?.path, "/api/items/:id");
  assert.equal(evidence.blockedMutationCounts.POST, 2);
  assert.throws(() => createBrowserExplorationEvidence({
    ...evidence,
    candidateLocators: [{ strategy: "text", value: "Bearer secret-value" }]
  }), /sensitive-looking/);
});

test("local host setup is idempotent and never overwrites unmanaged configuration", async (context) => {
  const sandbox = await mkdtemp(resolve(tmpdir(), "browser-exploration-host-config-"));
  context.after(() => rm(sandbox, { recursive: true, force: true }));
  await mkdir(resolve(sandbox, "config/browser-exploration"), { recursive: true });
  await writeFile(
    resolve(sandbox, "config/browser-exploration/chrome-devtools-mcp-policy.json"),
    await readFile(resolve(root, "config/browser-exploration/chrome-devtools-mcp-policy.json"), "utf8")
  );
  assert.equal(await inspectLocalHostConfig(sandbox), "not_configured");
  assert.equal(await ensureLocalHostConfig(sandbox), "created");
  assert.equal(await inspectLocalHostConfig(sandbox), "configured");
  assert.equal(await ensureLocalHostConfig(sandbox), "unchanged");
  assert.equal(await removeLocalHostConfig(sandbox), true);
  await mkdir(resolve(sandbox, ".codex"), { recursive: true });
  await writeFile(resolve(sandbox, ".codex/config.toml"), "model = \"local\"\n");
  await assert.rejects(ensureLocalHostConfig(sandbox), /refusing to overwrite/);
  await assert.rejects(removeLocalHostConfig(sandbox), /Refusing to remove/);
});
