import "dotenv/config";
import { resolveTestEnvironment } from "../src/env/testEnvironment.js";
import {
  evaluateBrowserExplorationEligibility
} from "../src/support/web/browserExploration.js";
import { inspectLocalHostConfig } from "../src/support/web/browserExplorationHostConfig.js";

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--request") {
  throw new Error("Usage: npm run check:web-exploration -- --request <type/project/request>");
}

const requestId = args[1]!;
const configured = await inspectLocalHostConfig() === "configured";
let environment: string | undefined;
let authenticatedStateConfigured = false;
try {
  const resolved = resolveTestEnvironment();
  environment = resolved.name;
  authenticatedStateConfigured = Boolean(resolved.openPlatformAuthStatePath);
} catch {
  environment = undefined;
}

process.stdout.write(`${JSON.stringify(evaluateBrowserExplorationEligibility({
  requestId,
  environment,
  hostConfigured: configured,
  authenticatedStateConfigured
}), null, 2)}\n`);
