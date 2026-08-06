import type { ExecutionOperationKind } from "../../../../src/support/formal-execution/authorization.js";
import {
  configureFormalSuite,
  FormalBlockedError,
  formalCase,
  formalSuite as test
} from "../../../../src/support/formal-execution/formalCase.js";
import type { FormalCaseRuntime } from "../../../../src/support/formal-execution/types.js";
import { formalExecutionManifest } from "./execution.manifest.js";

configureFormalSuite(formalExecutionManifest);

const REQUEST_ID = "web/open-platform/account-access-20260729-2";
const ENVIRONMENT = "test";
const CUSTOM_RESOURCE_TYPE = "custom" as const;
const REGISTRATION_CLEANUP_ACTION = "open-platform-registration-application-cleanup-v1";
const UPLOAD_CLEANUP_ACTION = "open-platform-synthetic-upload-cleanup-v1";

formalCase("OPEN-REG-008", "注册提交条件组合阻断", async (_fixtures, runtime) => {
  await test.step("校验五行参数的正式授权、命名资源和清理能力", async () => {
    requireManagedCleanupAuthorization(runtime, "OPEN-REG-008", {
      operations: [
        "send_test_otp",
        "upload_synthetic_file",
        "accept_agreement",
        "submit_registration",
        "query_postcondition",
        "cleanup_test_resource"
      ],
      minimumCustomCreates: 9,
      cleanupActionIds: [REGISTRATION_CLEANUP_ACTION, UPLOAD_CLEANUP_ACTION]
    });
  });

  blockForMissingContracts("OPEN-REG-008", [
    "五行单变量注册表操作契约",
    "受控 OTP 测试通道",
    "合成证照上传契约",
    "申请精确后置查询契约"
  ]);
});

formalCase("OPEN-REG-009", "合成企业申请受控提交与后置核对", async (_fixtures, runtime) => {
  await test.step("校验单次 OTP、上传、提交的正式授权和清理能力", async () => {
    requireManagedCleanupAuthorization(runtime, "OPEN-REG-009", {
      operations: [
        "send_test_otp",
        "upload_synthetic_file",
        "accept_agreement",
        "submit_registration",
        "query_postcondition",
        "cleanup_test_resource"
      ],
      minimumCustomCreates: 2,
      cleanupActionIds: [REGISTRATION_CLEANUP_ACTION, UPLOAD_CLEANUP_ACTION]
    });
  });

  blockForMissingContracts("OPEN-REG-009", [
    "受控 OTP 测试通道",
    "合成证照上传契约",
    "注册提交契约",
    "申请精确后置查询契约"
  ]);
});

formalCase("OPEN-REG-015", "同一手机号可申请不同企业", async (_fixtures, runtime) => {
  await test.step("校验第二企业路径的正式授权、前置资源和清理能力", async () => {
    requireManagedCleanupAuthorization(runtime, "OPEN-REG-015", {
      operations: [
        "send_test_otp",
        "upload_synthetic_file",
        "accept_agreement",
        "submit_registration",
        "query_postcondition",
        "cleanup_test_resource"
      ],
      minimumCustomCreates: 2,
      cleanupActionIds: [REGISTRATION_CLEANUP_ACTION, UPLOAD_CLEANUP_ACTION]
    });
  });

  blockForMissingContracts("OPEN-REG-015", [
    "同手机号第二企业的受控 OTP 契约",
    "合成证照上传契约",
    "第二企业注册提交契约",
    "申请唯一性后置查询契约"
  ]);
});

formalCase("OPEN-REG-017", "已提交企业名称和地址权威值基线核对", async (_fixtures, runtime) => {
  await test.step("校验只读授权和已提交企业资源", async () => {
    requireRuntimeScope(runtime, "OPEN-REG-017");
    requireAllowedOperations(runtime, "OPEN-REG-017", ["query_postcondition"]);
  });

  blockForMissingContracts("OPEN-REG-017", [
    "已提交企业名称和地址的权威只读查询契约"
  ]);
});

formalCase("OPEN-REG-022", "已提交企业名称更新不生效且权威值不变", async (_fixtures, runtime) => {
  await test.step("校验基线资源并拒绝无法精确授权的更新动作", async () => {
    requireRuntimeScope(runtime, "OPEN-REG-022");
    requireAllowedOperations(runtime, "OPEN-REG-022", ["query_postcondition"]);
  });

  throw new FormalBlockedError(
    "OPEN-REG-022 blocked: execution authorization has no exact enterprise-name update operation kind; "
    + "the script will not relabel an update as create_test_resource or submit_registration."
  );
});

formalCase("OPEN-REG-024", "已提交企业地址更新不生效且权威值不变", async (_fixtures, runtime) => {
  await test.step("校验基线资源并拒绝无法精确授权的更新动作", async () => {
    requireRuntimeScope(runtime, "OPEN-REG-024");
    requireAllowedOperations(runtime, "OPEN-REG-024", ["query_postcondition"]);
  });

  throw new FormalBlockedError(
    "OPEN-REG-024 blocked: execution authorization has no exact enterprise-address update operation kind; "
    + "the script will not relabel an update as create_test_resource or submit_registration."
  );
});

interface ManagedCleanupRequirement {
  operations: ExecutionOperationKind[];
  minimumCustomCreates: number;
  cleanupActionIds: string[];
}

function requireManagedCleanupAuthorization(
  runtime: FormalCaseRuntime,
  caseId: string,
  requirement: ManagedCleanupRequirement
): void {
  requireRuntimeScope(runtime, caseId);
  requireAllowedOperations(runtime, caseId, requirement.operations);
  if (runtime.snapshot.dataWritePolicy !== "managed_cleanup") {
    throw new FormalBlockedError(
      `${caseId} blocked: expected managed_cleanup but authorization uses ${runtime.snapshot.dataWritePolicy}.`
    );
  }
  const budget = runtime.snapshot.resourceBudgets
    .find((item) => item.resourceType === CUSTOM_RESOURCE_TYPE)?.maxCreates ?? 0;
  if (budget < requirement.minimumCustomCreates) {
    throw new FormalBlockedError(
      `${caseId} blocked: custom resource budget ${budget} is below the safe minimum `
      + `${requirement.minimumCustomCreates}.`
    );
  }
  for (const actionId of requirement.cleanupActionIds) {
    const action = runtime.manager.registry.get(actionId, CUSTOM_RESOURCE_TYPE);
    if (!action?.idempotent) {
      throw new FormalBlockedError(
        `${caseId} blocked: idempotent cleanup contract ${actionId} is not registered.`
      );
    }
  }
}

function requireRuntimeScope(runtime: FormalCaseRuntime, caseId: string): void {
  if (
    runtime.snapshot.requestId !== REQUEST_ID
    || runtime.snapshot.environment !== ENVIRONMENT
    || !runtime.snapshot.caseIds.includes(caseId)
  ) {
    throw new FormalBlockedError(`${caseId} blocked: immutable request, environment, or case scope differs.`);
  }
}

function requireAllowedOperations(
  runtime: FormalCaseRuntime,
  caseId: string,
  operations: ExecutionOperationKind[]
): void {
  const missing = operations.filter((operation) => !runtime.snapshot.allowedOperations.includes(operation));
  if (missing.length > 0) {
    throw new FormalBlockedError(
      `${caseId} blocked: immutable authorization does not allow ${missing.join(", ")}.`
    );
  }
}

function blockForMissingContracts(caseId: string, contracts: string[]): never {
  throw new FormalBlockedError(
    `${caseId} blocked: reviewed implementation is missing ${contracts.join("、")}; `
    + "no intent is reserved and no remote operation is attempted."
  );
}
