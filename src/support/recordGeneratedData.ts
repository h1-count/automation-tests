import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** 仓库根：以本模块自身位置解析，与进程工作目录无关。 */
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

export type GeneratedRegistrationData = {
  runId: number;
  companyName: string;
  companyIdentifier: string;
  companyAddress: string;
  companyEmail: string;
  companyCreditCode: string;
  contactName: string;
  contactPhone: string;
  companyDescription: string;
};

export type GeneratedProductData = {
  runId: number;
  productName: string;
  productModel: string;
  category: string;
  developmentMethod: string;
  deviceType: string;
  description: string;
  /** 创建成功后平台生成的产品 model（企业标识+品类+产品型号）。 */
  assignedProductModel?: string;
};

export type GeneratedMemberData = {
  runId: number;
  memberName: string;
  memberPhone: string;
  memberNotes: string;
  /** 添加成员的目标企业（受限企业）。 */
  companyName: string;
  /** 授予的权限节点（合成值）。 */
  grantedPermissions: string[];
  /** 删除成员成功后回填删除标记（台账只增不删，同 runId 覆盖更新）。 */
  deletedAt?: string;
  /** 重新添加（成员已有账号分支）成功后回填标记。 */
  readdedAt?: string;
};

type RecordOptions = {
  testType: string;
  platform: string;
  feature: string;
  kind: string;
  runId: number;
  /** 完整生成数据，全量明文记录。 */
  payload: object;
};

type StoredRecord = {
  runId: number;
  createdAt: string;
} & Record<string, unknown>;

type FeatureDocument = {
  kind: string;
  platform: string;
  feature: string;
  records: StoredRecord[];
};

/**
 * 测试数据均为合成值（含测试手机号），记录文件明文全量存储：
 * 安全边界是 runtime/ 不提交 Git；密码、验证码、Token、密钥、Cookie 按硬边界禁止入记录。
 */
async function appendRecord(options: RecordOptions): Promise<void> {
  const filePath = join(
    repositoryRoot,
    "testpacks",
    options.testType,
    options.platform,
    options.feature,
    "runtime",
    "generated-data.json"
  );

  const document = await readFeatureDocument(filePath, options);
  const existing = document.records.find((record) => record.runId === options.runId);
  const record: StoredRecord = {
    runId: options.runId,
    createdAt: new Date().toISOString(),
    ...options.payload
  };

  if (existing) {
    // 同一 runId 重复记录时覆盖，保持文档内记录唯一。
    Object.assign(existing, record);
  } else {
    document.records.push(record);
  }

  await mkdir(join(filePath, ".."), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

async function readFeatureDocument(filePath: string, options: RecordOptions): Promise<FeatureDocument> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return {
      kind: options.kind,
      platform: options.platform,
      feature: options.feature,
      records: []
    };
  }
  const parsed = JSON.parse(raw) as FeatureDocument;
  if (parsed.platform !== options.platform || parsed.feature !== options.feature) {
    throw new Error(`测试数据文档 ${filePath} 的 platform/feature 与本次写入不匹配`);
  }
  if (!Array.isArray(parsed.records)) {
    throw new Error(`测试数据文档 ${filePath} 缺少 records 数组，请检查文件格式`);
  }
  return parsed;
}

export async function recordGeneratedRegistrationData(data: GeneratedRegistrationData): Promise<void> {
  await appendRecord({
    testType: "web",
    platform: "open-platform",
    feature: "login-register",
    kind: "open-platform-registration",
    runId: data.runId,
    payload: data
  });
}

export async function recordGeneratedProductData(data: GeneratedProductData): Promise<void> {
  await appendRecord({
    testType: "web",
    platform: "open-platform",
    feature: "create-product",
    kind: "open-platform-product",
    runId: data.runId,
    payload: data
  });
}

export async function recordGeneratedMemberData(data: GeneratedMemberData): Promise<void> {
  await appendRecord({
    testType: "web",
    platform: "open-platform",
    feature: "enterprise-center",
    kind: "open-platform-member",
    runId: data.runId,
    payload: data
  });
}

