import assert from "node:assert/strict";
import test from "node:test";
import {
  installExploreMutationGuard,
  isExploreRequestAllowed,
  resolveAutomationMode
} from "../../../src/support/web/automationMode.js";

function request(method: string, url = "https://example.test/api/resource") {
  return { method: () => method, url: () => url };
}

test("explore permits safe reads and blocks business mutation methods by default", () => {
  assert.equal(isExploreRequestAllowed(request("GET") as never), true);
  assert.equal(isExploreRequestAllowed(request("HEAD") as never), true);
  assert.equal(isExploreRequestAllowed(request("OPTIONS") as never), true);
  assert.equal(isExploreRequestAllowed(request("POST") as never), false);
  assert.equal(isExploreRequestAllowed(request("PUT") as never), false);
  assert.equal(isExploreRequestAllowed(request("PATCH") as never), false);
  assert.equal(isExploreRequestAllowed(request("DELETE") as never), false);
});

test("read-only POST exceptions require an explicit anchored allowlist", () => {
  const query = request("POST", "https://example.test/api/query/list");
  assert.equal(isExploreRequestAllowed(query as never, [/^https:\/\/example\.test\/api\/query\/list$/]), true);
  assert.equal(isExploreRequestAllowed(query as never, [/query/]), false);
  assert.equal(isExploreRequestAllowed(request("POST", "https://example.test/api/create") as never, [/\/query\//]), false);
});

test("explore route guard aborts a mutation and emits a sanitized attempt", async () => {
  let routeHandler: ((route: never) => Promise<void>) | undefined;
  const target = {
    async route(_pattern: string, handler: (route: never) => Promise<void>) {
      routeHandler = handler;
    }
  };
  const blocked: Array<{ method: string; resourceType: string; url: string }> = [];
  await installExploreMutationGuard(target as never, {
    onBlocked: (attempt) => blocked.push(attempt)
  });
  let aborted = "";
  await routeHandler!({
    request: () => ({
      method: () => "POST",
      url: () => "https://example.test/api/create?secret=redacted",
      resourceType: () => "fetch"
    }),
    abort: async (reason: string) => { aborted = reason; },
    continue: async () => {}
  } as never);
  assert.equal(aborted, "blockedbyclient");
  assert.deepEqual(blocked, [{
    method: "POST",
    resourceType: "fetch",
    url: "https://example.test/api/create"
  }]);
});

test("automation mode defaults to execute unless a project explicitly selects explore", () => {
  assert.equal(resolveAutomationMode(undefined), "execute");
  assert.equal(resolveAutomationMode("explore"), "explore");
  assert.equal(resolveAutomationMode("execute"), "execute");
});
