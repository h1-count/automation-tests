import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  SelectorEvidenceCache,
  selectorEvidenceCacheKey
} from "../../../src/support/web/selectorEvidenceCache.js";

const identity = {
  targetBuildDigest: "a".repeat(64),
  routeState: "/register:anonymous",
  selectorContractDigest: "b".repeat(64),
  locale: "zh-CN",
  role: "anonymous"
};

test("selector evidence cache identity includes build, state, contract, locale and role", () => {
  const base = selectorEvidenceCacheKey(identity);
  for (const key of Object.keys(identity) as Array<keyof typeof identity>) {
    const changedValue = key.endsWith("Digest")
      ? (identity[key] === "a".repeat(64) ? "c".repeat(64) : "d".repeat(64))
      : `${identity[key]}-changed`;
    assert.notEqual(
      selectorEvidenceCacheKey({ ...identity, [key]: changedValue }),
      base
    );
  }
});

test("selector evidence cache reuses only complete unique runtime evidence", async (context) => {
  const root = await mkdtemp(resolve(tmpdir(), "selector-evidence-cache-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const cache = new SelectorEvidenceCache(root);
  assert.equal(await cache.read(identity), null);
  await cache.write(identity, [{
    caseId: "CASE-001",
    route: "/register",
    selectorType: "role_name",
    matchCount: 1,
    result: "runtime_verified",
    reachableBoundary: "registration form"
  }]);
  assert.equal((await cache.read(identity))?.evidence[0]?.caseId, "CASE-001");
  await assert.rejects(
    cache.write(identity, [{
      caseId: "CASE-001",
      route: "/register",
      selectorType: "role_name",
      matchCount: 2,
      result: "runtime_verified",
      reachableBoundary: "registration form"
    }]),
    /successful unique/
  );
});
