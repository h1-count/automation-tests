import type { BrowserContext, Page, Request, Route } from "@playwright/test";

export type AutomationMode = "explore" | "execute";

export interface ExploreMutationGuardOptions {
  /** Some systems expose read-only RPCs over POST. Every exception must be
   * reviewed and expressed as an anchored URL pattern. */
  readOnlyPostAllowlist?: RegExp[];
  onBlocked?: (attempt: BlockedMutationAttempt) => void;
}

export interface BlockedMutationAttempt {
  method: string;
  url: string;
  resourceType: string;
}

type Routable = Pick<BrowserContext, "route"> | Pick<Page, "route">;

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export function resolveAutomationMode(value: unknown, fallback: AutomationMode = "execute"): AutomationMode {
  return value === "explore" || value === "execute" ? value : fallback;
}

export function isExploreRequestAllowed(request: Pick<Request, "method" | "url">, readOnlyPostAllowlist: RegExp[] = []): boolean {
  const method = request.method().toUpperCase();
  if (safeMethods.has(method)) return true;
  return method === "POST" && readOnlyPostAllowlist.some((pattern) =>
    pattern.source.startsWith("^") && pattern.source.endsWith("$") && pattern.test(request.url())
  );
}

export async function installExploreMutationGuard(
  target: Routable,
  options: ExploreMutationGuardOptions = {}
): Promise<void> {
  await target.route("**/*", async (route: Route) => {
    const request = route.request();
    if (isExploreRequestAllowed(request, options.readOnlyPostAllowlist)) {
      await route.continue();
      return;
    }
    const attempt: BlockedMutationAttempt = {
      method: request.method().toUpperCase(),
      url: sanitizeUrl(request.url()),
      resourceType: request.resourceType()
    };
    options.onBlocked?.(attempt);
    await route.abort("blockedbyclient");
  });
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "<invalid-url>";
  }
}
