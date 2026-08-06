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

formalCase("OPEN-REG-010", "审核结果短信通知", async (_fixtures, runtime) => {
  await test.step("校验审核状态与通知只读资源", async () => {
    requireReadAuthorization(runtime, "OPEN-REG-010");
  });

  blockForMissingContracts("OPEN-REG-010", [
    "审核状态权威查询契约",
    "测试通知台账查询契约",
    "申请人与接收方安全比较契约"
  ]);
});

formalCase("OPEN-REG-018", "注册联系人默认企业管理员", async (_fixtures, runtime) => {
  await test.step("校验审核通过企业的只读资源", async () => {
    requireReadAuthorization(runtime, "OPEN-REG-018");
  });

  blockForMissingContracts("OPEN-REG-018", [
    "权威提交记录查询契约",
    "管理员台账查询契约",
    "联系人和管理员账号安全比较契约"
  ]);
});

formalCase("OPEN-REG-019", "企业信息审核在 1–2 个工作日内完成", async (_fixtures, runtime) => {
  await test.step("校验已完成审核资源", async () => {
    requireReadAuthorization(runtime, "OPEN-REG-019");
  });

  blockForMissingContracts("OPEN-REG-019", [
    "权威提交与审核完成时间查询契约",
    "服务时区、工作日历和截止时刻契约"
  ]);
});

formalCase("OPEN-REG-020", "审核通过后额外发送平台账号密码通知", async (_fixtures, runtime) => {
  await test.step("校验审核通过企业资源", async () => {
    requireReadAuthorization(runtime, "OPEN-REG-020");
  });

  blockForMissingContracts("OPEN-REG-020", [
    "安全通知类型和模板元数据查询契约",
    "审核通知与凭据通知区分契约",
    "申请人与接收方安全比较契约"
  ]);
});

formalCase("OPEN-REG-021", "审核不通过后按反馈重新申请", async (_fixtures, runtime) => {
  await test.step("校验驳回申请资源和已确认操作", async () => {
    requireRuntimeScope(runtime, "OPEN-REG-021");
    if (runtime.snapshot.dataWritePolicy !== "tracked_residual") {
      throw new FormalBlockedError(
        "OPEN-REG-021 blocked: this case requires an independently reviewed tracked_residual "
        + "authorization and cannot run under the shared managed_cleanup policy."
      );
    }
    requireAllowedOperations(runtime, "OPEN-REG-021", [
      "submit_registration",
      "query_postcondition",
      "retain_tracked_residual"
    ]);
  });

  throw new FormalBlockedError(
    "OPEN-REG-021 blocked: the reviewed implementation still lacks rejection control, exact reconciliation, "
    + "and residual ownership contracts. No reapplication intent is reserved."
  );
});

formalCase("OPEN-REG-023", "同一企业恰有一个企业管理员账号", async (_fixtures, runtime) => {
  await test.step("校验同企业身份映射资源", async () => {
    requireReadAuthorization(runtime, "OPEN-REG-023");
  });

  blockForMissingContracts("OPEN-REG-023", [
    "管理员台账只读查询契约",
    "角色标识契约",
    "同企业身份映射安全比较契约"
  ]);
});

formalCase("OPEN-REG-026", "登录后企业组名称与提交企业名称一致", async (_fixtures, runtime) => {
  await test.step("校验已审批企业、认证会话和只读授权", async () => {
    requireReadAuthorization(runtime, "OPEN-REG-026");
  });

  blockForMissingContracts("OPEN-REG-026", [
    "已审批企业认证会话契约",
    "提交企业名称权威查询契约",
    "企业组名称稳定页面语义契约"
  ]);
});

function requireReadAuthorization(runtime: FormalCaseRuntime, caseId: string): void {
  requireRuntimeScope(runtime, caseId);
  requireAllowedOperations(runtime, caseId, ["query_postcondition"]);
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
    + "no sensitive value is read and no remote operation is attempted."
  );
}
