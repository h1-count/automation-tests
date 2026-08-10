import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const resetScriptSource = readFileSync(
  resolve(repositoryRoot, "scripts/reset-full-test-state.ts"),
  "utf8"
);
const tsxLoader = resolve(repositoryRoot, "node_modules/tsx/dist/loader.mjs");

function createHarness() {
  const root = mkdtempSync(resolve(tmpdir(), "full-reset-"));
  mkdirSync(resolve(root, "scripts"), { recursive: true });
  writeFileSync(resolve(root, "scripts/reset-full-test-state.ts"), resetScriptSource, "utf8");

  return {
    root,
    write(path: string, content = "") {
      const absolute = resolve(root, path);
      mkdirSync(resolve(absolute, ".."), { recursive: true });
      writeFileSync(absolute, content, "utf8");
    },
    run(...args: string[]) {
      return spawnSync(process.execPath, [
        "--import",
        tsxLoader,
        "scripts/reset-full-test-state.ts",
        ...args
      ], {
        cwd: root,
        encoding: "utf8"
      });
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    }
  };
}

function findArchivedRequest(root: string, projectPath: string, requestPrefix: string): string {
  const parent = resolve(root, "testcases/archive", projectPath);
  const match = readdirSync(parent).find((entry) =>
    entry.startsWith(`${requestPrefix}-archived-`)
  );
  assert.ok(match, `missing archive for ${projectPath}/${requestPrefix}`);
  return resolve(parent, match);
}

function writeLedgerRun(
  harness: ReturnType<typeof createHarness>,
  state: "cleanup_pending" | "retained" | "cleaned"
): void {
  const retained = state === "retained";
  harness.write(
    ".local/test-ledger/runs/run-1.json",
    JSON.stringify({
      runId: "run-1",
      status: "passed",
      resources: ["resource-1"],
      createIntents: [],
      dataWritePolicy: retained ? "tracked_residual" : "managed_cleanup",
      ...(retained ? { authorizationDigest: "a".repeat(64) } : {})
    })
  );
  harness.write(
    ".local/test-ledger/resources/resource.json",
    JSON.stringify({
      resourceId: "resource-1",
      runId: "run-1",
      owner: "local-automation-test",
      state,
      ...(retained
        ? {
            dataWritePolicy: "tracked_residual",
            expiresAt: new Date(Date.now() + 72 * 3_600_000).toISOString()
          }
        : {})
    })
  );
}

test("full reset dry-run reports one unified request archive without mutating it", () => {
  const harness = createHarness();
  try {
    harness.write("testcases/web/demo/registration/plan.md", "# plan");
    harness.write("tests/web/demo/registration/registration.spec.ts", "export {};");

    const result = harness.run("--dry-run");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /归档活动请求及请求专属测试实现：1 项/);
    assert.ok(existsSync(resolve(harness.root, "testcases/web/demo/registration/plan.md")));
    assert.ok(existsSync(resolve(harness.root, "tests/web/demo/registration/registration.spec.ts")));
    assert.equal(existsSync(resolve(harness.root, "testcases/archive")), false);
  } finally {
    harness.cleanup();
  }
});

test("full reset archives testcase assets and request tests under the same request", () => {
  const harness = createHarness();
  try {
    harness.write("testcases/web/demo/registration/plan.md", "# plan");
    harness.write("testcases/web/demo/registration/workflow-history.ndjson", "{}");
    harness.write("tests/web/demo/registration/registration.spec.ts", "export {};");
    harness.write("tests/support/shared.test.ts", "export {};");
    harness.write("tests/web/_lifecycle/formal.setup.ts", "export {};");

    const result = harness.run();
    assert.equal(result.status, 0, result.stderr);

    const archive = findArchivedRequest(harness.root, "web/demo", "registration");
    assert.ok(existsSync(resolve(archive, "plan.md")));
    assert.ok(existsSync(resolve(archive, "workflow-history.ndjson")));
    assert.ok(existsSync(resolve(archive, "automation/tests/registration.spec.ts")));
    assert.ok(existsSync(resolve(harness.root, "tests/support/shared.test.ts")));
    assert.ok(existsSync(resolve(harness.root, "tests/web/_lifecycle/formal.setup.ts")));
    assert.equal(existsSync(resolve(harness.root, "archive/automation")), false);
  } finally {
    harness.cleanup();
  }
});

