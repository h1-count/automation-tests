import { relative, resolve } from "node:path";
import { synchronizeRequest } from "./testcase-relation-projections.ts";

const args = process.argv.slice(2);
const check = args.includes("--check");
const positional = args.filter((argument) => argument !== "--check");
const requestPath = positional[0];

if (!requestPath || positional.length !== 1) {
  throw new Error(
    "Usage: sync-testcase-relations.ts [--check] <test-request-directory>"
  );
}

const projectRoot = resolve(import.meta.dirname, "..");
const requestDirectory = resolve(requestPath);
const pathFromTestcases = relative(
  resolve(projectRoot, "testcases"),
  requestDirectory
);
const targetsFinalTestcaseDirectory =
  pathFromTestcases !== ""
  && pathFromTestcases !== ".."
  && !pathFromTestcases.startsWith("../");
if (!check && targetsFinalTestcaseDirectory) {
  throw new Error(
    "Final testcase assets are read-only to this command; synchronize a runtime staging copy, then publish it through task:manage."
  );
}

const result = synchronizeRequest(requestDirectory, { check });

if (result.issues.length > 0) {
  throw new Error(result.issues.map((issue) => `${issue.name}: ${issue.detail}`).join("\n"));
}

process.stdout.write(
  check
    ? "关系视图校验通过。\n"
    : result.changedFiles.length > 0
      ? `已同步：${result.changedFiles.join("、")}\n`
      : "关系视图已是最新。\n"
);
