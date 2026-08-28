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
 */
export const RUN_ROOT_MODES = ["local-test-runs"] as const;
export type RunRootMode = (typeof RUN_ROOT_MODES)[number];

export const SUITE_BINDING_FILENAME = "suite.json";
export const CANDIDATE_SCRIPTS_DIRECTORY = "candidate-scripts";

export function localRunRootPath(workspaceRoot: string, requestId: string): string {
  return resolve(workspaceRoot, ".local", "test-runs", ...requestId.split("/"));
}

/** Candidate build outputs are local to one request; tests/ is suite-owned Git code. */
export function candidateScriptsDirectoryPath(workspaceRoot: string, requestId: string): string {
  return resolve(localRunRootPath(workspaceRoot, requestId), CANDIDATE_SCRIPTS_DIRECTORY);
}

export function candidateScriptManifestPath(workspaceRoot: string, requestId: string): string {
  return resolve(candidateScriptsDirectoryPath(workspaceRoot, requestId), "execution.manifest.ts");
}

/** The only accepted Web build input. It remains local to the current request. */
export function formalWebScriptSpecPath(workspaceRoot: string, requestId: string): string {
  return resolve(candidateScriptsDirectoryPath(workspaceRoot, requestId), "formal-web-script-spec.json");
}

export interface ResolvedRunRoot {
  root: string;
  mode: RunRootMode;
}

/**
 * Every current request uses its local run archive. Stable design assets are
 * resolved independently through the frozen suite binding.
 */
export function resolveRunRoot(
  workspaceRoot: string,
  requestId: string,
  _mode?: RunRootMode
): ResolvedRunRoot {
  return { root: localRunRootPath(workspaceRoot, requestId), mode: "local-test-runs" };
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
