import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Suite-model run roots (industry-aligned layout).
 *
 * - Stable design assets live in the suite directory
 *   `testcases/<type>/<project>/suites/<feature>/` and are committed to Git.
 * - Per-run state (plan.md, workflow-history.ndjson, review records) lives in
 *   the local run archive `.local/test-runs/<type>/<project>/<request>/` and
 *   is never committed; recovering on another machine means starting a fresh
 *   run from the suite.
 * - Legacy requests whose history still exists under `testcases/<requestId>/`
 *   keep resolving there (read-only replay compatibility).
 */
export const RUN_ROOT_MODES = ["local-test-runs", "legacy-testcases"] as const;
export type RunRootMode = (typeof RUN_ROOT_MODES)[number];

export const SUITE_BINDING_FILENAME = "suite.json";

export function legacyRequestRootPath(workspaceRoot: string, requestId: string): string {
  return resolve(workspaceRoot, "testcases", ...requestId.split("/"));
}

export function localRunRootPath(workspaceRoot: string, requestId: string): string {
  return resolve(workspaceRoot, ".local", "test-runs", ...requestId.split("/"));
}

export interface ResolvedRunRoot {
  root: string;
  mode: RunRootMode;
}

/**
 * Explicit mode wins. Otherwise a request whose workflow history (or plan)
 * already exists under the legacy `testcases/<requestId>` directory and has no
 * local run archive keeps using the legacy root; everything else — including
 * every brand-new request — uses `.local/test-runs/<requestId>`.
 */
export function resolveRunRoot(
  workspaceRoot: string,
  requestId: string,
  mode?: RunRootMode
): ResolvedRunRoot {
  if (mode === "legacy-testcases" || mode === "local-test-runs") {
    return {
      root: mode === "legacy-testcases"
        ? legacyRequestRootPath(workspaceRoot, requestId)
        : localRunRootPath(workspaceRoot, requestId),
      mode
    };
  }
  const legacy = legacyRequestRootPath(workspaceRoot, requestId);
  const local = localRunRootPath(workspaceRoot, requestId);
  const legacyActive = existsSync(resolve(legacy, "workflow-history.ndjson"))
    || existsSync(resolve(legacy, "plan.md"));
  const localActive = existsSync(resolve(local, "workflow-history.ndjson"))
    || existsSync(resolve(local, "plan.md"))
    || existsSync(resolve(local, SUITE_BINDING_FILENAME));
  if (legacyActive && !localActive) {
    return { root: legacy, mode: "legacy-testcases" };
  }
  return { root: local, mode: "local-test-runs" };
}

/** `web/open-platform/login-register` → `testcases/web/open-platform/suites/login-register` */
export function suiteDirectoryPath(workspaceRoot: string, suiteId: string): string {
  const segments = suiteId.split("/");
  if (segments.length !== 3 || segments.some((segment) => !/^[a-z0-9][a-z0-9-]*$/u.test(segment))) {
    throw new Error(`suiteId must be <type>/<project>/<feature> with lowercase slugs: ${suiteId}`);
  }
  const [type, project, feature] = segments;
  return resolve(workspaceRoot, "testcases", type!, project!, "suites", feature!);
}

export interface SuiteBinding {
  suiteId: string;
}

export function readSuiteBinding(runRoot: string): SuiteBinding | undefined {
  const bindingPath = resolve(runRoot, SUITE_BINDING_FILENAME);
  if (!existsSync(bindingPath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(bindingPath, "utf8")) as unknown;
    if (
      parsed
      && typeof parsed === "object"
      && typeof (parsed as { suiteId?: unknown }).suiteId === "string"
      && (parsed as { suiteId: string }).suiteId
    ) {
      return { suiteId: (parsed as { suiteId: string }).suiteId };
    }
  } catch {
    // A malformed binding file is treated as absent; callers fall back to the
    // run root and surface the failure when the suite asset is actually read.
  }
  return undefined;
}

export function writeSuiteBinding(runRoot: string, suiteId: string): void {
  mkdirSync(runRoot, { recursive: true });
  writeFileSync(
    resolve(runRoot, SUITE_BINDING_FILENAME),
    `${JSON.stringify({ suiteId }, null, 2)}\n`,
    "utf8"
  );
}

export function isCasesPackageName(name: string): boolean {
  return name === "cases.md" || /^cases-[a-z0-9][a-z0-9-]*\.md$/u.test(name);
}
