import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function markdownTableCells(line: string): string[] | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return undefined;
  const cells: string[] = [];
  let current = "";
  let backslashRun = 0;
  for (const character of trimmed.slice(1, -1)) {
    if (character === "|" && backslashRun % 2 === 0) {
      cells.push(current.trim());
      current = "";
      backslashRun = 0;
      continue;
    }
    current += character;
    backslashRun = character === "\\" ? backslashRun + 1 : 0;
  }
  cells.push(current.trim());
  return cells;
}

/**
 * Hashes the immutable execution scope while excluding only the decision that
 * confirms that same hash. Earlier plan/case/business decisions remain input.
 */
export function digestPlanForExecutionAuthorization(path: string): string {
  const normalized = readFileSync(path, "utf8")
    .replace(/\r\n/g, "\n")
    .trimEnd() + "\n";
  const lines = normalized.split("\n");
  const decisionStart = lines.findIndex((line) =>
    /^##\s+正式用户决定\s*$/.test(line)
  );
  if (decisionStart >= 0) {
    const nextSectionOffset = lines
      .slice(decisionStart + 1)
      .findIndex((line) => /^##\s+/.test(line));
    const decisionEnd = nextSectionOffset < 0
      ? lines.length
      : decisionStart + 1 + nextSectionOffset;
    const headerOffset = lines
      .slice(decisionStart + 1, decisionEnd)
      .findIndex((line) => {
        const cells = markdownTableCells(line);
        return cells?.includes("决定类型")
          && cells.includes("subjectDigest")
          && cells.includes("正式决定");
      });
    if (headerOffset >= 0) {
      const headerIndex = decisionStart + 1 + headerOffset;
      const headers = markdownTableCells(lines[headerIndex]!)!;
      const typeIndex = headers.indexOf("决定类型");
      for (let index = decisionEnd - 1; index >= headerIndex + 2; index -= 1) {
        const cells = markdownTableCells(lines[index]!);
        const decisionType = cells?.[typeIndex]?.trim().replace(/^`|`$/g, "");
        if (decisionType === "执行清单确认") lines.splice(index, 1);
      }
      const updatedNextSectionOffset = lines
        .slice(decisionStart + 1)
        .findIndex((line) => /^##\s+/.test(line));
      const updatedDecisionEnd = updatedNextSectionOffset < 0
        ? lines.length
        : decisionStart + 1 + updatedNextSectionOffset;
      const hasRemainingDecision = lines
        .slice(headerIndex + 2, updatedDecisionEnd)
        .some((line) => markdownTableCells(line)?.length === headers.length);
      if (!hasRemainingDecision) {
        lines.splice(decisionStart, updatedDecisionEnd - decisionStart);
      }
    }
  }
  return sha256(lines.join("\n").trimEnd() + "\n");
}

export function assertExecutionAuthorizationInputsCurrent(
  record: Record<string, unknown>,
  workspaceRoot: string,
  planPath: string
): void {
  if (
    typeof record.planDigest !== "string"
    || digestPlanForExecutionAuthorization(planPath) !== record.planDigest
  ) {
    throw new Error("Execution authorization plan scope no longer matches plan.md.");
  }
  if (!Array.isArray(record.scriptDigests) || record.scriptDigests.length === 0) {
    throw new Error("Execution authorization requires at least one script digest.");
  }
  const root = resolve(workspaceRoot);
  for (const item of record.scriptDigests) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Execution authorization contains a malformed script digest.");
    }
    const path = (item as Record<string, unknown>).path;
    const digest = (item as Record<string, unknown>).digest;
    if (typeof path !== "string" || typeof digest !== "string") {
      throw new Error("Execution authorization contains a malformed script digest.");
    }
    const absolute = resolve(root, path);
    const withinRoot = relative(root, absolute);
    if (
      !withinRoot
      || withinRoot === ".."
      || withinRoot.startsWith(`..${sep}`)
      || resolve(root, withinRoot) !== absolute
      || !/^[a-f0-9]{64}$/.test(digest)
    ) {
      throw new Error(`Execution authorization contains an unsafe script digest path: ${path}.`);
    }
    if (sha256(readFileSync(absolute)) !== digest) {
      throw new Error(`Execution authorization script changed after review: ${path}.`);
    }
  }
}
