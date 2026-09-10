import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildRequestReport } from "../../scripts/build-request-report.mjs";
import { requestArtifactDirectories } from "../../scripts/support/request-report-location.mjs";

async function writeCurrent(directory, results) {
  const resultDirectory = path.join(directory, "allure-results");
  await fs.mkdir(resultDirectory, { recursive: true });
  await fs.writeFile(path.join(directory, "manifest.json"), JSON.stringify({ reportId: "demo", startedAt: "2026-09-09T00:00:00.000Z", packs: ["testpacks/web/open-platform/a", "testpacks/web/open-platform/b"] }));
  await Promise.all(results.map((result, index) => fs.writeFile(path.join(resultDirectory, `${index}-result.json`), JSON.stringify(result))));
}

test("报告将未执行目录项保留为 unexecuted，并按多用例标题同步结果", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "request-report-catalog-"));
  const current = path.join(directory, "current");
  const report = path.join(directory, "test-reports", "demo.md");
  try {
    await fs.mkdir(path.join(current, "allure-results"), { recursive: true });
    await fs.writeFile(path.join(current, "manifest.json"), JSON.stringify({
      reportId: "demo", startedAt: "2026-09-10T00:00:00.000Z", packs: ["testpacks/web/open-platform/demo"], runMode: "initial_full", plannedCaseIds: ["OP-X-001", "OP-X-002"], dependencies: [],
      caseCatalog: [
        { key: "web/open-platform/demo:OP-X-001", packPath: "web/open-platform/demo", caseId: "OP-X-001", dependsOn: [] },
        { key: "web/open-platform/demo:OP-X-002", packPath: "web/open-platform/demo", caseId: "OP-X-002", dependsOn: [] },
        { key: "web/open-platform/demo:OP-X-003", packPath: "web/open-platform/demo", caseId: "OP-X-003", dependsOn: [] }
      ]
    }));
    await fs.writeFile(path.join(current, "allure-results", "demo-result.json"), JSON.stringify({ name: "OP-X-001 OP-X-002 组合测试", status: "passed", stop: 1, fullName: "demo.spec.ts" }));
    await buildRequestReport({ currentDirectory: current, durableReportPath: report });
    const data = await fs.readFile(report, "utf8");
    assert.match(data, /OP-X-001 OP-X-002 组合测试 \| passed/u);
    assert.match(data, /OP-X-003 \| unexecuted/u);
    assert.match(data, /"runMode":"initial_full"/u);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("Markdown 报告合并跨包用例、复测次数和全局序号", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "request-report-"));
  const current = path.join(directory, "current");
  const report = path.join(directory, "test-reports", "demo.md");
  try {
    await writeCurrent(current, [
      { historyId: "case-a", name: "001. OP-A-001 首次", status: "failed", stop: 1, fullName: "a.spec.ts", statusDetails: { message: "password=secret" } },
      { historyId: "case-b", name: "002. OP-B-001", status: "passed", stop: 2, fullName: "b.spec.ts" }
    ]);
    await buildRequestReport({ currentDirectory: current, durableReportPath: report });
    assert.doesNotMatch(await fs.readFile(report, "utf8"), /password=secret/);
    await fs.rm(current, { recursive: true, force: true });
    await writeCurrent(current, [
      { historyId: "case-a", name: "001. OP-A-001 复测", status: "passed", stop: 3, fullName: "a.spec.ts" },
      { historyId: "case-c", name: "003. OP-C-001 补测", status: "passed", stop: 4, fullName: "c.spec.ts" }
    ]);
    const summary = await buildRequestReport({ currentDirectory: current, durableReportPath: report });
    const markdown = await fs.readFile(report, "utf8");
    assert.equal(summary.testcaseCount, 3);
    assert.equal(summary.attemptCount, 2);
    assert.match(markdown, /\| #1 \| OP-A-001 复测 \| passed \| 2 \|/);
    assert.match(markdown, /\| #2 \| OP-B-001 \| passed \| 1 \|/);
    assert.match(markdown, /\| #3 \| OP-C-001 补测 \| passed \| 1 \|/);
    assert.doesNotMatch(markdown, /password=secret/);
    assert.match(markdown, /automation-report-data/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("单包和多包按公共目录拆分长期报告，并按请求标识隔离当前证据与历史", () => {
  const root = "/workspace";
  const one = requestArtifactDirectories(root, ["/workspace/testpacks/web/open-platform/login-register"], "login-001");
  assert.equal(one.durableReportPath, "/workspace/testpacks/web/open-platform/login-register/test-reports/login-001.md");
  assert.equal(one.currentDirectory, "/workspace/testpacks/web/open-platform/login-register/artifacts/current/login-001");
  const many = requestArtifactDirectories(root, [
    "/workspace/testpacks/web/open-platform/login-register",
    "/workspace/testpacks/web/open-platform/create-product"
  ], "flow-001");
  assert.equal(many.durableReportPath, "/workspace/testpacks/web/open-platform/test-reports/flow-001.md");
  assert.equal(many.currentDirectory, "/workspace/testpacks/web/open-platform/artifacts/current/flow-001");
  assert.equal(many.historyPath, "/workspace/testpacks/web/open-platform/runtime/allure-history/flow-001.jsonl");
});
