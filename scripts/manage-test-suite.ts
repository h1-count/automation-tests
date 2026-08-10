import {
  assessStableTestSuite,
  loadStableTestSuite,
  stableSuiteManifestPath,
  validateStableTestSuite,
  type StableTestSuiteProfile
} from "../src/support/test-suite/stableSuite.js";

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function required(args: string[], name: string): string {
  const value = option(args, name);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const suiteId = required(args, "--suite");
  if (command === "assess") {
    const result = await assessStableTestSuite({
      suiteId,
      environment: required(args, "--environment"),
      profile: (option(args, "--profile") ?? "full_feature") as StableTestSuiteProfile
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command === "status") {
    const manifest = await loadStableTestSuite(suiteId);
    const validation = await validateStableTestSuite(suiteId);
    process.stdout.write(`${JSON.stringify({
      suiteId,
      suiteVersion: manifest.suiteVersion,
      manifestPath: stableSuiteManifestPath(suiteId),
      valid: validation.driftedPaths.length === 0 && !validation.closureDrift,
      driftedPaths: validation.driftedPaths,
      closureDrift: validation.closureDrift,
      refreshedBuildPaths: validation.refreshedBuildPaths,
      caseCount: manifest.caseIds.length,
      dataWritePolicy: manifest.dataWritePolicy,
      allowedEnvironments: manifest.allowedEnvironments
    }, null, 2)}\n`);
    if (validation.driftedPaths.length || validation.closureDrift) process.exitCode = 2;
    return;
  }
  throw new Error("Usage: manage-test-suite.ts <assess|status> --suite <type/project/feature> [--environment <test|pre>] [--profile <profile>]");
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