test("full reset preserves stable suite design assets and scripts", () => {
  const harness = createHarness();
  try {
    harness.write("testcases/web/demo/suites/registration/suite.manifest.json", "{}\n");
    harness.write("testcases/web/demo/suites/registration/plan.md", "# stable plan\n");
    harness.write("tests/web/demo/suites/registration/execution.manifest.ts", "export {};\n");
    harness.write("tests/web/demo/suites/registration/registration.formal.spec.ts", "export {};\n");

    const result = harness.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /归档活动请求及请求专属测试实现：0 项/);
    assert.ok(existsSync(resolve(
      harness.root,
      "testcases/web/demo/suites/registration/suite.manifest.json"
    )));
    assert.ok(existsSync(resolve(
      harness.root,
      "tests/web/demo/suites/registration/registration.formal.spec.ts"
    )));
  } finally {
    harness.cleanup();
  }
});

test("full reset blocks orphan request tests instead of guessing their ownership", () => {
  const harness = createHarness();
  try {
    harness.write("tests/api/demo/orphan/request.spec.ts", "export {};");

    const result = harness.run();
    assert.equal(result.status, 2);
    assert.match(result.stderr, /未归属到 plan\.md 请求/);
    assert.ok(existsSync(resolve(harness.root, "tests/api/demo/orphan/request.spec.ts")));
  } finally {
    harness.cleanup();
  }
});

test("full reset preserves registered shared test subtrees", () => {
  const harness = createHarness();
  try {
    harness.write("tests/web/shared/helpers/browser.ts", "export {};");
    harness.write("tests/shared/contracts/fixture.ts", "export {};");

    const result = harness.run();
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(resolve(harness.root, "tests/web/shared/helpers/browser.ts")));
    assert.ok(existsSync(resolve(harness.root, "tests/shared/contracts/fixture.ts")));
  } finally {
    harness.cleanup();
  }
});

test("full reset preserves shared and common testcase plans without archiving or blocking", () => {
  const harness = createHarness();
  try {
    harness.write("testcases/web/shared/browser/plan.md", "# shared plan");
    harness.write("testcases/api/common/contracts/plan.md", "# common plan");

    const result = harness.run();
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(resolve(harness.root, "testcases/web/shared/browser/plan.md")));
    assert.ok(existsSync(resolve(harness.root, "testcases/api/common/contracts/plan.md")));
    assert.equal(existsSync(resolve(harness.root, "testcases/archive/web/shared")), false);
    assert.equal(existsSync(resolve(harness.root, "testcases/archive/api/common")), false);
  } finally {
    harness.cleanup();
  }
});

test("full reset stops before mutation when a reset scope contains a symbolic link", () => {
  const harness = createHarness();
  try {
    harness.write("testcases/web/demo/registration/plan.md", "# plan");
    harness.write("outside/target.txt", "protected");
    harness.write("artifacts/.gitkeep", "");
    symlinkSync(resolve(harness.root, "outside/target.txt"), resolve(harness.root, "artifacts/link"));

    const result = harness.run();
    assert.equal(result.status, 2);
    assert.match(result.stderr, /符号链接/);
    assert.ok(existsSync(resolve(harness.root, "testcases/web/demo/registration/plan.md")));
    assert.ok(existsSync(resolve(harness.root, "outside/target.txt")));
  } finally {
    harness.cleanup();
  }
});

