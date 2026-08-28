import assert from "node:assert/strict";
import test from "node:test";
import {
  assertFormalWebSpecMatchesFrozenScope,
  parseFormalWebScriptSpec,
  renderFormalWebScriptBundle,
  type FormalWebAction,
  type FormalWebScriptSpec
} from "../../../src/support/formal-execution/webScriptCompiler.js";
import { inspectFormalSpecSource } from "../../../src/support/formal-execution/sourceGate.js";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { prepareOpenPlatformRegistrationUploadAssets } from "../../../src/support/test-assets/generatedUploadAssets.js";

const caseIds = [
  "OPEN-NAV-001", "OPEN-NAV-002", "OPEN-LOGIN-001", "OPEN-LOGIN-002", "OPEN-LOGIN-003", "OPEN-LOGIN-004", "OPEN-LOGIN-005",
  "OPEN-REG-001", "OPEN-REG-002", "OPEN-REG-003", "OPEN-REG-004", "OPEN-REG-005", "OPEN-REG-006", "OPEN-REG-007",
  "OPEN-REG-008", "OPEN-REG-009", "OPEN-REG-010", "OPEN-REG-011", "OPEN-REG-012", "OPEN-REG-013", "OPEN-REG-014", "OPEN-REG-018"
];

function spec(): FormalWebScriptSpec {
  return {
    schemaVersion: "formal-web-script-spec-v1",
    requestId: "web/open-platform/login-register-20260826-r3",
    suiteId: "web/open-platform/login-register",
    projectId: "open-platform",
    environment: "test",
    selectedCaseIds: caseIds,
    sourceContract: { targetBuildDigest: "a".repeat(64) },
    coveragePlanDigest: "c".repeat(64),
    resourceBudgets: [],
    cases: caseIds.map((caseId) => ({
      caseId,
      title: "验证页面可观察契约",
      route: caseId.startsWith("OPEN-REG") ? "/login?tab=register" : "/login",
      ruleRef: `RULE-${caseId.slice("OPEN-".length)}`,
      permissionProfile: "read_only",
      dataWritePolicy: "no_write",
      requiredOperations: [],
      noWriteNetworkPolicy: {
        reviewedReadOnlyRequests: [],
        forbiddenMutationPaths: ["/registration", "/get/msg/code"]
      },
      steps: [{
        coverageId: `${caseId}#D01-R01`,
        stepId: "D01",
        title: "验证页面可观察契约",
        oracle: {
          oracleId: `ORACLE-${caseId}-D01`,
          observationKind: "dom",
          authorities: [{
            kind: "formal_user_decision",
            decisionType: "confirmed_testcase_set",
            subjectDigest: "b".repeat(64)
          }],
          checks: [{ kind: "role_text", role: "region", name: "开放平台账号访问", text: "开放平台" }]
        },
        actions: [
          { kind: "expect_role_visible", role: "region", name: "开放平台账号访问" },
          { kind: "trial_click_role", role: "tab", name: "登录" }
        ]
      }]
    }))
  };
}

