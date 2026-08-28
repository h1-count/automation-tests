import { posix } from "node:path";

export const RULE_OWNER_PATHS = {
  "task.lifecycle": "docs/testing/automation-guideline.md",
  "automation.environment": "docs/testing/environment-guideline.md",
  "automation.testcases": "docs/testing/testcase-guideline.md",
  "automation.selectors": "docs/testing/selector-guideline.md",
  "automation.reporting": "docs/testing/report-guideline.md",
  "automation.project-knowledge": "docs/testing/knowledge/README.md",
  "automation.contracts": "docs/testing/contract-registry.md"
} as const;

export const REQUIRED_DOCUMENT_DELEGATIONS = {
  "docs/testing/automation-guideline.md": [
    "automation.environment",
    "automation.testcases",
    "automation.selectors",
    "automation.reporting",
    "automation.project-knowledge",
    "automation.contracts"
  ],
  "docs/testing/report-guideline.md": ["automation.project-knowledge"],
  "docs/testing/testcase-guideline.md": ["automation.contracts"]
} as const;

export interface RuleDocument {
  path: string;
  content: string;
}

export interface RuleResponsibilityInspection {
  ownerViolations: string[];
  delegationViolations: string[];
  supportingViolations: string[];
}

export const SUPPORTING_DOCUMENT_ROLES = {
  "README.md": "project-entry-only",
  "scripts/README.md": "command-index-only",
  "testcases/README.md": "directory-index-only",
  "skills/iot-automation-testing/SKILL.md": "orchestration-only",
  "skills/iot-automation-testing/templates/test-plan.template.md": "structure-only",
  "skills/iot-automation-testing/templates/testcase-package.template.md": "structure-only",
  "skills/iot-automation-testing/templates/testcase.template.md": "structure-only",
  "skills/iot-automation-testing/templates/playwright.spec.template.ts": "structure-only"
} as const;

const rootRuleRequiredOwners = ["task.lifecycle", "automation.testcases"] as const;
const rootRuleDelegatedDetailPatterns = [
  { label: "workflow/testcase version policy", pattern: /\bv[567]\b|testcase-v\d/u },
  {
    label: "testcase design activity chain",
    pattern: /source-selection|candidate-generation|candidate-gate|case-confirmation/u
  },
  {
    label: "workflow reuse branch algorithm",
    pattern: /full_replan|affected_rebuild|direct_execute/u
  },
  {
    label: "delivery target algorithm",
    pattern: /testcase_only|script_only|full_run|--delivery-target|graphDigest/u
  },
  {
    label: "automatic execution authorization algorithm",
    pattern: /policy_auto_no_write_v1|read_only\s*\+\s*no_write/u
  },
  {
    label: "reviewer lifecycle implementation",
    pattern: /review-policy-v1|deterministic_only|ReviewerSubmitted/u
  },
  {
    label: "host lifecycle state implementation",
    pattern: /continue_now|宿主提供跨回合长期任务能力/u
  }
] as const;

const forbiddenTemplateSections: Record<string, readonly string[]> = {
  "skills/iot-automation-testing/templates/test-plan.template.md": [
    "覆盖基准与拆分清单",
    "覆盖矩阵",
    "独立需求追溯矩阵",
    "规则设计矩阵",
    "规则邻域复核表",
    "用例集评审汇总",
    "预计交付物",
    "测试方式"
  ],
  "skills/iot-automation-testing/templates/testcase.template.md": [
    "自动化状态",
    "是否需要人工确认",
    "覆盖关联",
    "评审与演进回链"
  ],
  "skills/iot-automation-testing/templates/testcase-package.template.md": [
    "自动化状态",
    "是否需要人工确认",
    "覆盖关联",
    "评审与演进回链"
  ]
};

