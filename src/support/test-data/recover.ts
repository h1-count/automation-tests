import { CleanupActionRegistry } from "./cleanupRegistry.js";
import { TestDataManager } from "./testDataManager.js";

const args = process.argv.slice(2);
const projectId = readOption("--project") ?? "iot-automation-tests";
const envId = readOption("--env") ?? "test";

// Real cleanup actions are registered only by confirmed project-specific code.
// This command intentionally ships with no business cleanup action.
const manager = new TestDataManager({ projectId, envId, cleanupRegistry: new CleanupActionRegistry() });
const summary = await manager.recoverLocalResources();
console.log(`本机台账恢复完成：资源 ${summary.totalResources}，已清理 ${summary.cleaned}，清理失败 ${summary.cleanupFailed}，待人工处理 ${summary.manualRequired}。`);
if (summary.cleanupFailed > 0 || summary.manualRequired > 0) {
  process.exitCode = 1;
}

function readOption(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1 || !args[index + 1]) {
    return undefined;
  }
  return args[index + 1];
}
