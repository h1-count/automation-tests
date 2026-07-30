import { posix } from "node:path";

export const RULE_OWNER_PATHS = {
  "task.lifecycle": "docs/testing/automation-guideline.md",
  "automation.environment": "docs/testing/environment-guideline.md",
  "automation.testcases": "docs/testing/testcase-guideline.md",
  "automation.selectors": "docs/testing/selector-guideline.md",
  "automation.reporting": "docs/testing/report-guideline.md"
} as const;

export const REQUIRED_AUTOMATION_DELEGATIONS = [
  "automation.environment",
  "automation.testcases",
  "automation.selectors",
  "automation.reporting"
] as const;

export interface RuleDocument {
  path: string;
  content: string;
}

export interface RuleResponsibilityInspection {
  ownerViolations: string[];
  delegationViolations: string[];
}

const ownerMarkerPattern = /<!--\s*owns:\s*([a-z.]+)\s*-->/g;
const delegationStartPattern = /^<!--\s*delegates:\s*([a-z.]+(?:\s*,\s*[a-z.]+)*)\s*-->$/;
const delegationEndPattern = /^<!--\s*end-delegates\s*-->$/;
const markdownLinkPattern = /\]\(([^)]+)\)/g;
const maxDelegationCharacters = 600;

function normalizeRepositoryPath(path: string): string {
  return posix.normalize(path.replaceAll("\\", "/").replace(/^\.?\//, ""));
}

function linkTargets(sourcePath: string, line: string): Set<string> {
  const sourceDirectory = posix.dirname(normalizeRepositoryPath(sourcePath));
  return new Set(
    [...line.matchAll(markdownLinkPattern)].flatMap((match) => {
      const rawTarget = (match[1] ?? "").trim().replace(/^<|>$/g, "");
      const fileTarget = rawTarget.split("#", 1)[0]!.split("?", 1)[0]!;
      if (!fileTarget || /^[a-z][a-z0-9+.-]*:/i.test(fileTarget)) return [];
      return [normalizeRepositoryPath(posix.join(sourceDirectory, fileTarget))];
    })
  );
}

function inspectOwners(documents: readonly RuleDocument[]): {
  owners: Map<string, string[]>;
  violations: string[];
} {
  const owners = new Map<string, string[]>();
  for (const document of documents) {
    for (const match of document.content.matchAll(ownerMarkerPattern)) {
      const owner = match[1]!;
      owners.set(owner, [...(owners.get(owner) ?? []), normalizeRepositoryPath(document.path)]);
    }
  }

  const violations = Object.entries(RULE_OWNER_PATHS).flatMap(([owner, expectedPath]) => {
    const paths = owners.get(owner) ?? [];
    const normalizedExpected = normalizeRepositoryPath(expectedPath);
    return paths.length === 1 && paths[0] === normalizedExpected
      ? []
      : [`${owner}: expected ${normalizedExpected}, got ${paths.join(", ") || "none"}`];
  });
  for (const [owner, paths] of owners) {
    if (!(owner in RULE_OWNER_PATHS)) {
      violations.push(`${owner}: unexpected owner marker in ${paths.join(", ")}`);
    }
  }
  return { owners, violations };
}

function inspectDelegations(
  automationDocument: RuleDocument | undefined,
  owners: ReadonlyMap<string, string[]>
): string[] {
  if (!automationDocument) {
    return [`Missing ${RULE_OWNER_PATHS["task.lifecycle"]}.`];
  }

  const violations: string[] = [];
  const delegatedOwners = new Set<string>();
  const lines = automationDocument.content.split(/\r?\n/);
  let open:
    | {
        line: number;
        owners: string[];
        content: string[];
      }
    | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index]!.trim();
    const start = trimmed.match(delegationStartPattern);
    if (start) {
      if (open) {
        violations.push(`Delegation at line ${index + 1} is nested inside line ${open.line}.`);
        continue;
      }
      open = {
        line: index + 1,
        owners: start[1]!.split(",").map((owner) => owner.trim()),
        content: []
      };
      continue;
    }
    if (delegationEndPattern.test(trimmed)) {
      if (!open) {
        violations.push(`Delegation end at line ${index + 1} has no matching start.`);
        continue;
      }

      const content = open.content.join("\n").trim();
      const firstContentLine = open.content.find((line) => line.trim())?.trim() ?? "";
      const targets = linkTargets(automationDocument.path, firstContentLine);
      const paragraphs = content ? content.split(/\n\s*\n/).filter(Boolean) : [];
      if (!content) {
        violations.push(`Delegation at line ${open.line} has no summary.`);
      }
      if (open.content.some((line) => /^\s{0,3}#{1,6}\s+/.test(line))) {
        violations.push(`Delegation at line ${open.line} contains a heading.`);
      }
      if (paragraphs.length > 1 || content.length > maxDelegationCharacters) {
        violations.push(
          `Delegation at line ${open.line} exceeds one paragraph or ${maxDelegationCharacters} characters.`
        );
      }

      for (const owner of open.owners) {
        delegatedOwners.add(owner);
        const ownerPaths = owners.get(owner) ?? [];
        if (ownerPaths.length !== 1) {
          violations.push(`Delegation at line ${open.line} targets non-unique owner ${owner}.`);
        } else if (!targets.has(ownerPaths[0]!)) {
          violations.push(
            `Delegation to ${owner} at line ${open.line} must link ${ownerPaths[0]} in its first content line.`
          );
        }
        if (!REQUIRED_AUTOMATION_DELEGATIONS.includes(
          owner as (typeof REQUIRED_AUTOMATION_DELEGATIONS)[number]
        )) {
          violations.push(`Delegation at line ${open.line} targets unsupported owner ${owner}.`);
        }
      }
      open = undefined;
      continue;
    }
    if (open) open.content.push(lines[index]!);
  }

  if (open) {
    violations.push(`Delegation at line ${open.line} has no matching end.`);
  }
  for (const owner of REQUIRED_AUTOMATION_DELEGATIONS) {
    if (!delegatedOwners.has(owner)) {
      violations.push(`Missing delegation from task.lifecycle to ${owner}.`);
    }
  }
  return violations;
}

export function inspectRuleResponsibilities(
  documents: readonly RuleDocument[]
): RuleResponsibilityInspection {
  const normalizedDocuments = documents.map((document) => ({
    path: normalizeRepositoryPath(document.path),
    content: document.content
  }));
  const { owners, violations: ownerViolations } = inspectOwners(normalizedDocuments);
  const automationDocument = normalizedDocuments.find(
    (document) => document.path === RULE_OWNER_PATHS["task.lifecycle"]
  );
  return {
    ownerViolations,
    delegationViolations: inspectDelegations(automationDocument, owners)
  };
}
