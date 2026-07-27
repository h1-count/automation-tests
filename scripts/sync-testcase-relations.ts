import { resolve } from "node:path";
import { synchronizeRequest } from "./testcase-relation-projections.ts";

const requestPath = process.argv[2];

if (!requestPath) {
  throw new Error("Usage: sync-testcase-relations.ts <test-request-directory>");
}

const result = synchronizeRequest(resolve(requestPath));

if (result.issues.length > 0) {
  throw new Error(result.issues.map((issue) => `${issue.name}: ${issue.detail}`).join("\n"));
}

process.stdout.write(result.changedFiles.length > 0 ? `已同步：${result.changedFiles.join("、")}\n` : "关系视图已是最新。\n");
