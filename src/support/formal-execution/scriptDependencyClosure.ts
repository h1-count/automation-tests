import { parse } from "@babel/parser";
import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync
} from "node:fs";
import { dirname, extname, relative, resolve, sep } from "node:path";

export interface LocalScriptDependencyClosure {
  paths: string[];
  dependenciesByPath: ReadonlyMap<string, readonly string[]>;
  runtimeLeafPaths: ReadonlySet<string>;
  issues: string[];
}

const moduleExtensions = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json"
] as const;

const parseableExtensions = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs"
]);

const trustedFormalRuntimePrefix = "src/support/formal-execution/";

/**
 * Formal Runner modules are frozen as direct runtime leaves, but their own
 * transitive implementation graph is governed as Runner infrastructure rather
 * than expanded into each request's business-script review.
 */
export function isFormalRuntimeLeafPath(path: string): boolean {
  return path.split(sep).join("/").startsWith(trustedFormalRuntimePrefix);
}

interface AstNode {
  type: string;
  [key: string]: unknown;
}

/**
 * Resolves the complete workspace-local module graph rooted at the selected
 * formal entry scripts. Type-only imports and bare packages remain external.
 * A directly imported formal Runner module is byte-frozen as a runtime leaf;
 * every other relative runtime import is recursively resolved in the workspace.
 */
export function resolveLocalScriptDependencyClosure(input: {
  workspaceRoot: string;
  entryPaths: readonly string[];
  allowSyntaxErrors?: boolean;
}): LocalScriptDependencyClosure {
  if (!input.entryPaths.length) {
    throw new Error("Formal script dependency closure requires at least one entry script.");
  }
  const root = workspaceRoot(input.workspaceRoot);
  const entries = input.entryPaths.map((path) =>
    safeWorkspaceFile(root, path, "formal script entry")
  );
  if (new Set(entries).size !== entries.length) {
    throw new Error("Formal script entry paths must be unique.");
  }

  const pending = [...entries];
  const visited = new Set<string>();
  const dependenciesByPath = new Map<string, readonly string[]>();
  const runtimeLeafPaths = new Set<string>();
  const issues: string[] = [];
  while (pending.length) {
    const path = pending.pop()!;
    if (visited.has(path)) continue;
    visited.add(path);
    const runtimeLeaf = isFormalRuntimeLeafPath(path);
    if (runtimeLeaf) runtimeLeafPaths.add(path);
    const resolution = runtimeLeaf
      ? { paths: [], issues: [] }
      : parseableExtensions.has(extname(path).toLowerCase())
        ? resolveDependencies(root, path, input.allowSyntaxErrors ?? false)
        : { paths: [], issues: [] };
    const dependencies = resolution.paths;
    issues.push(...resolution.issues);
    dependenciesByPath.set(path, dependencies);
    for (const dependency of dependencies) {
      if (!visited.has(dependency)) pending.push(dependency);
    }
  }

  return {
    paths: [...visited].sort(),
    dependenciesByPath,
    runtimeLeafPaths,
    issues: [...new Set(issues)]
  };
}

/**
 * Ensures a frozen authorization contains exactly the transitive local module
 * graph selected by the current Runner. Returns the normalized closure so the
 * caller can verify every byte digest against the same file set.
 */
export function assertExactLocalScriptDependencyClosure(input: {
  workspaceRoot: string;
  entryPaths: readonly string[];
  frozenPaths: readonly string[];
}): string[] {
  const root = workspaceRoot(input.workspaceRoot);
  const closure = resolveLocalScriptDependencyClosure({
    workspaceRoot: root.lexical,
    entryPaths: input.entryPaths
  }).paths;
  const frozen = input.frozenPaths.map((path) =>
    safeWorkspaceFile(root, path, "authorized script")
  );
  if (new Set(frozen).size !== frozen.length) {
    throw new Error("Authorized script paths must be unique.");
  }
  const closureSet = new Set(closure);
  const frozenSet = new Set(frozen);
  const missing = closure.filter((path) => !frozenSet.has(path));
  const unexpected = frozen.filter((path) => !closureSet.has(path)).sort();
  if (missing.length || unexpected.length) {
    const details = [
      missing.length ? `missing local dependencies: ${missing.join(", ")}` : "",
      unexpected.length ? `unexpected frozen scripts: ${unexpected.join(", ")}` : ""
    ].filter(Boolean).join("; ");
    throw new Error(`Formal script authorization differs from the exact local dependency closure (${details}).`);
  }
  return closure;
}

