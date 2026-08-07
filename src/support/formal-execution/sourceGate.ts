import { parse } from "@babel/parser";

export interface FormalSpecInspection {
  caseIds: string[];
  issues: string[];
}

export interface FormalSpecInspectionOptions {
  manifestSchemaVersion?:
    | "formal-execution-manifest-v1"
    | "formal-execution-manifest-v2"
    | "formal-execution-manifest-v3";
}

export function inspectFormalSpecSources(
  sources: Array<{ path: string; source: string }>,
  expectedCaseIds: string[],
  options: FormalSpecInspectionOptions = {}
): FormalSpecInspection {
  const caseIds: string[] = [];
  const issues: string[] = [];
  for (const source of sources) {
    const localExpected = extractFormalCaseIds(source.source);
    const inspection = inspectFormalSpecSource(source.source, localExpected, options);
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

export function inspectFormalSpecSource(
  source: string,
  expectedCaseIds: string[],
  options: FormalSpecInspectionOptions = {}
): FormalSpecInspection {
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
  const requiresBusinessOracle = options.manifestSchemaVersion === "formal-execution-manifest-v3";
  for (const callback of callbacks) {
    if (!callback.body.body.length) {
      issues.push(`${callback.caseId} has an empty formalCase implementation.`);
      continue;
    }
    if (containsCall(callback.body, "blockForMissingContracts")) {
      issues.push(`${callback.caseId} uses a fixed missing-contract blocker instead of a candidate implementation.`);
    }
    if (requiresBusinessOracle) {
      inspectV3BusinessOracleUsage(callback, issues);
    }
    const substantive = containsSubstantiveImplementation(callback.body, requiresBusinessOracle);
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

function inspectV3BusinessOracleUsage(
  callback: FormalCaseCallback,
  issues: string[]
): void {
  const verifyCalls = findCalls(callback.body, "verifyBusinessOracle");
  if (verifyCalls.length === 0) {
    issues.push(`${callback.caseId} does not verify any structured business oracle.`);
  }
  const hasDirectOutcomeWrite =
    containsCall(callback.body, "recordOracleResult")
    || containsCall(callback.body, "recordBusinessOracleResult");
  if (hasDirectOutcomeWrite) {
    issues.push(`${callback.caseId} directly records a business oracle outcome.`);
    if (containsLiteralOutcome(callback.body)) {
      issues.push(`${callback.caseId} contains a literal business oracle outcome.`);
    }
  }
  if (containsCall(callback.body, "classifyFailure")) {
    issues.push(`${callback.caseId} uses legacy classifyFailure() in a v3 formal case.`);
  }
  for (const call of verifyCalls) {
    const args = isAstNodeArray(call.arguments) ? call.arguments : [];
    const oracleId = args[0];
    const evaluator = args[1];
    if (!oracleId || oracleId.type !== "StringLiteral") {
      issues.push(`${callback.caseId} verifyBusinessOracle() requires a literal oracleId.`);
    }
    if (
      !evaluator
      || !["ArrowFunctionExpression", "FunctionExpression"].includes(evaluator.type)
      || !isAstNode(evaluator.body)
    ) {
      issues.push(`${callback.caseId} verifyBusinessOracle() requires an inline evaluator.`);
      continue;
    }
    const evaluatorBody = evaluator.body;
    if (containsLiteralOutcome(evaluatorBody)) {
      issues.push(`${callback.caseId} contains a literal business oracle outcome.`);
    }
    if (containsEvaluatorMutation(evaluatorBody)) {
      issues.push(`${callback.caseId} mutates runtime state inside a business oracle evaluator.`);
    }
    if (
      (evaluatorBody.type === "BlockStatement"
        && (!isAstNodeArray(evaluatorBody.body) || evaluatorBody.body.length === 0))
      || !containsEvaluatorObservation(evaluatorBody)
    ) {
      issues.push(`${callback.caseId} business oracle evaluator has no reviewed assertion decision.`);
    }
  }
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

function findCalls(node: AstNode, expectedName: string): AstNode[] {
  const calls: AstNode[] = [];
  visitAst(node, (child) => {
    if (child.type === "CallExpression" && callName(child.callee) === expectedName) {
      calls.push(child);
    }
  });
  return calls;
}

function containsLiteralOutcome(node: AstNode): boolean {
  let found = false;
  visitAst(node, (child) => {
    if (found || child.type !== "ObjectProperty" || !isAstNode(child.key)) return;
    const key = child.key.type === "Identifier"
      ? child.key.name
      : child.key.type === "StringLiteral"
        ? child.key.value
        : undefined;
    if (key === "outcome") found = true;
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

function containsSubstantiveImplementation(node: AstNode, requiresBusinessOracle: boolean): boolean {
  let found = false;
  const substantiveMethods = new Set([
    "check",
    "click",
    "confirmResource",
    "evaluate",
    "fill",
    "goto",
    "leaseResource",
    "press",
    "releaseResource",
    "verifyBusinessOracle",
    "selectOption",
    "setFiles",
    "setInputFiles",
    "uncheck",
    "useCapability"
  ]);
  if (!requiresBusinessOracle) substantiveMethods.add("addAssertion");
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

function containsEvaluatorObservation(node: AstNode): boolean {
  let found = false;
  const assertionMethods = new Set([
    "deepEqual",
    "doesNotMatch",
    "equal",
    "fail",
    "match",
    "notDeepEqual",
    "notEqual",
    "ok",
    "rejects",
    "strictEqual",
    "throws"
  ]);
  const assertionHelpers = /^(?:assert|expect|verify)/u;
  visitAst(node, (child) => {
    if (found || child.type !== "CallExpression") return;
    const name = callName(child.callee);
    if (assertionMethods.has(name) || assertionHelpers.test(name)) found = true;
  });
  return found;
}

function containsEvaluatorMutation(node: AstNode): boolean {
  let found = false;
  const mutationMethods = new Set([
    "addAssertion",
    "addEvidence",
    "addOperationEvidence",
    "awaitExternalTransition",
    "check",
    "click",
    "completeStage",
    "confirmResource",
    "fill",
    "goto",
    "leaseResource",
    "press",
    "publishResource",
    "releaseResource",
    "reserveOperation",
    "selectOption",
    "setFiles",
    "setInputFiles",
    "uncheck"
  ]);
  visitAst(node, (child) => {
    if (found || child.type !== "CallExpression") return;
    if (mutationMethods.has(callName(child.callee))) found = true;
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
