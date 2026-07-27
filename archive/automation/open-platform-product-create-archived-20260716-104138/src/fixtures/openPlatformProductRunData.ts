import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, resolve } from "node:path";

export type OpenPlatformProductRunStatus = "prepared" | "created" | "retained";

export interface OpenPlatformProductRunData {
  runId: string;
  environment: string;
  name: string;
  model: string;
  status: OpenPlatformProductRunStatus;
  preparedAt: string;
  createdAt?: string;
  retainedAt?: string;
}

/**
 * Stores only non-sensitive, per-run product names under the ignored .local directory.
 * A created product is intentionally retained until a separately confirmed deletion flow exists.
 */
export function prepareOpenPlatformProductRunData(
  environment: string,
  force = false
): OpenPlatformProductRunData {
  const recordPath = resolveRunDataPath();

  if (existsSync(recordPath) && !force) {
    const existing = loadOpenPlatformProductRunData();
    if (existing.status !== "prepared") {
      throw new Error(
        `Existing product run data is ${existing.status}: ${existing.name}. ` +
          "Run cleanup:test-data to retain it, or set FORCE_NEW_TEST_DATA=true after recording the retained product."
      );
    }
    return existing;
  }

  const suffix = Date.now().toString(36).slice(-6);
  const runData: OpenPlatformProductRunData = {
    runId: `open-platform-product-${suffix}`,
    environment,
    name: `Codex测试开关${suffix}`,
    model: `c${suffix}`,
    status: "prepared",
    preparedAt: new Date().toISOString()
  };
  writeRunData(runData);
  return runData;
}

export function loadOpenPlatformProductRunData(): OpenPlatformProductRunData {
  const recordPath = resolveRunDataPath();
  if (!existsSync(recordPath)) {
    throw new Error(
      "Missing local product run data. Run `npm run prepare:test-data` before executing the product creation case."
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(recordPath, "utf8"));
  } catch {
    throw new Error(`Unable to read local product run data: ${recordPath}`);
  }

  if (!isValidRunData(parsed)) {
    throw new Error(`Invalid local product run data: ${recordPath}`);
  }
  return parsed;
}

export function markOpenPlatformProductCreated(runData: OpenPlatformProductRunData): void {
  writeRunData({ ...runData, status: "created", createdAt: new Date().toISOString() });
}

export function markOpenPlatformProductRetained(runData: OpenPlatformProductRunData): void {
  writeRunData({ ...runData, status: "retained", retainedAt: new Date().toISOString() });
}

export function removePreparedOpenPlatformProductRunData(): boolean {
  const recordPath = resolveRunDataPath();
  if (!existsSync(recordPath)) {
    return false;
  }

  const runData = loadOpenPlatformProductRunData();
  if (runData.status !== "prepared") {
    return false;
  }
  rmSync(recordPath);
  return true;
}

function writeRunData(runData: OpenPlatformProductRunData): void {
  const recordPath = resolveRunDataPath();
  mkdirSync(dirname(recordPath), { recursive: true });
  const temporaryPath = `${recordPath}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(runData, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, recordPath);
}

function resolveRunDataPath(): string {
  const configuredPath = process.env.OPEN_PLATFORM_PRODUCT_RUN_DATA_PATH?.trim();
  return resolve(process.cwd(), configuredPath || ".local/test-data/open-platform-product-create.json");
}

function isValidRunData(value: unknown): value is OpenPlatformProductRunData {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<OpenPlatformProductRunData>;
  return (
    typeof candidate.runId === "string" &&
    typeof candidate.environment === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.model === "string" &&
    (candidate.status === "prepared" || candidate.status === "created" || candidate.status === "retained") &&
    typeof candidate.preparedAt === "string"
  );
}