test("full reset rejects the retired archive automation root", () => {
  const harness = createHarness();
  try {
    harness.write("testcases/web/demo/registration/plan.md", "# plan");
    harness.write("archive/automation/legacy/script.ts", "export {};");

    const result = harness.run();
    assert.equal(result.status, 2);
    assert.match(result.stderr, /archive\/automation/);
    assert.ok(existsSync(resolve(harness.root, "testcases/web/demo/registration/plan.md")));
  } finally {
    harness.cleanup();
  }
});

test("full reset fails before mutation when a ledger resource is not settled", () => {
  const harness = createHarness();
  try {
    harness.write("testcases/web/demo/registration/plan.md", "# plan");
    writeLedgerRun(harness, "cleanup_pending");

    const result = harness.run();
    assert.equal(result.status, 2);
    assert.match(result.stderr, /完整重置已停止/);
    assert.match(result.stderr, /test-data:recover/);
    assert.ok(existsSync(resolve(harness.root, "testcases/web/demo/registration/plan.md")));
    assert.ok(existsSync(resolve(harness.root, ".local/test-ledger/resources/resource.json")));
  } finally {
    harness.cleanup();
  }
});

test("full reset rejects unknown ledger files and directories before mutation", () => {
  for (const unknownPath of [
    ".local/test-ledger/resources/resource.bin",
    ".local/test-ledger/unknown/data.json"
  ]) {
    const harness = createHarness();
    try {
      harness.write("testcases/web/demo/registration/plan.md", "# plan");
      harness.write(unknownPath, "{}");

      const result = harness.run();
      assert.equal(result.status, 2);
      assert.match(result.stderr, /未知台账|未知文件或目录/);
      assert.ok(existsSync(resolve(harness.root, unknownPath)));
      assert.ok(existsSync(resolve(harness.root, "testcases/web/demo/registration/plan.md")));
    } finally {
      harness.cleanup();
    }
  }
});

test("full reset rejects damaged runs before mutation", () => {
  const harness = createHarness();
  try {
    harness.write("testcases/web/demo/registration/plan.md", "# plan");
    harness.write(".local/test-ledger/runs/run-1.json", "{");

    const result = harness.run();
    assert.equal(result.status, 2);
    assert.match(result.stderr, /runs JSON 损坏/);
    assert.ok(existsSync(resolve(harness.root, ".local/test-ledger/runs/run-1.json")));
    assert.ok(existsSync(resolve(harness.root, "testcases/web/demo/registration/plan.md")));
  } finally {
    harness.cleanup();
  }
});

test("full reset rejects damaged summaries and machine identity before mutation", () => {
  for (const [path, content, expected] of [
    [".local/test-ledger/summaries/run-1.json", "{", /summaries JSON 损坏/],
    [".local/test-ledger/machine-id", "not-a-machine-id", /machine-id 格式损坏/]
  ] as const) {
    const harness = createHarness();
    try {
      harness.write("testcases/web/demo/registration/plan.md", "# plan");
      harness.write(path, content);

      const result = harness.run();
      assert.equal(result.status, 2);
      assert.match(result.stderr, expected);
      assert.ok(existsSync(resolve(harness.root, path)));
      assert.ok(existsSync(resolve(harness.root, "testcases/web/demo/registration/plan.md")));
    } finally {
      harness.cleanup();
    }
  }
});

test("full reset rejects dangling resource references before mutation", () => {
  const harness = createHarness();
  try {
    harness.write("testcases/web/demo/registration/plan.md", "# plan");
    harness.write(
      ".local/test-ledger/runs/run-1.json",
      JSON.stringify({
        runId: "run-1",
        status: "passed",
        resources: ["missing-resource"],
        createIntents: [],
        dataWritePolicy: "managed_cleanup"
      })
    );

    const result = harness.run();
    assert.equal(result.status, 2);
    assert.match(result.stderr, /引用了不存在的资源/);
    assert.ok(existsSync(resolve(harness.root, ".local/test-ledger/runs/run-1.json")));
    assert.ok(existsSync(resolve(harness.root, "testcases/web/demo/registration/plan.md")));
  } finally {
    harness.cleanup();
  }
});

