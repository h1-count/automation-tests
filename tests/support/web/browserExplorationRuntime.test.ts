import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { installExploreMutationGuard } from "../../../src/support/web/automationMode.js";

test("exploration guard blocks page-initiated writes before they reach the server", {
  skip: !existsSync(chromium.executablePath())
}, async (context) => {
  let writes = 0;
  const server = createServer((request, response) => {
    if (request.method === "POST") writes += 1;
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<script>fetch('/write', { method: 'POST' }).catch(() => undefined)</script><main>safe</main>");
      return;
    }
    response.writeHead(204);
    response.end();
  });
  await new Promise<void>((accept) => server.listen(0, "127.0.0.1", accept));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const profile = await mkdtemp(resolve(tmpdir(), "browser-exploration-guard-"));
  const blocked: string[] = [];
  const contextBrowser = await chromium.launchPersistentContext(profile, {
    headless: true,
    serviceWorkers: "block"
  });
  context.after(async () => {
    await contextBrowser.close();
    await rm(profile, { recursive: true, force: true });
    await new Promise<void>((accept, reject) => server.close((error) => error ? reject(error) : accept()));
  });
  await installExploreMutationGuard(contextBrowser, {
    onBlocked: (attempt) => blocked.push(attempt.method)
  });
  const page = await contextBrowser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.waitForTimeout(150);
  assert.equal(writes, 0);
  assert.deepEqual(blocked, ["POST"]);
});