test("Web compiler renders each frozen case as a literal formalCase and literal manifest entries", () => {
  const bundle = renderFormalWebScriptBundle({
    workspaceRoot: "/workspace/automation-tests",
    requestId: "web/open-platform/login-register-20260826-r3",
    spec: spec()
  });
  assert.equal(bundle.staticCaseIds.length, 22);
  assert.equal((bundle.formalSpecSource.match(/\bformalCase\(/g) ?? []).length, 22);
  assert.equal((bundle.manifestSource.match(/\"caseId\":/g) ?? []).length, 22);
  assert.ok(bundle.formalSpecSource.includes('formalCase("OPEN-LOGIN-003"'));
  assert.ok(bundle.formalSpecSource.includes('formalCase("OPEN-LOGIN-004"'));
  assert.ok(bundle.formalSpecSource.includes('formalCase("OPEN-REG-014"'));
  assert.doesNotMatch(bundle.formalSpecSource, /\.map\(|\.forEach\(|\bfor\s*\(/);
  assert.doesNotMatch(bundle.manifestSource, /\.map\(|\.forEach\(|\bfor\s*\(/);
  assert.ok(bundle.artifacts.every((artifact) => artifact.targetPath.startsWith(
    ".local/test-runs/web/open-platform/login-register-20260826-r3/candidate-scripts/"
  )));
  assert.match(bundle.formalSpecSource, /assertNoUnauthorizedWriteRequests/);
  assert.match(bundle.formalSpecSource, /toHaveText\("开放平台"\)/);
});

test("Web compiler rejects no_write without default-deny policy and sensitive data literals", () => {
  const missingPolicy = spec();
  delete missingPolicy.cases[0]!.noWriteNetworkPolicy;
  assert.throws(() => parseFormalWebScriptSpec(missingPolicy), /default-deny network policy/);

  const sensitive = spec();
  sensitive.cases[0]!.steps[0]!.actions = [{
    kind: "fill_role",
    role: "textbox",
    name: "手机号",
    value: { kind: "frozen_data", dataId: "D01", value: "password=unsafe" }
  }];
  assert.throws(() => parseFormalWebScriptSpec(sensitive), /invalid or unauthorized/);
});

test("Web compiler renders field interaction and specific validation oracle", () => {
  const input = spec();
  input.cases[0]!.steps[0]!.actions = [
    { kind: "fill_role", role: "textbox", name: "企业名称", value: { kind: "frozen_data", dataId: "D01", value: "A" } },
    { kind: "blur_role", role: "textbox", name: "企业名称" }
  ];
  input.cases[0]!.steps[0]!.oracle.checks = [{
    kind: "validation_message", role: "alert", name: "企业名称错误", text: "长度不少于 2 个字符"
  }];
  const bundle = renderFormalWebScriptBundle({
    workspaceRoot: "/workspace/automation-tests",
    requestId: input.requestId,
    spec: input
  });
  assert.match(bundle.formalSpecSource, /\.fill\("A"\)/);
  assert.match(bundle.formalSpecSource, /\.blur\(\)/);
  assert.match(bundle.formalSpecSource, /长度不少于 2 个字符/);
});

test("Web compiler rejects a frozen scope omission before rendering", () => {
  const input = spec();
  input.cases.pop();
  assert.throws(() => parseFormalWebScriptSpec(input), /exactly one case entry/);
  assert.throws(() => assertFormalWebSpecMatchesFrozenScope(spec(), {
    requestId: spec().requestId,
    suiteId: spec().suiteId,
    environment: "test",
    selectedCaseIds: caseIds.slice(0, -1)
  }), /scope_mismatch/);
});

test("Web compiler rejects effectful cases without frozen evidence and capacity", () => {
  const input = spec();
  input.cases[0] = {
    ...input.cases[0]!,
    permissionProfile: "test_write",
    dataWritePolicy: "ephemeral_cleanup",
    noWriteNetworkPolicy: undefined,
    requiredOperations: ["submit_registration"],
    steps: [{
      coverageId: "OPEN-NAV-001#D01-R01",
      stepId: "D01",
      title: "提交注册",
      oracle: {
        oracleId: "ORACLE-OPEN-NAV-001-D01",
        observationKind: "browser_response",
        contractId: "API-REG-FINAL",
        authorities: input.cases[0]!.steps[0]!.oracle.authorities,
        checks: [{ kind: "response_status", contractId: "API-REG-FINAL", successStatusCodes: [200, 201] }]
      },
      actions: [
        { kind: "expect_role_visible", role: "form", name: "注册" },
        {
          kind: "click_role", role: "button", name: "提交", operation: "submit_registration",
          response: { method: "POST", path: "/registration", contractId: "API-REG-FINAL", successStatusCodes: [200, 201] }
        }
      ]
    }]
  };
  assert.throws(() => parseFormalWebScriptSpec(input), /operationEvidence/);

  input.cases[0] = {
    ...input.cases[0]!,
    operationEvidence: [{
      operation: "submit_registration",
      strategy: "response_contract",
      responseContractId: "API-REG-FINAL",
      finality: "final",
      stableIdentityRequired: false
    }]
  };
  assert.throws(() => parseFormalWebScriptSpec(input), /positive frozen resource budget/);
  input.resourceBudgets = [{ resourceType: "registration", maxCreates: 1 }];
  assert.doesNotThrow(() => parseFormalWebScriptSpec(input));
});

test("Web compiler carries declared current-run test resources into the manifest and renders UI lifecycle actions", () => {
  const input = spec();
  input.resourceBudgets = [{ resourceType: "product", maxCreates: 1 }];
  input.cases[0] = {
    ...input.cases[0]!,
    permissionProfile: "test_write",
    dataWritePolicy: "ephemeral_cleanup",
    noWriteNetworkPolicy: undefined,
    requiredOperations: ["create_test_resource"],
    producesResources: [{ name: "PRODUCT_ONE", resourceType: "product", disposition: "ephemeral_cleanup" }],
    operationEvidence: [{
      operation: "create_test_resource",
      strategy: "response_contract",
      responseContractId: "API-PRODUCT-CREATE",
      finality: "final",
      stableIdentityRequired: true
    }],
    steps: [{
      ...input.cases[0]!.steps[0]!,
      actions: [
        { kind: "begin_synthetic_create", intentKey: "PRODUCT_CREATE", resourceType: "product", syntheticKey: "PRODUCT_ONE", dataWritePolicy: "ephemeral_cleanup" },
        { kind: "click_role", role: "button", name: "创建产品", operation: "create_test_resource", response: { method: "POST", path: "/products", contractId: "API-PRODUCT-CREATE", successStatusCodes: [200] } },
        { kind: "confirm_synthetic_resource", intentKey: "PRODUCT_CREATE", publishName: "PRODUCT_ONE", identity: { role: "status", name: "产品 PID" } }
      ]
    }]
  };
  input.cases[1] = {
    ...input.cases[1]!,
    permissionProfile: "test_write",
    dataWritePolicy: "ephemeral_cleanup",
    noWriteNetworkPolicy: undefined,
    requiredResources: ["PRODUCT_ONE"],
    requiredOperations: ["cleanup_test_resource"],
    operationEvidence: [{
      operation: "cleanup_test_resource",
      strategy: "response_contract",
      responseContractId: "API-PRODUCT-DELETE",
      finality: "final",
      stableIdentityRequired: true
    }],
    steps: [{
      ...input.cases[1]!.steps[0]!,
      actions: [{ kind: "cleanup_role", resourceName: "PRODUCT_ONE", role: "button", name: "删除产品", response: { method: "DELETE", path: "/products", contractId: "API-PRODUCT-DELETE", successStatusCodes: [200] } }]
    }]
  };

  const bundle = renderFormalWebScriptBundle({ workspaceRoot: "/workspace/automation-tests", requestId: input.requestId, spec: input });
  assert.match(bundle.manifestSource, /"PRODUCT_ONE"/);
  assert.match(bundle.formalSpecSource, /beginSyntheticCreate/);
  assert.match(bundle.formalSpecSource, /confirmSyntheticResource/);
  assert.match(bundle.formalSpecSource, /restoreSyntheticResource/);
});

test("Web compiler rejects writable resources outside test and ephemeral resources without a UI cleanup path", () => {
  const input = spec();
  input.environment = "staging";
  input.resourceBudgets = [{ resourceType: "product", maxCreates: 1 }];
  input.cases[0] = {
    ...input.cases[0]!,
    permissionProfile: "test_write",
    dataWritePolicy: "ephemeral_cleanup",
    noWriteNetworkPolicy: undefined,
    requiredOperations: ["create_test_resource"],
    producesResources: [{ name: "PRODUCT_ONE", resourceType: "product", disposition: "ephemeral_cleanup" }],
    operationEvidence: [{ operation: "create_test_resource", strategy: "response_contract", responseContractId: "API-PRODUCT-CREATE", finality: "final", stableIdentityRequired: true }],
    steps: [{
      ...input.cases[0]!.steps[0]!,
      actions: [
        { kind: "begin_synthetic_create", intentKey: "PRODUCT_CREATE", resourceType: "product", syntheticKey: "PRODUCT_ONE", dataWritePolicy: "ephemeral_cleanup" },
        { kind: "click_role", role: "button", name: "创建产品", operation: "create_test_resource", response: { method: "POST", path: "/products", contractId: "API-PRODUCT-CREATE", successStatusCodes: [200] } },
        { kind: "confirm_synthetic_resource", intentKey: "PRODUCT_CREATE", publishName: "PRODUCT_ONE", identity: { role: "status", name: "产品 PID" } }
      ]
    }]
  };
  assert.throws(() => renderFormalWebScriptBundle({ workspaceRoot: "/workspace/automation-tests", requestId: input.requestId, spec: input }), /no declared UI cleanup action/);
  input.cases[1] = {
    ...input.cases[1]!,
    permissionProfile: "test_write",
    dataWritePolicy: "ephemeral_cleanup",
    noWriteNetworkPolicy: undefined,
    requiredResources: ["PRODUCT_ONE"],
    requiredOperations: ["cleanup_test_resource"],
    operationEvidence: [{ operation: "cleanup_test_resource", strategy: "response_contract", responseContractId: "API-PRODUCT-DELETE", finality: "final", stableIdentityRequired: true }],
    steps: [{
      ...input.cases[1]!.steps[0]!,
      actions: [{ kind: "cleanup_role", resourceName: "PRODUCT_ONE", role: "button", name: "删除产品", response: { method: "DELETE", path: "/products", contractId: "API-PRODUCT-DELETE", successStatusCodes: [200] } }]
    }]
  };
  assert.throws(() => renderFormalWebScriptBundle({ workspaceRoot: "/workspace/automation-tests", requestId: input.requestId, spec: input }), /allowed only in the test environment/);
});

test("Web compiler only accepts a generated upload boundary asset from the current request", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "formal-web-upload-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(resolve(root, "test-assets/documents/open-platform"), { recursive: true });
  await writeFile(
    resolve(root, "test-assets/documents/open-platform/synthetic-business-license.png.b64"),
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=\n"
  );
  const assets = prepareOpenPlatformRegistrationUploadAssets({ workspaceRoot: root, requestId: spec().requestId });
  const overLimit = assets.manifest.assets.find((asset) => asset.assetId === "license-over-limit-png")!;
  const input = spec();
  input.resourceBudgets = [{ resourceType: "synthetic-upload", maxCreates: 1 }];
  input.cases[0] = {
    ...input.cases[0]!,
    permissionProfile: "test_write",
    dataWritePolicy: "tracked_residual",
    noWriteNetworkPolicy: undefined,
    requiredOperations: ["upload_synthetic_file"],
    operationEvidence: [{
      operation: "upload_synthetic_file",
      strategy: "response_contract",
      responseContractId: "API-UPLOAD-LICENSE",
      finality: "final",
      stableIdentityRequired: true
    }],
    steps: [{
      coverageId: "OPEN-NAV-001#D01-R01",
      stepId: "D01",
      title: "上传合成营业执照",
      oracle: {
        oracleId: "ORACLE-OPEN-NAV-001-D01",
        observationKind: "browser_response",
        contractId: "API-UPLOAD-LICENSE",
        authorities: input.cases[0]!.steps[0]!.oracle.authorities,
        checks: [{ kind: "response_status", contractId: "API-UPLOAD-LICENSE", successStatusCodes: [200] }]
      },
      actions: [{
        kind: "set_files_label",
        label: "营业执照",
        asset: {
          kind: "generated_upload_asset",
          assetId: overLimit.assetId,
          assetPath: overLimit.path,
          assetSha256: overLimit.sha256,
          manifestPath: ".local/test-runs/web/open-platform/login-register-20260826-r3/generated-test-assets/manifest.json",
          generatorDigest: assets.manifest.generator.digest
        },
        operation: "upload_synthetic_file",
        response: { method: "POST", path: "/company/file-upload", contractId: "API-UPLOAD-LICENSE", successStatusCodes: [200] }
      }]
    }]
  };
  assert.doesNotThrow(() => renderFormalWebScriptBundle({ workspaceRoot: root, requestId: input.requestId, spec: input }));

  (input.cases[0]!.steps[0]!.actions[0] as Extract<FormalWebAction, { kind: "set_files_label" }>).asset.assetPath =
    ".local/test-runs/web/open-platform/other-request/generated-test-assets/license-over-limit.png";
  assert.throws(() => renderFormalWebScriptBundle({ workspaceRoot: root, requestId: input.requestId, spec: input }), /generated_asset_path_escape|generated_asset_scope_mismatch/);
});

test("formal source gate rejects loop and map based formalCase registration", () => {
  const loop = `
    for (const item of [["OPEN-LOGIN-001", "one"]]) {
      formalCase(item[0], item[1], async ({ page }, runtime) => {
        await page.goto("/login"); runtime.addAssertion("x");
      });
    }
  `;
  const mapped = `
    [["OPEN-LOGIN-001", "one"]].map(([caseId, title]) =>
      formalCase(caseId, title, async ({ page }, runtime) => {
        await page.goto("/login"); runtime.addAssertion("x");
      })
    );
  `;
  assert.match(inspectFormalSpecSource(loop, ["OPEN-LOGIN-001"]).issues.join("\n"), /dynamic_registration/);
  assert.match(inspectFormalSpecSource(mapped, ["OPEN-LOGIN-001"]).issues.join("\n"), /dynamic_registration/);
});

test("formal source gate rejects a generic visibility oracle after field interaction", () => {
  const source = `
    formalCase("OPEN-REG-001", "企业名称", async ({ page }, runtime) => {
      await page.getByRole("textbox", { name: "企业名称" }).fill("A");
      await runtime.verifyBusinessOracle("ORACLE-OPEN-REG-001", async () => {
        await expect(page.getByRole("form", { name: "企业注册申请表单" })).toBeVisible();
      });
    });
  `;
  assert.match(
    inspectFormalSpecSource(source, ["OPEN-REG-001"], { manifestSchemaVersion: "formal-execution-manifest-v1" }).issues.join("\n"),
    /generic_oracle/
  );
});

test("formal Playwright discovery scopes a request to its candidate scripts", async () => {
  const config = await readFile(resolve(import.meta.dirname, "../../../playwright.config.ts"), "utf8");
  assert.match(config, /\.local\/test-runs\/\$\{process\.env\.AUTOMATION_REQUEST_ID/);
  assert.match(config, /testDir: formalLifecycleEnabled \? "\." : "\.\/tests\/web"/);
});

test("Web compiler renders manual-challenge primitives with explicit long timeouts", () => {
  const manual = spec();
  manual.sessionAuthentication = "anonymous";
  const loginCase = manual.cases.find((entry) => entry.caseId === "OPEN-LOGIN-003")!;
  loginCase.steps = [{
    coverageId: "OPEN-LOGIN-003#S01-R01",
    stepId: "S01",
    title: "人工挑战后等待登录落地",
    oracle: {
      oracleId: "ORACLE-OPEN-LOGIN-003-MANUAL",
      observationKind: "dom",
      authorities: [{ kind: "formal_user_decision", decisionType: "confirmed_testcase_set", subjectDigest: "b".repeat(64) }],
      checks: [{ kind: "url", path: "/console/home", timeoutMs: 180_000 }]
    },
    actions: [
      { kind: "expect_role_disabled", role: "button", name: "获取注册短信验证码", timeoutMs: 180_000 },
      { kind: "expect_role_value_pattern", role: "textbox", name: "注册短信验证码", pattern: "^\\d{6}$", timeoutMs: 360_000, message: "请在可见浏览器中输入验证码" },
      { kind: "expect_role_visible", role: "button", nameRef: { kind: "environment", variable: "TEST_OPEN_PLATFORM_CONSOLE_ACCOUNT_LABEL" } },
      { kind: "expect_url", path: "/console/home", timeoutMs: 120_000 }
    ]
  }];
  const bundle = renderFormalWebScriptBundle({
    workspaceRoot: "/workspace/automation-tests",
    requestId: manual.requestId,
    spec: manual
  });
  assert.match(bundle.formalSpecSource, /toBeDisabled\(\{ timeout: 180000 \}\)/);
  assert.match(bundle.formalSpecSource, /expect\.poll\(async \(\) => new RegExp\("\^\\\\d\{6\}\$"\)\.test\(await page\.getByRole\("textbox", \{ name: "注册短信验证码" \}\)\.inputValue\(\)\)/);
  assert.match(bundle.formalSpecSource, /timeout: 360000, message: "请在可见浏览器中输入验证码"/);
  assert.match(bundle.formalSpecSource, /name: requiredEnv\("TEST_OPEN_PLATFORM_CONSOLE_ACCOUNT_LABEL"\)/);
  assert.match(bundle.formalSpecSource, /toHaveURL\(new RegExp\("\/console\/home[^"]*"\), \{ timeout: 120000 \}\)/);
  assert.match(bundle.manifestSource, /"sessionAuthentication": "anonymous"/);
  assert.doesNotMatch(bundle.formalSpecSource, /\.map\(|\.forEach\(|\bfor\s*\(/);
});

test("Web compiler rejects unsafe manual-challenge patterns and ambiguous role names", () => {
  const invalid = spec();
  const target = invalid.cases.find((entry) => entry.caseId === "OPEN-LOGIN-003")!;
  target.steps = [{
    coverageId: "OPEN-LOGIN-003#S01-R01",
    stepId: "S01",
    title: "非法人工原语",
    oracle: {
      oracleId: "ORACLE-OPEN-LOGIN-003-BAD",
      observationKind: "dom",
      authorities: [{ kind: "formal_user_decision", decisionType: "confirmed_testcase_set", subjectDigest: "b".repeat(64) }],
      checks: [{ kind: "role_visible", role: "button", name: "获取验证码" }]
    },
    actions: [
      { kind: "expect_role_value_pattern", role: "textbox", name: "验证码", pattern: "(\\d{6})" }
    ]
  }];
  assert.throws(() => renderFormalWebScriptBundle({ workspaceRoot: "/workspace/automation-tests", requestId: invalid.requestId, spec: invalid }), /invalid or unauthorized/);

  const ambiguous = spec();
  const ambiguousCase = ambiguous.cases.find((entry) => entry.caseId === "OPEN-LOGIN-004")!;
  ambiguousCase.steps = [{
    coverageId: "OPEN-LOGIN-004#S01-R01",
    stepId: "S01",
    title: "名称与名称引用冲突",
    oracle: {
      oracleId: "ORACLE-OPEN-LOGIN-004-BAD",
      observationKind: "dom",
      authorities: [{ kind: "formal_user_decision", decisionType: "confirmed_testcase_set", subjectDigest: "b".repeat(64) }],
      checks: [{ kind: "role_visible", role: "button", name: "退出" }]
    },
    actions: [
      { kind: "expect_role_visible", role: "button", name: "账号", nameRef: { kind: "environment", variable: "TEST_CONSOLE_LABEL" } }
    ]
  }];
  assert.throws(() => renderFormalWebScriptBundle({ workspaceRoot: "/workspace/automation-tests", requestId: ambiguous.requestId, spec: ambiguous }), /invalid or unauthorized/);
});
