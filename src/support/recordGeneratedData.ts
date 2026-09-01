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
