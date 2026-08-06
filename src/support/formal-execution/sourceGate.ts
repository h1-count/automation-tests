import { parse } from "@babel/parser";

export interface FormalSpecInspection {
  caseIds: string[];
  issues: string[];
}

export function inspectFormalSpecSources(
  sources: Array<{ path: string; source: string }>,
  expectedCaseIds: string[]
): FormalSpecInspection {
  const caseIds: string[] = [];
  const issues: string[] = [];
  for (const source of sources) {
    const localExpected = extractFormalCaseIds(source.source);
    const inspection = inspectFormalSpecSource(source.source, localExpected);
    caseIds.push(...inspection.caseIds);
    issues.push(...inspection.issues.map((issue) => `${source.path}: ${issue}`));
  }
  const duplicate = caseIds.filter((caseId, index) => caseIds.indexOf(caseId) !== index);
  if (duplicate.length > 0) {
    issues.push(`Duplicate formal caseIds across files: ${[...new Set(duplicate)].join(", ")}.`);
  }
  const actual = [...new Set(caseIds)].sort();
  const expected = [...new Set(expectedCaseIds)].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    issues.push(`Formal case scope differs from confirmed testcase packages: ${actual.length}/${expected.length}.`);
  }
  return { caseIds: actual, issues };
}

export function inspectFormalSpecSource(source: string, expectedCaseIds: string[]): FormalSpecInspection {
  const caseIds = extractFormalCaseIds(source);
  const issues: string[] = [];
  if (caseIds.length === 0) issues.push("Formal scripts must register tests through formalCase().");
  if (/mode\s*:\s*["']serial["']/.test(source)) issues.push("File-level serial mode is forbidden.");
  if (/\btest\.skip\s*\(/.test(source)) issues.push("Bare test.skip() is forbidden.");
  if (/(^|[^\w.])test\s*\(/m.test(source)) issues.push("Bare test() is forbidden.");
  const duplicate = caseIds.filter((caseId, index) => caseIds.indexOf(caseId) !== index);
  if (duplicate.length > 0) issues.push(`Duplicate formal caseIds: ${[...new Set(duplicate)].join(", ")}.`);
  for (const line of source.split(/\r?\n/).filter((item) => item.includes("formalCase("))) {
    const ids = line.match(/\b[A-Z][A-Z0-9]+(?:-[A-Z0-9]+){2,}\b/g) ?? [];
    if (ids.length > 1) issues.push("A formalCase declaration contains an aggregate caseId title.");
  }
  const sourceFile = parse(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx"]
  }) as unknown as AstNode;
  const callbacks = formalCaseCallbacks(sourceFile);
  for (const callback of callbacks) {
    if (!callback.body.body.length) {
      issues.push(`${callback.caseId} has an empty formalCase implementation.`);
      continue;
    }
    if (containsCall(callback.body, "blockForMissingContracts")) {
      issues.push(`${callback.caseId} uses a fixed missing-contract blocker instead of a candidate implementation.`);
    }
    const substantive = containsSubstantiveImplementation(callback.body);
    const last = callback.body.body.at(-1);
    if (
      !substantive
      && last?.type === "ThrowStatement"
      && containsIdentifier(last, "FormalBlockedError")
    ) {
      issues.push(`${callback.caseId} ends with an unconditional FormalBlockedError.`);
    }
    if (!substantive) {
      issues.push(`${callback.caseId} contains only guards or declarations and has no business action or assertion.`);
    }
  }
  const actual = [...new Set(caseIds)].sort();
  const expected = [...new Set(expectedCaseIds)].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    issues.push(`Formal case scope differs from confirmed testcase packages: ${actual.length}/${expected.length}.`);
  }
  return { caseIds, issues };
}

function extractFormalCaseIds(source: string): string[] {
  return [...source.matchAll(/formalCase\(\s*"([A-Z][A-Z0-9]+(?:-[A-Z0-9]+){2,})"/g)]
    .map((match) => match[1]!);
}

interface FormalCaseCallback {
  caseId: string;
  body: AstBlock;
}

interface AstNode {
  type: string;
  [key: string]: unknown;
}

interface AstBlock extends AstNode {
  type: "BlockStatement";
  body: AstNode[];
}

function formalCaseCallbacks(sourceFile: AstNode): FormalCaseCallback[] {
  const callbacks: FormalCaseCallback[] = [];
  visitAst(sourceFile, (node) => {
    if (
      node.type === "CallExpression"
      && callName(node.callee) === "formalCase"
      && isAstNodeArray(node.arguments)
      && node.arguments[0]?.type === "StringLiteral"
    ) {
      const callback = node.arguments[2];
      if (
        callback
        && ["ArrowFunctionExpression", "FunctionExpression"].includes(callback.type)
        && isAstNode(callback.body)
        && callback.body.type === "BlockStatement"
      ) {
        callbacks.push({
          caseId: String(node.arguments[0].value),
          body: callback.body as AstBlock
        });
      }
    }
  });
  return callbacks;
}

function containsCall(node: AstNode, expectedName: string): boolean {
  let found = false;
  visitAst(node, (child) => {
    if (found) return;
    if (child.type === "CallExpression" && callName(child.callee) === expectedName) {
      found = true;
    }
  });
  return found;
}

function containsIdentifier(node: AstNode, expectedName: string): boolean {
  let found = false;
  visitAst(node, (child) => {
    if (found) return;
    if (child.type === "Identifier" && child.name === expectedName) {
      found = true;
    }
  });
  return found;
}

function containsSubstantiveImplementation(node: AstNode): boolean {
  let found = false;
  const substantiveMethods = new Set([
    "addAssertion",
    "check",
    "click",
    "confirmResource",
    "evaluate",
    "fill",
    "goto",
    "leaseResource",
    "press",
    "releaseResource",
    "selectOption",
    "setFiles",
    "setInputFiles",
    "uncheck",
    "useCapability"
  ]);
  const substantiveHelpers = /^(?:assert|cleanup|execute|expect|fill|login|navigate|open|perform|query|read|replace|reserve|submit|upload|verify|wait)/u;
  visitAst(node, (child) => {
    if (found) return;
    if (child.type === "CallExpression") {
      const name = callName(child.callee);
      if (
        name === "expect"
        || substantiveMethods.has(name)
        || substantiveHelpers.test(name)
      ) {
        found = true;
      }
    }
  });
  return found;
}

function callName(value: unknown): string {
  if (!isAstNode(value)) return "";
  if (value.type === "Identifier") return String(value.name ?? "");
  if (value.type === "MemberExpression" || value.type === "OptionalMemberExpression") {
    const property = value.property;
    if (isAstNode(property) && property.type === "Identifier") {
      return String(property.name ?? "");
    }
    if (isAstNode(property) && property.type === "StringLiteral") {
      return String(property.value ?? "");
    }
  }
  return "";
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

function isAstNodeArray(value: unknown): value is AstNode[] {
  return Array.isArray(value) && value.every(isAstNode);
}
