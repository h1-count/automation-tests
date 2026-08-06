import type { Page, Request, Route } from "@playwright/test";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export interface ReviewedReadOnlyRequestContract {
  contractId: string;
  method: string;
  path: string;
}

export interface NoWriteNetworkPolicy {
  reviewedReadOnlyRequests?: ReviewedReadOnlyRequestContract[];
  forbiddenMutationPaths: string[];
}

export async function assertNoUnauthorizedWriteRequests<T>(
  page: Page,
  policy: NoWriteNetworkPolicy,
  body: () => Promise<T>
): Promise<T> {
  const forbiddenPaths = new Set(policy.forbiddenMutationPaths);
  const reviewedReadOnlyRequests = new Set(
    (policy.reviewedReadOnlyRequests ?? []).map((contract) =>
      requestKey(contract.method, contract.path)
    )
  );
  const violations: string[] = [];
  const intercept = async (route: Route, request: Request) => {
    const method = request.method().toUpperCase();
    if (safeMethods.has(method)) {
      await route.fallback();
      return;
    }
    const path = safePathname(request.url());
    if (path && reviewedReadOnlyRequests.has(requestKey(method, path))) {
      await route.fallback();
      return;
    }
    if (path && forbiddenPaths.has(path)) {
      violations.push(`${method} ${path} is a forbidden business mutation.`);
    } else {
      violations.push(`${method} ${path ?? "<invalid-url>"} has no reviewed read-only contract.`);
    }
    await route.abort("blockedbyclient");
  };

  await page.route("**/*", intercept);
  let result: T | undefined;
  let bodyError: unknown;
  let bodyFailed = false;
  try {
    result = await body();
  } catch (error) {
    bodyFailed = true;
    bodyError = error;
  } finally {
    await page.unroute("**/*", intercept);
  }
  if (violations.length > 0) {
    const violation = new Error(
      `No-write network boundary was violated: ${violations.join(" ")}`
    );
    if (bodyFailed) {
      (violation as Error & { cause?: unknown }).cause = bodyError;
    }
    throw violation;
  }
  if (bodyFailed) throw bodyError;
  return result as T;
}

function requestKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function safePathname(url: string): string | undefined {
  try {
    return new URL(url).pathname;
  } catch {
    return undefined;
  }
}
