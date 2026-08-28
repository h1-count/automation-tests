import assert from "node:assert/strict";
import test from "node:test";
import {
  assertNoUnauthorizedWriteRequests
} from "../../../src/support/web/networkOperationGuard.js";

class FakePage {
  readonly outcomes: Array<"aborted" | "continued"> = [];
  private handler?: (route: unknown, request: unknown) => Promise<void>;

  async route(
    _pattern: string,
    handler: (route: unknown, request: unknown) => Promise<void>
  ): Promise<void> {
    this.handler = handler;
  }

  async unroute(
    _pattern: string,
    handler: (route: unknown, request: unknown) => Promise<void>
  ): Promise<void> {
    if (this.handler === handler) this.handler = undefined;
  }

  async emitRequest(method: string, path: string): Promise<void> {
    if (!this.handler) throw new Error("No route handler is registered.");
    await this.handler({
      abort: async () => this.outcomes.push("aborted"),
      fallback: async () => this.outcomes.push("continued")
    }, {
      method: () => method,
      url: () => `https://test.invalid${path}`
    });
  }

  hasRoute(): boolean {
    return Boolean(this.handler);
  }
}

const policy = {
  forbiddenMutationPaths: ["/company/file-upload", "/get/msg/code", "/registration"],
  reviewedReadOnlyRequests: [{
    contractId: "company-name-availability-v1",
    method: "POST",
    path: "/company/name/available"
  }]
};

test("no-write guard allows safe methods and reviewed read-only POST contracts", async () => {
  const page = new FakePage();
  await assert.doesNotReject(() => assertNoUnauthorizedWriteRequests(
    page as never,
    policy,
    async () => {
      await page.emitRequest("GET", "/registration/options");
      await page.emitRequest("POST", "/company/name/available");
    }
  ));
  assert.deepEqual(page.outcomes, ["continued", "continued"]);
});

test("no-write guard rejects known mutations and unknown unsafe methods", async () => {
  const mutationPage = new FakePage();
  await assert.rejects(
    () => assertNoUnauthorizedWriteRequests(mutationPage as never, policy, async () => {
      await mutationPage.emitRequest("POST", "/get/msg/code");
    }),
    /forbidden business mutation/
  );
  assert.deepEqual(mutationPage.outcomes, ["aborted"]);

  const unknownPage = new FakePage();
  await assert.rejects(
    () => assertNoUnauthorizedWriteRequests(unknownPage as never, policy, async () => {
      await unknownPage.emitRequest("POST", "/company/unknown-check");
    }),
    /no reviewed read-only contract/
  );
  assert.deepEqual(unknownPage.outcomes, ["aborted"]);
});

test("no-write guard blocks GET-typed forbidden mutation endpoints before safe-method bypass", async () => {
  const page = new FakePage();
  await assert.rejects(
    () => assertNoUnauthorizedWriteRequests(page as never, policy, async () => {
      await page.emitRequest("GET", "/registration");
    }),
    /forbidden business mutation/
  );
  assert.deepEqual(page.outcomes, ["aborted"]);
});

test("no-write guard always detaches its listener", async () => {
  const page = new FakePage();
  await assert.rejects(
    () => assertNoUnauthorizedWriteRequests(page as never, policy, async () => {
      await page.emitRequest("POST", "/registration");
    })
  );
  assert.equal(page.hasRoute(), false);
});

test("no-write violation remains primary when the guarded body also fails", async () => {
  const page = new FakePage();
  await assert.rejects(
    () => assertNoUnauthorizedWriteRequests(page as never, policy, async () => {
      await page.emitRequest("POST", "/get/msg/code");
      throw new Error("later product assertion failed");
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /No-write network boundary was violated/);
      assert.match(String(error.cause), /later product assertion failed/);
      return true;
    }
  );
  assert.deepEqual(page.outcomes, ["aborted"]);
  assert.equal(page.hasRoute(), false);
});