export type GeneratedProductDeletionData = {
  runId: number;
  productName: string;
  productModel: string;
  /** 删除时间（ISO 字符串）。 */
  deletedAt: string;
};

/** 产品删除记录（product-management 包；删除对象仅限本测试体系生成的合成产品）。 */
export async function appendProductDeletionRecord(data: GeneratedProductDeletionData): Promise<void> {
  await appendRecord({
    testType: "web",
    platform: "open-platform",
    feature: "product-management",
    kind: "open-platform-product-deletion",
    runId: data.runId,
    payload: data
  });
}

export type GeneratedProductBasicEditData = {
  runId: number;
  productName: string;
  productModel: string;
  /** 本次保存补齐的字段（如 配网方式/配网文案/产品拟物图/配网引导图）。 */
  fields: string[];
  savedAt: string;
};

/** 产品基本配置编辑保存记录（product-basic 包；对象仅限台账最新合成产品）。 */
export async function recordGeneratedProductBasicEdit(data: GeneratedProductBasicEditData): Promise<void> {
  await appendRecord({
    testType: "web",
    platform: "open-platform",
    feature: "product-basic",
    kind: "open-platform-product-basic-edit",
    runId: data.runId,
    payload: data
  });
}

export type GeneratedProductBasicRevertData = {
  runId: number;
  productName: string;
  productModel: string;
  /** 还原的字段（当前仅产品名称）。 */
  field: string;
  /** 被拒绝/回退的尝试值（台账另一既有产品名称）。 */
  attemptedValue: string;
  restoredAt: string;
};

/** 产品基本配置还原写入记录（product-basic 包 OP-PBSC-010 回退路径；只记实际写入成功，正常拒绝路径不产生写入、不留痕）。 */
export async function recordGeneratedProductBasicRevert(data: GeneratedProductBasicRevertData): Promise<void> {
  await appendRecord({
    testType: "web",
    platform: "open-platform",
    feature: "product-basic",
    kind: "open-platform-product-basic-revert",
    runId: data.runId,
    payload: data
  });
}

export type GeneratedProductFuncTplData = {
  runId: number;
  productName: string;
  productModel: string;
  templateName: string;
  templateBadge: string;
  savedAt: string;
};

/** 功能模板选择记录（product-function 包；对象仅限台账最新合成产品）。 */
export async function recordGeneratedProductFuncTpl(data: GeneratedProductFuncTplData): Promise<void> {
  await appendRecord({
    testType: "web",
    platform: "open-platform",
    feature: "product-function",
    kind: "open-platform-product-func-tpl",
    runId: data.runId,
    payload: data
  });
}

export type GeneratedProductFuncDeleteData = {
  runId: number;
  productName: string;
  productModel: string;
  funcName: string;
  deletedAt: string;
};

/** 功能点删除记录（product-function 包；对象仅限台账最新合成产品的标准模板功能点）。 */
export async function recordGeneratedProductFuncDelete(data: GeneratedProductFuncDeleteData): Promise<void> {
  await appendRecord({
    testType: "web",
    platform: "open-platform",
    feature: "product-function",
    kind: "open-platform-product-func-delete",
    runId: data.runId,
    payload: data
  });
}

export type GeneratedFirmwareVersionData = {
  runId: number;
  productName: string;
  productModel: string;
  firmwareName: string;
  firmwareVersion: string;
  firmwareTestOtaVersion: string;
  savedAt: string;
};

/** 固件版本新增记录（product-develop 包；对象仅限台账最新合成产品，固件为合成 bin 文件）。 */
export async function recordGeneratedFirmwareVersion(data: GeneratedFirmwareVersionData): Promise<void> {
  await appendRecord({
    testType: "web",
    platform: "open-platform",
    feature: "product-develop",
    kind: "open-platform-firmware-version",
    runId: data.runId,
    payload: data
  });
}