test("full reset fails before mutation when the unified request archive would collide", () => {
  const harness = createHarness();
  try {
    harness.write("testcases/web/demo/registration/plan.md", "# plan");
    harness.write(
      "testcases/web/demo/registration/automation/tests/existing.spec.ts",
      "export {};"
    );
    harness.write("tests/web/demo/registration/new.spec.ts", "export {};");

    const result = harness.run();
    assert.equal(result.status, 2);
    assert.match(result.stderr, /归档目标不唯一/);
    assert.ok(existsSync(resolve(harness.root, "testcases/web/demo/registration/plan.md")));
    assert.ok(existsSync(resolve(harness.root, "tests/web/demo/registration/new.spec.ts")));
  } finally {
    harness.cleanup();
  }
});

test("full reset preserves an explicitly retained ledger instead of archiving it", () => {
  const harness = createHarness();
  try {
    writeLedgerRun(harness, "retained");
    harness.write(".local/test-task-runtime/runtime.json", "{}");

    const result = harness.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /保留本机残留台账/);
    assert.ok(existsSync(resolve(harness.root, ".local/test-ledger/resources/resource.json")));
    assert.equal(existsSync(resolve(harness.root, ".local/test-task-runtime/runtime.json")), false);
    assert.equal(existsSync(resolve(harness.root, "testcases/archive/unlinked-test-data")), false);
  } finally {
    harness.cleanup();
  }
});

test("full reset rejects retained or quarantined labels without a reviewable decision", () => {
  for (const state of ["retained", "quarantined"]) {
    const harness = createHarness();
    try {
      harness.write(
        ".local/test-ledger/runs/run-1.json",
        JSON.stringify({
          runId: "run-1",
          status: "passed",
          resources: ["resource-1"],
          createIntents: [],
          dataWritePolicy: "managed_cleanup"
        })
      );
      harness.write(
        ".local/test-ledger/resources/resource.json",
        JSON.stringify({
          resourceId: "resource-1",
          runId: "run-1",
          owner: "local-automation-test",
          state
        })
      );

      const result = harness.run();
      assert.equal(result.status, 2);
      assert.match(result.stderr, /缺少可审查的残留决定/);
      assert.ok(existsSync(resolve(harness.root, ".local/test-ledger/resources/resource.json")));
    } finally {
      harness.cleanup();
    }
  }
});

test("full reset blocks cleanup_failed and manual_required hygiene summaries", () => {
  for (const dataHygieneStatus of ["cleanup_failed", "manual_required"]) {
    const harness = createHarness();
    try {
      harness.write(
        ".local/test-ledger/runs/run-1.json",
        JSON.stringify({
          runId: "run-1",
          status: "failed",
          resources: [],
          createIntents: [],
          dataWritePolicy: "managed_cleanup"
        })
      );
      harness.write(
        ".local/test-ledger/summaries/run-1.json",
        JSON.stringify({
          runId: "run-1",
          resources: [],
          dataHygieneStatus
        })
      );

      const result = harness.run();
      assert.equal(result.status, 2);
      assert.match(result.stderr, new RegExp(dataHygieneStatus));
      assert.ok(existsSync(resolve(harness.root, ".local/test-ledger/summaries/run-1.json")));
    } finally {
      harness.cleanup();
    }
  }
});

test("full reset removes settled local ledgers and retired v11 caches", () => {
  const harness = createHarness();
  try {
    writeLedgerRun(harness, "cleaned");
    harness.write(".local/test-task-state/web/demo/request/state.json", "{}");
    harness.write(".local/test-data/cache.json", "{}");

    const result = harness.run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(resolve(harness.root, ".local/test-ledger")), false);
    assert.equal(existsSync(resolve(harness.root, ".local/test-task-state")), false);
    assert.equal(existsSync(resolve(harness.root, ".local/test-data")), false);
  } finally {
    harness.cleanup();
  }
});
