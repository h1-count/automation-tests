import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface SelectorEvidenceIdentity {
  targetBuildDigest: string;
  routeState: string;
  selectorContractDigest: string;
  locale: string;
  role: string;
}

export interface SelectorVerificationEvidence {
  caseId: string;
  route: string;
  selectorType: string;
  matchCount: number;
  result: "runtime_verified";
  reachableBoundary: string;
}

export interface SelectorEvidenceCacheEntry {
  schemaVersion: "selector-evidence-cache-v1";
  key: string;
  identity: SelectorEvidenceIdentity;
  verifiedAt: string;
  evidence: SelectorVerificationEvidence[];
}

export function selectorEvidenceCacheKey(identity: SelectorEvidenceIdentity): string {
  assertIdentity(identity);
  return createHash("sha256")
    .update(JSON.stringify({
      targetBuildDigest: identity.targetBuildDigest,
      routeState: identity.routeState,
      selectorContractDigest: identity.selectorContractDigest,
      locale: identity.locale,
      role: identity.role
    }), "utf8")
    .digest("hex");
}

export class SelectorEvidenceCache {
  constructor(
    private readonly root = resolve(
      process.cwd(),
      ".local/test-task-runtime/selector-evidence"
    )
  ) {}

  async read(identity: SelectorEvidenceIdentity): Promise<SelectorEvidenceCacheEntry | null> {
    const key = selectorEvidenceCacheKey(identity);
    const path = resolve(this.root, `${key}.json`);
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(await readFile(path, "utf8")) as SelectorEvidenceCacheEntry;
    if (
      parsed.schemaVersion !== "selector-evidence-cache-v1"
      || parsed.key !== key
      || selectorEvidenceCacheKey(parsed.identity) !== key
      || !Array.isArray(parsed.evidence)
      || parsed.evidence.some((item) =>
        item.result !== "runtime_verified" || item.matchCount !== 1
      )
    ) {
      return null;
    }
    return parsed;
  }

  async write(
    identity: SelectorEvidenceIdentity,
    evidence: SelectorVerificationEvidence[]
  ): Promise<SelectorEvidenceCacheEntry> {
    if (
      evidence.length === 0
      || evidence.some((item) =>
        item.result !== "runtime_verified"
        || item.matchCount !== 1
        || !item.caseId.trim()
        || !item.route.trim()
      )
    ) {
      throw new Error("Selector evidence cache accepts only successful unique runtime verification.");
    }
    const key = selectorEvidenceCacheKey(identity);
    const entry: SelectorEvidenceCacheEntry = {
      schemaVersion: "selector-evidence-cache-v1",
      key,
      identity,
      verifiedAt: new Date().toISOString(),
      evidence: evidence.map((item) => ({ ...item }))
    };
    await mkdir(this.root, { recursive: true });
    await writeFile(resolve(this.root, `${key}.json`), `${JSON.stringify(entry, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    return entry;
  }
}

function assertIdentity(identity: SelectorEvidenceIdentity): void {
  for (const [key, value] of Object.entries(identity)) {
    if (!value.trim() || value.length > 512) {
      throw new Error(`Selector evidence identity ${key} is empty or too long.`);
    }
  }
  for (const [key, value] of [
    ["targetBuildDigest", identity.targetBuildDigest],
    ["selectorContractDigest", identity.selectorContractDigest]
  ]) {
    if (!/^[a-f0-9]{64}$/.test(value)) {
      throw new Error(`Selector evidence identity ${key} must be a SHA-256 digest.`);
    }
  }
}
