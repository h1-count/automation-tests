import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { defineFormalExecutionManifest } from "../../../src/support/formal-execution/manifest.js";
import {
  assertFormalBuildAuthorizationCompatibility,
  resolveSelectorBuildIdentity,
  verifyFrozenBuildIdentity
} from "../../../src/support/formal-execution/selectorBuildIdentity.js";
import type {
  FormalBusinessOracleAuthority,
  FormalBusinessOracleObservationKind,
  FormalExecutionManifest
} from "../../../src/support/formal-execution/types.js";

const requestId = "web/example/source-authority";
const caseId = "SRC-CASE-001";
const oracleId = "oracle-source-001";
const ruleRef = "RULE-SRC-001";
const requirementId = "REQ-SRC-001";
const materialId = "example-requirement";
const sectionId = "source-behavior";
const targetBuildDigest = "b".repeat(64);

interface FixtureOptions {
  authority?: "registered_source" | "formal_user_decision";
  includePostconditionOracle?: boolean;
  observationKind?: FormalBusinessOracleObservationKind;
  operationFinality?: "accepted" | "final";
  responseContractFinality?: "accepted" | "final";
  sourceAuthorityDigest?: string;
}

async function createFixture(options: FixtureOptions = {}): Promise<{
  root: string;
  manifest: FormalExecutionManifest;
  sourceContractPath: string;
  nestedSourcePath: string;
  planPath: string;
}> {
  const root = await mkdtemp(resolve(tmpdir(), "formal-source-contract-"));
  const sourceContent = Buffer.from("reviewed business source", "utf8");
  const sourceDigest = sha256(sourceContent);
  const authorityDigest = options.sourceAuthorityDigest ?? sourceDigest;
  const nestedContent = Buffer.from("export const oracle = true;\n", "utf8");
  const nestedDigest = sha256(nestedContent);
  const authorityKind = options.authority ?? "registered_source";
  const observationKind = options.observationKind ?? "dom";
  const operationFinality = options.operationFinality ?? "final";
  const includePostconditionOracle = options.includePostconditionOracle ?? false;
  const requiresPostconditionQuery = observationKind === "browser_response"
    && operationFinality === "accepted";
  const queryCapabilityId = "query-contract-v1";
  const postconditionOracleId = `${oracleId}-postcondition`;
  const decisionDigest = "d".repeat(64);
  const decisionType = "business-rule";
  const authority: FormalBusinessOracleAuthority = authorityKind === "registered_source"
    ? {
        kind: "registered_source",
        materialId,
        sectionId,
        sourceSha256: authorityDigest
      }
    : {
        kind: "formal_user_decision",
        decisionType,
        subjectDigest: decisionDigest
      };

  await mkdir(resolve(root, "contracts"), { recursive: true });
  await mkdir(resolve(root, "implementation"), { recursive: true });
  await mkdir(resolve(root, "sources/requirements"), { recursive: true });
  await mkdir(resolve(root, "sources/indexes"), { recursive: true });
  await mkdir(resolve(root, `testcases/${requestId}`), { recursive: true });
  const nestedSourcePath = resolve(root, "implementation/oracle.ts");
  await writeFile(nestedSourcePath, nestedContent);
  await writeFile(resolve(root, "sources/requirements/source.txt"), sourceContent);
  await writeFile(resolve(root, "sources/manifest.yaml"), `version: 3
knowledge_indexes:
  - id: example-index
    project: example
    path: indexes/example.yaml
    status: reviewed
    covered_material_ids: [${materialId}]
materials:
  - id: ${materialId}
    path: requirements/source.txt
    applicable_projects: [example]
    status: active
`);
  await writeFile(resolve(root, "sources/indexes/example.yaml"), `project: example
index_status: reviewed
documents:
  - material_id: ${materialId}
    source_path: requirements/source.txt
    source_sha256: ${sourceDigest}
    sections:
      - section_id: ${sectionId}
`);

  const planPath = resolve(root, `testcases/${requestId}/plan.md`);
  await writeFile(planPath, plan(decisionType, decisionDigest));
  await writeFile(
    resolve(root, `testcases/${requestId}/cases-source.md`),
    testcasePackage(authorityDigest)
  );

  const sourceContractAuthority = authority.kind === "registered_source"
    ? {
        ...authority,
        sourceFiles: [{ path: "implementation/oracle.ts", sha256: nestedDigest }]
      }
    : authority;
  const sourceContract = {
    schemaVersion: "source-contract-evidence-v3",
    requestId,
    projectId: "example",
    targetBuildDigest,
    contracts: [
      {
        caseId,
        oracleId,
        ruleRef,
        observationKind,
        authorities: [sourceContractAuthority]
      },
      ...(includePostconditionOracle ? [{
        caseId,
        oracleId: postconditionOracleId,
        ruleRef,
        observationKind: "postcondition_query",
        authorities: [sourceContractAuthority]
      }] : [])
    ]
  };
  const sourceContractPath = resolve(root, "contracts/source.json");
  const sourceContractContent = JSON.stringify(sourceContract);
  await writeFile(sourceContractPath, sourceContractContent);

  const buildEvidence: NonNullable<FormalExecutionManifest["buildEvidence"]> = [{
    kind: "source_contract",
    path: "contracts/source.json",
    sha256: sha256(Buffer.from(sourceContractContent, "utf8"))
  }];
  if (observationKind === "browser_response") {
    const responseContract = JSON.stringify({
      schemaVersion: "browser-response-contract-evidence-v1",
      requestId,
      targetBuildDigest,
      contracts: [{
        id: "response-contract-v1",
        finality: options.responseContractFinality ?? "final"
      }]
    });
    await writeFile(resolve(root, "contracts/browser.json"), responseContract);
    buildEvidence.push({
      kind: "browser_response_contract",
      path: "contracts/browser.json",
      sha256: sha256(Buffer.from(responseContract, "utf8"))
    });
  }
  const operationEvidence = observationKind === "browser_response"
    ? [{
        operation: "authenticate_test_account" as const,
        strategy: operationFinality === "accepted"
          ? "response_then_query" as const
          : "response_contract" as const,
        responseContractId: "response-contract-v1",
        ...(operationFinality === "accepted" ? { queryCapabilityId } : {}),
        finality: operationFinality,
        stableIdentityRequired: false
      }]
    : undefined;
  const businessOracles: NonNullable<FormalExecutionManifest["cases"][number]["businessOracles"]> = [{
    oracleId,
    ruleRef,
    observationKind,
    ...(observationKind === "browser_response"
      ? { contractId: "response-contract-v1" }
      : {}),
    authorities: [authority]
  }];
  if (includePostconditionOracle) {
    businessOracles.push({
      oracleId: postconditionOracleId,
      ruleRef,
      observationKind: "postcondition_query",
      contractId: queryCapabilityId,
      authorities: [authority]
    });
  }
  const manifest: FormalExecutionManifest = {
    schemaVersion: "formal-execution-manifest-v3",
    requestId,
    projectId: "example",
    environment: "test",
    buildEvidence,
    capabilities: requiresPostconditionQuery ? [{
      id: queryCapabilityId,
      requiredForCaseIds: [caseId],
      source: {
        kind: "environment",
        variable: "FORMAL_QUERY_CONTRACT_READY",
        pattern: "^ready$"
      },
      unavailableReason: "Postcondition query contract is unavailable.",
      unblockCondition: "Provide the isolated postcondition query capability."
    }] : [],
    cases: [{
      caseId,
      title: "source authority",
      requiredCapabilities: requiresPostconditionQuery ? [queryCapabilityId] : [],
      requiredResources: [],
      producesResources: [],
      permissionProfile: "read_only",
      requiredOperations: observationKind === "browser_response"
        ? ["authenticate_test_account"]
        : [],
      operationBudgets: observationKind === "browser_response"
        ? [{ operation: "authenticate_test_account", maxExecutions: 1 }]
        : [],
      dataWritePolicy: "no_write",
      implementation: { status: "source_complete" },
      businessOracles,
      ...(operationEvidence ? { operationEvidence } : {})
    }]
  };
  return { root, manifest, sourceContractPath, nestedSourcePath, planPath };
}

