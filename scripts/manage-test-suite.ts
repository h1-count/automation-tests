import {
  assessStableTestSuite,
  loadStableTestSuite,
  stableSuiteManifestPath,
  validateStableTestSuite,
  type StableTestSuiteProfile
} from "../src/support/test-suite/stableSuite.js";
import {
  designSuiteManifestPath,
  refreshStableDesignSuite,
  registerStableDesignSuite,
  validateStableDesignSuite,
  readStableSuiteTier
} from "../src/support/test-suite/designSuite.js";
import { scriptAssetCoverage } from "../src/support/test-suite/scriptAssets.js";

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function options(args: string[], name: string): string[] {
  return args.flatMap((value, index) => value === name && args[index + 1] ? [args[index + 1]!] : []);
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
      profile: (option(args, "--profile") ?? "full_feature") as StableTestSuiteProfile,
      additionalSourcePaths: options(args, "--source")
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command === "register-design") {
    const result = await registerStableDesignSuite({
      suiteId,
      requestId: required(args, "--from-request")
    });
    const validation = await validateStableDesignSuite(suiteId);
    process.stdout.write(`${JSON.stringify({
      suiteId: result.manifest.suiteId,
      tier: result.manifest.tier,
      suiteVersion: result.manifest.suiteVersion,
      manifestPath: result.path,
      created: result.created,
      sourceRequestId: result.manifest.sourceRequestId,
      caseCount: result.manifest.caseIds.length,
      sourceCount: result.manifest.sourceRegistry.length,
      driftedSuitePaths: validation.driftedSuitePaths,
      driftedSourceIds: validation.driftedSourceIds
    }, null, 2)}\n`);
    if (validation.driftedSuitePaths.length || validation.driftedSourceIds.length) {
      process.exitCode = 2;
    }
    return;
  }
  if (command === "refresh-design") {
    const seedDesignBaseline = args.includes("--seed-design-baseline");
    const apply = args.includes("--apply");
    const result = await refreshStableDesignSuite({
      suiteId,
      apply,
      seedDesignBaseline,
      confirmCurrentDesign: args.includes("--confirm-current-design")
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (["semantic_drift", "source_drift", "missing_semantic_baseline"].includes(result.status)) process.exitCode = 2;
    return;
  }
  if (command === "status") {
    const tier = readStableSuiteTier(suiteId);
    if (tier === "design") {
      const validation = await validateStableDesignSuite(suiteId);
      const coverage = scriptAssetCoverage(
        validation.manifest.scriptAssets,
        validation.manifest.profiles.full_feature
      );
      process.stdout.write(`${JSON.stringify({
        suiteId,
        tier,
        suiteVersion: validation.manifest.suiteVersion,
        manifestPath: designSuiteManifestPath(suiteId),
        valid: validation.driftedSuitePaths.length === 0
          && validation.driftedSourceIds.length === 0,
        driftedSuitePaths: validation.driftedSuitePaths,
        driftedSourceIds: validation.driftedSourceIds,
        caseCount: validation.manifest.caseIds.length,
        sourceCount: validation.manifest.sourceRegistry.length,
        allowedEnvironments: validation.manifest.allowedEnvironments,
        scriptAssets: {
          reusable: coverage.reusable,
          directlyExecutable: coverage.directlyExecutable,
          reason: coverage.reason,
          reviewedCaseCount: validation.manifest.scriptAssets?.caseBindings
            .filter((binding) => binding.level === "reviewed").length ?? 0,
          verifiedCaseCount: validation.manifest.scriptAssets?.caseBindings
            .filter((binding) => binding.level === "verified").length ?? 0
        }
      }, null, 2)}\n`);
      if (validation.driftedSuitePaths.length || validation.driftedSourceIds.length) {
        process.exitCode = 2;
      }
      return;
    }
    const manifest = await loadStableTestSuite(suiteId);
    const validation = await validateStableTestSuite(suiteId);
    process.stdout.write(`${JSON.stringify({
      suiteId,
      tier: tier ?? "execution",
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
  throw new Error(
    "Usage: manage-test-suite.ts <assess|status|register-design|refresh-design> --suite <type/project/feature> "
    + "[--environment <test|pre>] [--profile <profile>] [--source <sources/...>] [--from-request <type/project/request>] "
    + "[--apply] [--seed-design-baseline --confirm-current-design]"
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