const ownerMarkerPattern = /<!--\s*owns:\s*([a-z.-]+)\s*-->/g;
const delegationStartPattern = /^<!--\s*delegates:\s*([a-z.-]+(?:\s*,\s*[a-z.-]+)*)\s*-->$/;
const delegationEndPattern = /^<!--\s*end-delegates\s*-->$/;
const markdownLinkPattern = /\]\(([^)]+)\)/g;
const maxDelegationCharacters = 600;
const delegatedRuleDetailPatterns: Partial<Record<keyof typeof RULE_OWNER_PATHS, readonly RegExp[]>> = {
  "automation.project-knowledge": [
    /\bcandidate-add\b/u,
    /受控探索已验证/u,
    /正式执行已验证/u,
    /同一[“"]?项目[^\n]*适用范围[^\n]*(?:覆盖|更新)/u,
    /原位覆盖/u
  ]
};
const supportingDocumentRequiredOwners: Partial<
  Record<keyof typeof SUPPORTING_DOCUMENT_ROLES, readonly (keyof typeof RULE_OWNER_PATHS)[]>
> = {
  "README.md": ["task.lifecycle", "automation.testcases"],
  "testcases/README.md": ["task.lifecycle", "automation.testcases"],
  "skills/iot-automation-testing/SKILL.md": [
    "task.lifecycle",
    "automation.testcases",
    "automation.contracts"
  ]
};

interface SupportingRoleBoundary {
  forbiddenHeadings?: readonly string[];
  forbiddenPatterns?: readonly { label: string; pattern: RegExp }[];
}

const supportingRoleBoundaries: Partial<
  Record<(typeof SUPPORTING_DOCUMENT_ROLES)[keyof typeof SUPPORTING_DOCUMENT_ROLES], SupportingRoleBoundary>
> = {
  "project-entry-only": {
    forbiddenHeadings: ["常用命令"],
    forbiddenPatterns: [
      {
        label: "embedded command catalog",
        pattern: /\bnpm\s+run\s+[a-z][a-z0-9:_-]*/iu
      }
    ]
  },
  "directory-index-only": {
    forbiddenPatterns: [
      {
        label: "request plan fact contract",
        pattern: /\bplan\.md\b[^。\n]*(?:REQ|RULE|评审|决定|工程层|事实源|维护)/iu
      },
      {
        label: "request workflow fact contract",
        pattern: /\bworkflow-history\.ndjson\b[^。\n]*(?:Activity|等待|重试|阻塞|恢复|终态|事实源|维护)/iu
      },
      {
        label: "request asset layout contract",
        pattern: /(?:cases-<module|cases-<[^>]+>|cases-[a-z0-9_-]+\.md|结构化用例包|用例包目录)/iu
      }
    ]
  }
};
const forbiddenSupportingRuleDetailPatterns: Partial<
  Record<keyof typeof SUPPORTING_DOCUMENT_ROLES, readonly { label: string; pattern: RegExp }[]>
> = {
  "skills/iot-automation-testing/SKILL.md": [
    {
      label: "testcase layered display contract",
      pattern: /顶部五列快速索引|折叠详情|折叠标题|五列执行表|数据编号、步骤、操作、测试数据、预期结果/u
    },
    {
      label: "testcase parameterization contract",
      pattern: /参数实例必须共享[^。\n]*(?:步骤集合|操作链)/u
    },
    {
      label: "testcase authorization placement contract",
      pattern: /文件顶部[^。\n]*不授权执行|前置条件[^。\n]*本轮不执行/u
    },
    {
      label: "testcase current contract boundary",
      pattern: /旧工程用例格式[^。\n]*(?:不迁移|原格式)/u
    },
    {
      label: "Excel workbook layout contract",
      pattern: /工作簿固定为|单表层级矩阵|公共属性按执行行纵向合并/u
    },
    {
      label: "execution auto-authorization algorithm",
      pattern: /policy_auto_no_write_v1/u
    },
    {
      label: "reviewer lifecycle algorithm",
      pattern: /deterministic_only[^。\n]*reviewer Activity|lean reviewer[^。\n]*strict/u
    }
  ]
};

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

export function inspectRootRuleBoundary(content: string): string[] {
  const violations: string[] = [];
  const targets = linkTargets("AGENTS.md", content);
  for (const owner of rootRuleRequiredOwners) {
    const ownerPath = RULE_OWNER_PATHS[owner];
    if (!targets.has(ownerPath)) {
      violations.push(`AGENTS.md: must delegate ${owner} to ${ownerPath}.`);
    }
  }
  for (const { label, pattern } of rootRuleDelegatedDetailPatterns) {
    if (pattern.test(content)) {
      violations.push(`AGENTS.md: duplicates delegated ${label}.`);
    }
  }
  return violations;
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

function inspectDocumentDelegations(
  document: RuleDocument | undefined,
  expectedPath: string,
  requiredOwners: readonly string[],
  owners: ReadonlyMap<string, string[]>
): string[] {
  if (!document) {
    return [`Missing ${expectedPath}.`];
  }

  const violations: string[] = [];
  const delegatedOwners = new Set<string>();
  const outsideDelegations: string[] = [];
  const lines = document.content.split(/\r?\n/);
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
      const targets = linkTargets(document.path, firstContentLine);
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
        if (!requiredOwners.includes(owner)) {
          violations.push(`Delegation at line ${open.line} targets unsupported owner ${owner}.`);
        }
      }
      open = undefined;
      continue;
    }
    if (open) {
      open.content.push(lines[index]!);
    } else {
      outsideDelegations.push(lines[index]!);
    }
  }

  if (open) {
    violations.push(`Delegation at line ${open.line} has no matching end.`);
  }
  for (const owner of requiredOwners) {
    if (!delegatedOwners.has(owner)) {
      violations.push(`Missing delegation from ${expectedPath} to ${owner}.`);
    }
    for (const pattern of delegatedRuleDetailPatterns[owner as keyof typeof RULE_OWNER_PATHS] ?? []) {
      if (pattern.test(outsideDelegations.join("\n"))) {
        violations.push(`${expectedPath}: duplicates delegated rule details for ${owner}.`);
        break;
      }
    }
  }
  return violations;
}