test("v3 source authority verifies registry, rule design, testcase source and frozen identity", async () => {
  const fixture = await createFixture();
  try {
    assert.doesNotThrow(() => defineFormalExecutionManifest(fixture.manifest));
    const identity = await resolveSelectorBuildIdentity({
      manifest: fixture.manifest,
      workspaceRoot: fixture.root
    });
    assert.equal(identity.targetBuildDigest, targetBuildDigest);
    assert.equal(identity.evidenceDigests.length, 1);
    await assert.doesNotReject(() => verifyFrozenBuildIdentity({
      manifest: fixture.manifest,
      workspaceRoot: fixture.root,
      targetBuildDigest,
      selectorEvidenceDigests: [...identity.evidenceDigests, ...identity.evidenceDigests]
    }));
    await assert.rejects(() => verifyFrozenBuildIdentity({
      manifest: fixture.manifest,
      workspaceRoot: fixture.root,
      targetBuildDigest,
      selectorEvidenceDigests: []
    }), /Frozen build identity verification failed.*frozen selector evidence digests/u);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("v3 formal execution rejects a legacy pre-readiness authorization", async () => {
  const fixture = await createFixture();
  try {
    assert.throws(
      () => assertFormalBuildAuthorizationCompatibility({
        manifest: fixture.manifest,
        authorizationSchemaVersion: "execution-authorization-v2"
      }),
      /requires a readiness-bound execution authorization/u
    );
    assert.doesNotThrow(() => assertFormalBuildAuthorizationCompatibility({
      manifest: fixture.manifest,
      authorizationSchemaVersion: "execution-authorization-v3"
    }));
    assert.doesNotThrow(() => assertFormalBuildAuthorizationCompatibility({
      manifest: fixture.manifest,
      authorizationSchemaVersion: "execution-authorization-v4"
    }));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("v3 build evidence enforces explicit content SHA and kind/schema identity", async () => {
  const fixture = await createFixture();
  try {
    const missingDigest = structuredClone(fixture.manifest);
    delete missingDigest.buildEvidence?.[0]?.sha256;
    assert.throws(
      () => defineFormalExecutionManifest(missingDigest),
      /contains invalid build evidence/u
    );

    const incompatible = JSON.stringify({
      schemaVersion: "selector-contract-evidence-v1",
      requestId,
      targetBuildDigest
    });
    await writeFile(fixture.sourceContractPath, incompatible);
    fixture.manifest.buildEvidence![0]!.sha256 = sha256(Buffer.from(incompatible, "utf8"));
    await assert.rejects(
      resolveSelectorBuildIdentity({ manifest: fixture.manifest, workspaceRoot: fixture.root }),
      /kind source_contract does not accept schema selector-contract-evidence-v1/u
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("v3 build evidence rejects a top-level symlink that escapes the workspace", async () => {
  const fixture = await createFixture();
  const outside = await mkdtemp(resolve(tmpdir(), "formal-source-contract-outside-"));
  try {
    const outsideContract = resolve(outside, "source.json");
    const current = await readFile(fixture.sourceContractPath);
    await writeFile(outsideContract, current);
    await rm(fixture.sourceContractPath);
    await symlink(outsideContract, fixture.sourceContractPath);
    await assert.rejects(
      resolveSelectorBuildIdentity({ manifest: fixture.manifest, workspaceRoot: fixture.root }),
      /resolves outside the workspace/u
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("v3 source authority rejects registered-source, nested-file and plan/package drift", async () => {
  const wrongAuthority = await createFixture({ sourceAuthorityDigest: "f".repeat(64) });
  try {
    await assert.rejects(
      resolveSelectorBuildIdentity({ manifest: wrongAuthority.manifest, workspaceRoot: wrongAuthority.root }),
      /digest differs from its oracle authority/u
    );
  } finally {
    await rm(wrongAuthority.root, { recursive: true, force: true });
  }

  const nestedDrift = await createFixture();
  try {
    await writeFile(nestedDrift.nestedSourcePath, "drifted implementation");
    await assert.rejects(
      resolveSelectorBuildIdentity({ manifest: nestedDrift.manifest, workspaceRoot: nestedDrift.root }),
      /source file digest differs from actual bytes/u
    );
  } finally {
    await rm(nestedDrift.root, { recursive: true, force: true });
  }

  const planDrift = await createFixture();
  try {
    const current = await readFile(planDrift.planPath, "utf8");
    await writeFile(planDrift.planPath, current.replace(caseId, "SRC-CASE-999"));
    await assert.rejects(
      resolveSelectorBuildIdentity({ manifest: planDrift.manifest, workspaceRoot: planDrift.root }),
      /invalid plan\/package relations|does not map/u
    );
  } finally {
    await rm(planDrift.root, { recursive: true, force: true });
  }
});

test("formal user-decision authority requires an accepted plan row", async () => {
  const fixture = await createFixture({ authority: "formal_user_decision" });
  try {
    await assert.doesNotReject(
      resolveSelectorBuildIdentity({ manifest: fixture.manifest, workspaceRoot: fixture.root })
    );
    const unsafeDecisionType = structuredClone(fixture.manifest);
    const unsafeAuthority = unsafeDecisionType.cases[0]!.businessOracles![0]!.authorities[0]!;
    if (unsafeAuthority.kind !== "formal_user_decision") {
      throw new Error("Expected a formal user decision test authority.");
    }
    unsafeAuthority.decisionType = "业务裁决";
    assert.throws(
      () => defineFormalExecutionManifest(unsafeDecisionType),
      /invalid formal user decision authority/u
    );
    const current = await readFile(fixture.planPath, "utf8");
    await writeFile(fixture.planPath, current.replace("| accepted |", "| rejected |"));
    await assert.rejects(
      resolveSelectorBuildIdentity({ manifest: fixture.manifest, workspaceRoot: fixture.root }),
      /requires exactly one accepted business-rule decision/u
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("formal user-decision authority rejects duplicate accepted plan rows", async () => {
  const fixture = await createFixture({ authority: "formal_user_decision" });
  try {
    const current = await readFile(fixture.planPath, "utf8");
    const decisionRow = `| business-rule | \`${"d".repeat(64)}\` | accepted | source behavior | continue |`;
    await writeFile(fixture.planPath, current.replace(decisionRow, `${decisionRow}\n${decisionRow}`));
    await assert.rejects(
      resolveSelectorBuildIdentity({ manifest: fixture.manifest, workspaceRoot: fixture.root }),
      /requires exactly one accepted business-rule decision/u
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("browser response finality rejects frozen accepted with operation final", async () => {
  const fixture = await createFixture({
    observationKind: "browser_response",
    operationFinality: "final",
    responseContractFinality: "accepted"
  });
  try {
    assert.doesNotThrow(() => defineFormalExecutionManifest(fixture.manifest));
    await assert.rejects(
      resolveSelectorBuildIdentity({ manifest: fixture.manifest, workspaceRoot: fixture.root }),
      /frozen browser response finality accepted differs from operation finality final/u
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("browser response finality rejects frozen final with operation accepted", async () => {
  const fixture = await createFixture({
    observationKind: "browser_response",
    operationFinality: "accepted",
    responseContractFinality: "final"
  });
  try {
    assert.doesNotThrow(() => defineFormalExecutionManifest(fixture.manifest));
    await assert.rejects(
      resolveSelectorBuildIdentity({ manifest: fixture.manifest, workspaceRoot: fixture.root }),
      /frozen browser response finality final differs from operation finality accepted/u
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("accepted browser response requires its operation postcondition oracle", async () => {
  const fixture = await createFixture({
    observationKind: "browser_response",
    operationFinality: "accepted",
    responseContractFinality: "accepted"
  });
  try {
    assert.doesNotThrow(() => defineFormalExecutionManifest(fixture.manifest));
    await assert.rejects(
      resolveSelectorBuildIdentity({ manifest: fixture.manifest, workspaceRoot: fixture.root }),
      /accepted browser response response-contract-v1 requires exactly one matching postcondition_query oracle/u
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("accepted browser response with its operation postcondition oracle is valid", async () => {
  const fixture = await createFixture({
    observationKind: "browser_response",
    operationFinality: "accepted",
    responseContractFinality: "accepted",
    includePostconditionOracle: true
  });
  try {
    assert.doesNotThrow(() => defineFormalExecutionManifest(fixture.manifest));
    await assert.doesNotReject(
      resolveSelectorBuildIdentity({ manifest: fixture.manifest, workspaceRoot: fixture.root })
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("final browser response contract satisfies the static oracle binding", async () => {
  const fixture = await createFixture({
    observationKind: "browser_response",
    operationFinality: "final",
    responseContractFinality: "final"
  });
  try {
    assert.doesNotThrow(() => defineFormalExecutionManifest(fixture.manifest));
    await assert.doesNotReject(
      resolveSelectorBuildIdentity({ manifest: fixture.manifest, workspaceRoot: fixture.root })
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("browser response oracle cannot omit its frozen response contract binding", async () => {
  const fixture = await createFixture({ observationKind: "browser_response" });
  try {
    delete fixture.manifest.cases[0]!.businessOracles![0]!.contractId;
    assert.throws(
      () => defineFormalExecutionManifest(fixture.manifest),
      /browser_response requires a response contractId/u
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("postcondition oracle must bind a declared query capability contract", async () => {
  const fixture = await createFixture();
  try {
    const oracle = fixture.manifest.cases[0]!.businessOracles![0]!;
    oracle.observationKind = "postcondition_query";
    assert.throws(
      () => defineFormalExecutionManifest(fixture.manifest),
      /postcondition_query requires a query contractId/u
    );
    oracle.contractId = "missing-query-contract";
    assert.throws(
      () => defineFormalExecutionManifest(fixture.manifest),
      /postcondition_query contractId must match exactly one queryCapabilityId/u
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

function plan(decisionType: string, decisionDigest: string): string {
  return `# Plan

## 正式用户决定

| 决定类型 | subjectDigest | 正式决定 | 决定内容与适用范围 | 后续处理 |
| --- | --- | --- | --- | --- |
| ${decisionType} | \`${decisionDigest}\` | accepted | source behavior | continue |

## 需求追溯矩阵

| REQ | 需求 |
| --- | --- |
| ${requirementId} | source behavior |

## 规则覆盖台账

| RULE | REQ | 规则 | 类型 | 来源 | 决策 | 边界 | 适用性 | 风险 | caseId |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ${ruleRef} | ${requirementId} | source rule | 业务规则 | registered | yes | exact | 适用 | low | ${caseId} |

## 规则设计矩阵

结构版本：rule-design-matrix-v1

| RULE | 字段/状态 | 必填性 | 输入 | 可观察预期 | 数据前置 | 执行门禁 | 关联 caseId | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ${ruleRef} | source state | 必填 | reviewed value | 页面显示已审核值且状态保持稳定 | 合成只读数据 | test 环境 | ${caseId} | 已覆盖 |
`;
}

function testcasePackage(sourceDigest: string): string {
  return `# Cases

## 测试用例：source behavior

## 基本信息

| 项目 | 内容 |
| --- | --- |
| 用例编号 | ${caseId} |
| 需求追溯编号 | ${requirementId} |
| 规则覆盖编号 | ${ruleRef} |

## 来源

| 资料类型 | 路径或链接 | 版本/说明 |
| --- | --- | --- |
| 需求文档 | source.txt | manifest \`${materialId}\`；sectionId \`${sectionId}\`；SHA-256 \`${sourceDigest}\` |
`;
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}