function resolveDependencies(
  root: WorkspaceRoot,
  importerPath: string,
  allowSyntaxErrors: boolean
): { paths: string[]; issues: string[] } {
  const source = readFileSync(resolve(root.lexical, importerPath), "utf8");
  let sourceFile: AstNode | undefined;
  const issues: string[] = [];
  try {
    sourceFile = parse(source, {
      sourceType: "unambiguous",
      plugins: ["typescript", "jsx", "importAttributes"]
    }) as unknown as AstNode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const issue = `Cannot parse formal script dependency graph for ${importerPath}: ${message}`;
    if (!allowSyntaxErrors) throw new Error(issue);
    issues.push(issue);
  }
  const specifiers = sourceFile
    ? extractAstSpecifiers(sourceFile, importerPath, allowSyntaxErrors, issues)
    : fallbackSpecifiers(source);
  const paths: string[] = [];
  for (const specifier of [...new Set(specifiers.filter((item) => item.startsWith(".")))]) {
    try {
      const dependency = resolveLocalSpecifier(root, importerPath, specifier);
      paths.push(dependency);
    } catch (error) {
      if (!allowSyntaxErrors) throw error;
      issues.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { paths: [...new Set(paths)].sort(), issues };
}

function extractAstSpecifiers(
  sourceFile: AstNode,
  importerPath: string,
  allowSyntaxErrors: boolean,
  issues: string[]
): string[] {
  const specifiers: string[] = [];
  try {
    visitAst(sourceFile, (node) => {
      if (
        ["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"].includes(node.type)
        && isStringLiteral(node.source)
      ) {
        if (isTypeOnlyDeclaration(node)) return;
        specifiers.push(String(node.source.value));
        return;
      }
      if (node.type === "TSImportEqualsDeclaration" && isAstNode(node.moduleReference)) {
        const expression = node.moduleReference.expression;
        if (isStringLiteral(expression)) specifiers.push(String(expression.value));
        return;
      }
      if (node.type === "ImportExpression") {
        if (!isStringLiteral(node.source)) {
          throw new Error(`Dynamic import in ${importerPath} must use a literal module specifier.`);
        }
        specifiers.push(String(node.source.value));
        return;
      }
      if (node.type !== "CallExpression") return;
      if (isAstNode(node.callee) && node.callee.type === "Import") {
        const argument = firstCallArgument(node);
        if (!isStringLiteral(argument)) {
          throw new Error(`Dynamic import in ${importerPath} must use a literal module specifier.`);
        }
        specifiers.push(String(argument.value));
        return;
      }
      if (isIdentifier(node.callee, "require")) {
        const argument = firstCallArgument(node);
        if (!isStringLiteral(argument)) {
          throw new Error(`require() in ${importerPath} must use a literal module specifier.`);
        }
        specifiers.push(String(argument.value));
      }
    });
  } catch (error) {
    if (!allowSyntaxErrors) throw error;
    issues.push(error instanceof Error ? error.message : String(error));
  }
  return specifiers;
}

function fallbackSpecifiers(source: string): string[] {
  return [
    ...source.matchAll(/\b(?:import|export)\b[\s\S]{0,500}?\bfrom\s*["']([^"']+)["']/gu),
    ...source.matchAll(/\bimport\s*["']([^"']+)["']/gu),
    ...source.matchAll(/\b(?:import|require)\s*\(\s*["']([^"']+)["']/gu)
  ].map((match) => match[1]!);
}

function resolveLocalSpecifier(
  root: WorkspaceRoot,
  importerPath: string,
  specifier: string
): string {
  const base = resolve(root.lexical, dirname(importerPath), specifier);
  assertLexicallyInside(root.lexical, base, `Local import ${specifier} from ${importerPath}`);
  for (const candidate of resolutionCandidates(base)) {
    if (!existsSync(candidate) || !statSync(candidate).isFile()) continue;
    return safeWorkspaceFile(root, candidate, `Local import ${specifier} from ${importerPath}`);
  }
  throw new Error(`Local import ${specifier} from ${importerPath} does not resolve to a workspace file.`);
}

function resolutionCandidates(base: string): string[] {
  const candidates = [base];
  const extension = extname(base).toLowerCase();
  if (!extension) {
    candidates.push(...moduleExtensions.map((suffix) => `${base}${suffix}`));
  } else if (extension === ".js") {
    candidates.push(`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`);
  } else if (extension === ".mjs") {
    candidates.push(`${base.slice(0, -4)}.mts`);
  } else if (extension === ".cjs") {
    candidates.push(`${base.slice(0, -4)}.cts`);
  }
  candidates.push(...moduleExtensions.map((suffix) => resolve(base, `index${suffix}`)));
  return [...new Set(candidates)];
}

interface WorkspaceRoot {
  lexical: string;
  real: string;
}

function workspaceRoot(path: string): WorkspaceRoot {
  const lexical = resolve(path);
  if (!existsSync(lexical) || !statSync(lexical).isDirectory()) {
    throw new Error("Formal script dependency workspace root must be an existing directory.");
  }
  return { lexical, real: realpathSync(lexical) };
}

function safeWorkspaceFile(
  root: WorkspaceRoot,
  path: string,
  label: string
): string {
  const absolute = resolve(root.lexical, path);
  assertLexicallyInside(root.lexical, absolute, label);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    throw new Error(`${label} must reference an existing regular file.`);
  }
  const real = realpathSync(absolute);
  assertLexicallyInside(root.real, real, `${label} resolved target`);
  return relative(root.lexical, absolute).split(sep).join("/");
}

function assertLexicallyInside(root: string, path: string, label: string): void {
  const withinRoot = relative(root, path);
  if (!withinRoot || withinRoot === ".." || withinRoot.startsWith(`..${sep}`)) {
    throw new Error(`${label} must stay inside the workspace.`);
  }
}

function firstCallArgument(node: AstNode): unknown {
  return Array.isArray(node.arguments) ? node.arguments[0] : undefined;
}

function isTypeOnlyDeclaration(node: AstNode): boolean {
  if (node.importKind === "type" || node.exportKind === "type") return true;
  const specifiers = Array.isArray(node.specifiers)
    ? node.specifiers.filter(isAstNode)
    : [];
  return specifiers.length > 0 && specifiers.every((specifier) =>
    specifier.importKind === "type" || specifier.exportKind === "type"
  );
}

function isIdentifier(value: unknown, name: string): boolean {
  return isAstNode(value) && value.type === "Identifier" && value.name === name;
}

function isStringLiteral(value: unknown): value is AstNode & { value: string } {
  return isAstNode(value) && value.type === "StringLiteral" && typeof value.value === "string";
}

function visitAst(node: AstNode, visitor: (node: AstNode) => void): void {
  visitor(node);
  for (const value of Object.values(node)) {
    if (isAstNode(value)) visitAst(value, visitor);
    else if (Array.isArray(value)) {
      for (const item of value) {
        if (isAstNode(item)) visitAst(item, visitor);
      }
    }
  }
}

function isAstNode(value: unknown): value is AstNode {
  return Boolean(value)
    && typeof value === "object"
    && typeof (value as { type?: unknown }).type === "string";
}
