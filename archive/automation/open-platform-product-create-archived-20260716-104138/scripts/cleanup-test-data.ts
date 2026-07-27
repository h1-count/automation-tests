import "dotenv/config";
import {
  loadOpenPlatformProductRunData,
  markOpenPlatformProductRetained,
  removePreparedOpenPlatformProductRunData
} from "../src/fixtures/openPlatformProductRunData";
import { resolveTestEnvironment } from "../src/env/testEnvironment";

const environment = resolveTestEnvironment();
if (environment.name === "prod") {
  throw new Error("Product test-data cleanup is not supported in production.");
}

try {
  const runData = loadOpenPlatformProductRunData();
  if (runData.status === "prepared") {
    removePreparedOpenPlatformProductRunData();
    console.log("Removed unused local product run data; no remote product was created.");
  } else if (runData.status === "created") {
    markOpenPlatformProductRetained(runData);
    console.log(
      `Retained remote test product ${runData.name}. No remote deletion was attempted; ` +
        "a separately confirmed deletion flow is required."
    );
  } else {
    console.log(`Remote test product ${runData.name} is already recorded as retained; no deletion was attempted.`);
  }
} catch (error) {
  if (error instanceof Error && error.message.startsWith("Missing local product run data")) {
    console.log("No local product run data found; nothing to clean up.");
  } else {
    throw error;
  }
}
