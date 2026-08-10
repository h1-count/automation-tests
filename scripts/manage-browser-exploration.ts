import {
  ensureLocalHostConfig,
  inspectLocalHostConfig,
  removeLocalHostConfig
} from "../src/support/web/browserExplorationHostConfig.js";

const [command, ...args] = process.argv.slice(2);

if (command === "setup") {
  if (args.length !== 2 || args[0] !== "--adapter" || args[1] !== "current-host") {
    throw new Error("Usage: npm run browser:exploration:setup -- --adapter current-host");
  }
  const result = await ensureLocalHostConfig();
  process.stdout.write(`${JSON.stringify({ schemaVersion: "browser-exploration-host-setup-v1", result })}\n`);
} else if (command === "status") {
  const status = await inspectLocalHostConfig();
  process.stdout.write(`${JSON.stringify({
    schemaVersion: "browser-exploration-host-status-v1",
    status: status === "configured" ? "configured" : "fallback",
    reasonCode: status === "configured" ? undefined : `host_adapter_${status}`
  })}\n`);
} else if (command === "remove") {
  const removed = await removeLocalHostConfig();
  process.stdout.write(`${JSON.stringify({ schemaVersion: "browser-exploration-host-remove-v1", removed })}\n`);
} else {
  throw new Error("Usage: manage-browser-exploration <setup|status|remove>");
}
