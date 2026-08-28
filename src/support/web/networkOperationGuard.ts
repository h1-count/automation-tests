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
    const path = safePathname(request.url());
    // 禁止路径按部署语义判定，与动词无关：被测系统存在 GET 型变更端点
    // （如 GET /open-platform/product/del），no-write 用例不得因“安全动词”放行。
    // OPTIONS 仅承载 CORS 预检、不携带业务语义，仍按安全方法放行。
    if (path && forbiddenPaths.has(path) && method !== "OPTIONS") {
      violations.push(`${method} ${path} is a forbidden business mutation.`);
      await route.abort("blockedbyclient");
      return;
    }
    if (safeMethods.has(method)) {
      await route.fallback();
      return;
    }
    if (path && reviewedReadOnlyRequests.has(requestKey(method, path))) {
      await route.fallback();
      return;
    }
    violations.push(`${method} ${path ?? "<invalid-url>"} has no reviewed read-only contract.`);
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
