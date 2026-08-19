import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  isCasesPackageName,
  legacyRequestRootPath,
  localRunRootPath,
  readSuiteBinding,
  resolveRunRoot,
  suiteDirectoryPath,
  writeSuiteBinding
} from "../../../src/support/task-workflow/runRoots.js";

let workspace: string;

before(() => {
  workspace = mkdtempSync(join(tmpdir(), "run-roots-"));
});

after(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("run root resolution", () => {
  it("defaults brand-new requests to the local run archive", () => {
    const resolved = resolveRunRoot(workspace, "web/open-platform/fresh-run");
    assert.equal(resolved.mode, "local-test-runs");
    assert.equal(
      resolved.root,
      join(workspace, ".local", "test-runs", "web", "open-platform", "fresh-run")
    );
  });

  it("keeps legacy roots for requests whose history exists under testcases/", () => {
    const legacyRoot = legacyRequestRootPath(workspace, "web/open-platform/legacy-run");
    mkdirSync(legacyRoot, { recursive: true });
    writeFileSync(join(legacyRoot, "workflow-history.ndjson"), "{}\n", "utf8");
    const resolved = resolveRunRoot(workspace, "web/open-platform/legacy-run");
    assert.equal(resolved.mode, "legacy-testcases");
    assert.equal(resolved.root, legacyRoot);
  });

  it("prefers the local run archive when both roots exist", () => {
    const legacyRoot = legacyRequestRootPath(workspace, "web/open-platform/migrated-run");
    const localRoot = localRunRootPath(workspace, "web/open-platform/migrated-run");
    mkdirSync(legacyRoot, { recursive: true });
    writeFileSync(join(legacyRoot, "plan.md"), "plan\n", "utf8");
    mkdirSync(localRoot, { recursive: true });
    writeFileSync(join(localRoot, "workflow-history.ndjson"), "{}\n", "utf8");
    const resolved = resolveRunRoot(workspace, "web/open-platform/migrated-run");
    assert.equal(resolved.mode, "local-test-runs");
    assert.equal(resolved.root, localRoot);
  });

  it("honors an explicit mode override", () => {
    const forcedLegacy = resolveRunRoot(workspace, "web/open-platform/any", "legacy-testcases");
    assert.equal(forcedLegacy.mode, "legacy-testcases");
    assert.equal(
      forcedLegacy.root,
      join(workspace, "testcases", "web", "open-platform", "any")
    );
    const forcedLocal = resolveRunRoot(workspace, "web/open-platform/any", "local-test-runs");
    assert.equal(forcedLocal.mode, "local-test-runs");
  });
});

describe("suite binding", () => {
  it("maps suite ids to the committed suites directory", () => {
    assert.equal(
      suiteDirectoryPath(workspace, "web/open-platform/login-register"),
      join(workspace, "testcases", "web", "open-platform", "suites", "login-register")
    );
  });

  it("rejects malformed suite ids", () => {
    assert.throws(() => suiteDirectoryPath(workspace, "web/open-platform"));
    assert.throws(() => suiteDirectoryPath(workspace, "web/open-platform/Feature-Up"));
    assert.throws(() => suiteDirectoryPath(workspace, "web/open-platform/a/b"));
  });

  it("round-trips the binding file", () => {
    const runRoot = localRunRootPath(workspace, "web/open-platform/suite-run");
    writeSuiteBinding(runRoot, "web/open-platform/login-register");
    assert.deepEqual(readSuiteBinding(runRoot), { suiteId: "web/open-platform/login-register" });
    assert.equal(readSuiteBinding(legacyRequestRootPath(workspace, "none")), undefined);
  });

  it("treats a malformed binding file as absent", () => {
    const runRoot = localRunRootPath(workspace, "web/open-platform/broken-binding");
    mkdirSync(runRoot, { recursive: true });
    writeFileSync(join(runRoot, "suite.json"), "{not json", "utf8");
    assert.equal(readSuiteBinding(runRoot), undefined);
  });
});

describe("cases package names", () => {
  it("recognizes cases.md and package variants only", () => {
    assert.equal(isCasesPackageName("cases.md"), true);
    assert.equal(isCasesPackageName("cases-login.md"), true);
    assert.equal(isCasesPackageName("plan.md"), false);
    assert.equal(isCasesPackageName("cases-UPPER.md"), false);
  });
});

describe("run roots are platform portable", () => {
  it("uses forward-slash relative layout expectations", () => {
    const resolved = resolveRunRoot(workspace, "web/open-platform/portable");
    const relative = resolved.root.slice(workspace.length + 1).split(sep).join("/");
    assert.equal(relative, ".local/test-runs/web/open-platform/portable");
  });
});