function inspectDelegations(
  documents: readonly RuleDocument[],
  owners: ReadonlyMap<string, string[]>
): string[] {
  return Object.entries(REQUIRED_DOCUMENT_DELEGATIONS).flatMap(([path, requiredOwners]) =>
    inspectDocumentDelegations(
      documents.find((document) => document.path === path),
      path,
      requiredOwners,
      owners
    )
  );
}

function normalizedParagraphs(content: string): string[] {
  return content
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph
      .replace(/<!--.*?-->/gs, "")
      .replace(/\s+/g, " ")
      .trim())
    .filter((paragraph) => paragraph.length >= 120
      && !paragraph.startsWith("|")
      && !paragraph.startsWith("```")
      && !paragraph.startsWith("#"));
}

function inspectSupportingDocuments(
  ownerDocuments: readonly RuleDocument[],
  supportingDocuments: readonly RuleDocument[]
): string[] {
  const violations: string[] = [];
  const ownerParagraphs = new Map<string, string>();
  for (const document of ownerDocuments) {
    for (const paragraph of normalizedParagraphs(document.content)) {
      ownerParagraphs.set(paragraph, document.path);
    }
  }
  const normalizedSupporting = supportingDocuments.map((document) => ({
    path: normalizeRepositoryPath(document.path),
    content: document.content
  }));
  for (const [path, role] of Object.entries(SUPPORTING_DOCUMENT_ROLES)) {
    const document = normalizedSupporting.find((candidate) => candidate.path === path);
    if (!document) {
      violations.push(`${path}: missing supporting document.`);
      continue;
    }
    if (
      !document.content.includes(`<!-- role: ${role} -->`)
      && !document.content.includes(`// role: ${role}`)
    ) {
      violations.push(`${path}: missing role marker ${role}.`);
    }
    if (ownerMarkerPattern.test(document.content)) {
      violations.push(`${path}: supporting documents cannot own normative rules.`);
    }
    ownerMarkerPattern.lastIndex = 0;
    const targets = linkTargets(path, document.content);
    for (const owner of supportingDocumentRequiredOwners[
      path as keyof typeof SUPPORTING_DOCUMENT_ROLES
    ] ?? []) {
      const ownerPath = RULE_OWNER_PATHS[owner];
      if (!targets.has(ownerPath)) {
        violations.push(`${path}: must link delegated owner ${owner} at ${ownerPath}.`);
      }
    }
    for (const { label, pattern } of forbiddenSupportingRuleDetailPatterns[
      path as keyof typeof SUPPORTING_DOCUMENT_ROLES
    ] ?? []) {
      if (pattern.test(document.content)) {
        violations.push(`${path}: duplicates delegated ${label}.`);
      }
    }
    const roleBoundary = supportingRoleBoundaries[role];
    for (const { label, pattern } of roleBoundary?.forbiddenPatterns ?? []) {
      if (pattern.test(document.content)) {
        violations.push(`${path}: ${role} forbids ${label}.`);
      }
    }
    for (const heading of roleBoundary?.forbiddenHeadings ?? []) {
      const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`^#{1,6}\\s+${escaped}\\s*$`, "mu").test(document.content)) {
        violations.push(`${path}: ${role} forbids section ${heading}.`);
      }
    }
    for (const heading of forbiddenTemplateSections[path] ?? []) {
      const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`^#{1,6}\\s+${escaped}\\s*$`, "mu").test(document.content)) {
        violations.push(`${path}: forbidden duplicate section ${heading}.`);
      }
    }
    for (const paragraph of normalizedParagraphs(document.content)) {
      const ownerPath = ownerParagraphs.get(paragraph);
      if (ownerPath) {
        violations.push(`${path}: duplicates normative paragraph from ${ownerPath}.`);
      }
    }
  }
  return violations;
}

export function inspectRuleResponsibilities(
  documents: readonly RuleDocument[],
  supportingDocuments: readonly RuleDocument[] = []
): RuleResponsibilityInspection {
  const normalizedDocuments = documents.map((document) => ({
    path: normalizeRepositoryPath(document.path),
    content: document.content
  }));
  const { owners, violations: ownerViolations } = inspectOwners(normalizedDocuments);
  return {
    ownerViolations,
    delegationViolations: inspectDelegations(normalizedDocuments, owners),
    supportingViolations: supportingDocuments.length
      ? inspectSupportingDocuments(normalizedDocuments, supportingDocuments)
      : []
  };
}