export type GeneratedMessageTplData = {
  runId: number;
  productName: string;
  productModel: string;
  tplTitle: string;
  tplContent: string;
  appliedAt: string;
};

export type GeneratedMessageTplDeleteData = {
  runId: number;
  productName: string;
  productModel: string;
  tplTitle: string;
  deletedAt: string;
};

/** 消息模板套用记录（product-advanced 包；标准模板套用后同轮删除，合成可逆）。 */
export async function recordGeneratedMessageTpl(data: GeneratedMessageTplData): Promise<void> {
  await appendRecord({
    testType: "web",
    platform: "open-platform",
    feature: "product-advanced",
    kind: "open-platform-message-tpl",
    runId: data.runId,
    payload: data
  });
}

/** 消息模板删除记录（product-advanced 包；删除对象为同轮套用的标准模板行）。 */
export async function recordGeneratedMessageTplDelete(data: GeneratedMessageTplDeleteData): Promise<void> {
  await appendRecord({
    testType: "web",
    platform: "open-platform",
    feature: "product-advanced",
    kind: "open-platform-message-tpl-delete",
    runId: data.runId,
    payload: data
  });
}

export type GeneratedTestingBookingData = {
  runId: number;
  productName: string;
  productModel: string;
  testType: string;
  proposer: string;
  reservationTime: string;
  createdAt: string;
};

/** 实验室预约记录（product-testing 包；预约无 UI 删除路径，幂等防重复提交）。 */
export async function recordGeneratedTestingBooking(data: GeneratedTestingBookingData): Promise<void> {
  await appendRecord({
    testType: "web",
    platform: "open-platform",
    feature: "product-testing",
    kind: "open-platform-testing-booking",
    runId: data.runId,
    payload: data
  });
}

/** 读取指定功能最新一条生成数据记录（明文），仅供测试回填表单使用；无记录时返回 null。 */
export async function readLatestGeneratedData<T extends { runId: number }>(
  testType: string,
  platform: string,
  feature: string
): Promise<T | null> {
  const filePath = join(repositoryRoot, "testpacks", testType, platform, feature, "runtime", "generated-data.json");

  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return null;
  }

  const parsed = JSON.parse(raw) as FeatureDocument;
  if (!Array.isArray(parsed.records) || parsed.records.length === 0) {
    return null;
  }

  const latest = parsed.records[parsed.records.length - 1];
  return latest as T;
}

export type GeneratedAuthCodeApplyData = {
  runId: number;
  applicant: string;
  contactMobile: string;
  quantity: number;
  appliedAt: string;
};

/** 授权码申请记录（authcode 包；申请无 UI 删除路径，幂等防重复提交）。 */
export async function recordGeneratedAuthCodeApply(data: GeneratedAuthCodeApplyData): Promise<void> {
  await appendRecord({
    testType: "web",
    platform: "open-platform",
    feature: "authcode",
    kind: "open-platform-authcode-apply",
    runId: data.runId,
    payload: data
  });
}

export type GeneratedWorkOrderData = {
  runId: number;
  ticketTitle: string;
  ticketNumber: string;
  category: string;
  system: string;
  createdAt: string;
};

/** 技术工单记录（work-order 包；工单无 UI 删除路径，幂等防重复提交）。 */
export async function recordGeneratedWorkOrder(data: GeneratedWorkOrderData): Promise<void> {
  await appendRecord({
    testType: "web",
    platform: "open-platform",
    feature: "work-order",
    kind: "open-platform-work-order",
    runId: data.runId,
    payload: data
  });
}

export type GeneratedCloudServiceData = {
  runId: number;
  /** 开通时选择的数据中心（字典 AIOT_DATA_CENTER 选中项文本）。 */
  dataCenter: string;
  /** 弹窗预填联系人（当前账号 realName，合成测试账号）。 */
  contactName: string;
  /** 弹窗预填联系方式（合成测试手机号）。 */
  contactPhone: string;
  /** 开通成功时间（ISO 字符串）。 */
  activatedAt: string;
};

