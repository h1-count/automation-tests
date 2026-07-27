import "dotenv/config";
import { prepareOpenPlatformProductRunData } from "../src/fixtures/openPlatformProductRunData";
import { resolveTestEnvironment } from "../src/env/testEnvironment";

const environment = resolveTestEnvironment();
if (environment.name === "prod") {
  throw new Error("Product test-data preparation is not supported in production.");
}

const runData = prepareOpenPlatformProductRunData(
  environment.name,
  process.env.FORCE_NEW_TEST_DATA === "true"
);

console.log(`Prepared local product run data for ${runData.environment}: ${runData.name} (${runData.model}).`);
console.log("This command creates no remote product. Enable the confirmed creation case separately.");