/** 云云接入服务开通记录（cloud-bridge 包；account 级一次性动作，重跑走幂等分支不再写入）。 */
export async function recordGeneratedCloudServiceData(data: GeneratedCloudServiceData): Promise<void> {
  await appendRecord({
    testType: "web",
    platform: "open-platform",
    feature: "cloud-bridge",
    kind: "open-platform-cloud-service-activation",
    runId: data.runId,
    payload: data
  });
}

export type GeneratedCloudProtocolData = {
  runId: number;
  protocolName: string;
  protocolDescription: string;
  /** 创建成功后平台生成的协议 id（thirdProtocolId）与配置页路由，回填后同 runId 覆盖更新。 */
  thirdProtocolId?: string;
  detailRoute?: string;
  /** 编辑保存成功时间（同 runId 覆盖更新，台账只增不删）。 */
  editedAt?: string;
  /** 状态启停切换时间戳列表（before-change 写接口，同 runId 覆盖更新）。 */
  statusToggledAt?: string[];
  /** 删除成功后回填删除标记（同 runId 覆盖更新）。 */
  deletedAt?: string;
  /** 配置页写入流水（2026-09-07 二次扩展：映射/Header/认证/规则启停/下行规则/最终保存/状态流转；2026-09-09 三次扩展：参数/映射模板/草稿规则生命周期）。 */
  configWrites?: Array<{
    at: string;
    kind:
      | "mapping-add"
      | "mapping-remove"
      | "header-add"
      | "header-remove"
      | "up-auth-save"
      | "up-rule-toggle"
      | "down-auth-save"
      | "down-rule-add"
      | "down-rule-remove"
      | "final-save"
      | "protocol-status-flow"
      | "param-add"
      | "param-edit"
      | "param-delete"
      | "payload-param-add"
      | "payload-param-delete"
      | "mapping-save"
      | "down-param-add"
      | "down-param-delete"
      | "down-draft-add"
      | "down-draft-delete";
    detail?: string;
  }>;
};

/** 云云桥接协议生命周期记录（cloud-bridge 包；创建/编辑/启停/删除同 runId 合并，删除仅限本台账合成协议）。 */
export async function recordGeneratedCloudProtocolData(data: GeneratedCloudProtocolData): Promise<void> {
  // 台账只增不删：configWrites/statusToggledAt 为跨用例累加流，追加前先并入既有条目（按时间戳去重）。
  const existing = await readCloudProtocolRecord(data.runId);
  const merged: GeneratedCloudProtocolData = { ...data };
  if (existing) {
    if (data.configWrites || existing.configWrites) {
      const seen = new Set((existing.configWrites ?? []).map(w => `${w.at}|${w.kind}|${w.detail ?? ""}`));
      merged.configWrites = [
        ...(existing.configWrites ?? []),
        ...(data.configWrites ?? []).filter(w => !seen.has(`${w.at}|${w.kind}|${w.detail ?? ""}`))
      ];
    }
    if (data.statusToggledAt || existing.statusToggledAt) {
      merged.statusToggledAt = [...new Set([...(existing.statusToggledAt ?? []), ...(data.statusToggledAt ?? [])])];
    }
  }
  await appendRecord({
    testType: "web",
    platform: "open-platform",
    feature: "cloud-bridge",
    kind: "open-platform-cloud-protocol",
    runId: merged.runId,
    payload: merged
  });
}

async function readCloudProtocolRecord(runId: number): Promise<GeneratedCloudProtocolData | null> {
  const filePath = join(repositoryRoot, "testpacks", "web", "open-platform", "cloud-bridge", "runtime", "generated-data.json");
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as { records?: Array<{ runId: number } & GeneratedCloudProtocolData> };
    return parsed.records?.find(record => record.runId === runId) ?? null;
  } catch {
    return null;
  }
}
