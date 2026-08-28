import { createHash } from "node:crypto";
import { canonicalJson } from "./canonicalJson.js";
import type { SafeJsonValue } from "./types.js";
import { markdownSection, markdownTableRows, parseRuleCaseRecords } from "../testcase/relationProjection.js";
import {
  isStructuredTestcaseDocumentVersion,
  parseTestcaseDocument
} from "../testcase/testcaseDocument.js";

export const CURRENT_CASE_REVIEW_RISK_SCHEMA_VERSION = "case-review-risk-v1" as const;
export const CASE_REVIEW_RISK_SCHEMA_VERSION = "case-review-risk-v1" as const;

export type CaseReviewRiskLevel = "light" | "standard" | "strict";

export interface CaseReviewRiskCase {
  caseId: string;
  level: CaseReviewRiskLevel;
  reasons: string[];
  requirementRefs: string[];
  ruleRefs: string[];
}

export interface CaseReviewRiskAssessment {
  schemaVersion: typeof CASE_REVIEW_RISK_SCHEMA_VERSION;
  distribution: "uniform" | "mixed";
  maxLevel: CaseReviewRiskLevel;
  counts: Record<CaseReviewRiskLevel, number>;
  cases: CaseReviewRiskCase[];
  digest: string;
}

interface ParsedCase {
  metadata: Map<string, string>;
  preconditions: string;
  operations: string[];
  semanticInputs: string[];
}

const levelRank: Record<CaseReviewRiskLevel, number> = {
  light: 0,
  standard: 1,
  strict: 2
};

const businessWriteOperation = /(?:选择并)?上传|(?<!已)提交(?:申请|表单|注册|第二)|创建(?:申请|资源|企业)|更新(?:企业|资源|申请|名称|地址)|重新申请|删除|清理/iu;
const strictSecurityOperation = /(?:请求|发送|获取|输入|填写).{0,12}(?:验证码|OTP)|权限变更|特权操作|安全挑战|滑块|图形验证码|人机验证|\bCAPTCHA\b|设备动作|控制硬件|刷固件|断网|\bMQTT\b|结果未知|无法判定|冻结.{0,12}intent|\breconciliation\b/iu;
const sensitiveAuthenticationOperation = /(?:填写|输入).{0,80}(?:密码|口令).{0,80}(?:提交|登录)|(?:账号密码|密码凭据)通知|凭据通知脱敏/iu;
const standardContext = /已注册|唯一性|重复|手机号|验证码|审核|通知|状态|认证|登录|资源|企业管理员|联系人|申请人|地址|提交后|权威|异步|\bfixture\b|台账|外部|会话/iu;
const simpleFieldOperation = /填写|输入|留空|触发.{0,8}校验|格式校验|长度边界/iu;
const readOnlyNavigationOperation = /进入|打开|导航|跳转|账户入口|访问/iu;

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function extractRefs(value: string, prefix: "REQ" | "RULE"): string[] {
  return uniqueSorted(
    [...value.matchAll(new RegExp(`\\b${prefix}-[A-Z0-9-]+\\b`, "gu"))]
      .map((match) => match[0]!)
  );
}

function section(body: string, heading: string): string {
  const match = new RegExp(`^##\\s+${heading}\\s*$`, "mu").exec(body);
  if (!match) return "";
  const start = match.index + match[0].length;
  const next = /^##\s+/mu.exec(body.slice(start));
  return body.slice(start, next ? start + next.index : undefined).trim();
}

function markdownCells(line: string): string[] {
  if (!line.trim().startsWith("|")) return [];
  return line.trim().split("|").slice(1, -1).map((cell) => cell.trim());
}

function parseMetadata(value: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of value.split(/\r?\n/u)) {
    const cells = markdownCells(line);
    if (cells.length >= 2 && cells[0] && cells[0] !== "项目" && !/^[-:]+$/u.test(cells[0])) {
      result.set(cells[0], cells[1] ?? "");
    }
  }
  return result;
}

function parseOperations(value: string): string[] {
  const operations: string[] = [];
  for (const line of value.split(/\r?\n/u)) {
    const cells = markdownCells(line);
    if (cells.length >= 2 && /^\d+$/u.test(cells[0] ?? "")) {
      operations.push(cells[1] ?? "");
    }
  }
  return operations;
}

function requestDefaultDataStrategy(plan?: string): string | undefined {
  if (!plan) return undefined;
  const row = markdownTableRows(markdownSection(plan, "## 请求默认值"))
    .find((cells) => cells[0] === "数据策略");
  return row?.[1]?.replace(/`/gu, "").trim();
}

function parseCases(markdownSources: string[], plan?: string): ParsedCase[] {
  const inheritedDataStrategy = requestDefaultDataStrategy(plan);
  return markdownSources.flatMap((source) => {
    const document = parseTestcaseDocument(source);
    if (!isStructuredTestcaseDocumentVersion(document.version)) {
      throw new Error("Case review risk only accepts testcase-v1-layered.");
    }
    return document.cases.map((testcase) => {
        const metadata = new Map<string, string>([
          ["用例编号", testcase.caseId],
          ["规则编号", testcase.ruleIds.join("、")],
          ["优先级", testcase.priority],
          ["数据策略", testcase.overrides.dataStrategy
            ?? inheritedDataStrategy
            ?? document.defaults.dataStrategy
            ?? ""]
        ]);
        if (testcase.overrides.risk) metadata.set("风险等级", testcase.overrides.risk);
        return {
          metadata,
          preconditions: testcase.preconditions,
          operations: testcase.executionRows.map((row) => row.action),
          semanticInputs: testcase.executionRows.flatMap((row) => [
            row.data,
            row.expected
          ])
        };
      });
  });
}

function classify(
  testcase: ParsedCase,
  requirementRefsByRule: Map<string, string[]>
): CaseReviewRiskCase {
  const caseId = testcase.metadata.get("用例编号")?.trim() ?? "";
  if (!/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/u.test(caseId)) {
    throw new Error("Case review risk requires every testcase body to have a valid caseId.");
  }
  const dataStrategy = testcase.metadata.get("数据策略")?.trim().toLowerCase() ?? "";
  if (!dataStrategy) {
    throw new Error(`Case review risk requires ${caseId} to declare a data strategy.`);
  }
  const explicitRequirementRefs = extractRefs(
    testcase.metadata.get("需求编号") ?? testcase.metadata.get("需求追溯编号") ?? "",
    "REQ"
  );
  const ruleRefs = extractRefs(
    testcase.metadata.get("规则编号") ?? testcase.metadata.get("规则覆盖编号") ?? "",
    "RULE"
  );
  const requirementRefs = uniqueSorted([
    ...explicitRequirementRefs,
    ...ruleRefs.flatMap((ruleRef) => requirementRefsByRule.get(ruleRef) ?? [])
  ]);
  const operations = testcase.operations.join("\n");
  const semanticInputs = testcase.semanticInputs.join("\n");
  const riskText = `${operations}\n${semanticInputs}`;

  if (strictSecurityOperation.test(riskText)) {
    return {
      caseId,
      level: "strict",
      reasons: ["operation:security_or_unknown_result"],
      requirementRefs,
      ruleRefs
    };
  }
  if (sensitiveAuthenticationOperation.test(riskText)) {
    return {
      caseId,
      level: "strict",
      reasons: ["operation:sensitive_authentication"],
      requirementRefs,
      ruleRefs
    };
  }

  const declaredRisk = testcase.metadata.get("风险等级")?.trim() ?? "";
  const reviewText = `${testcase.preconditions}\n${riskText}`;
  const lowDeclaredRisk = declaredRisk === "低" || /^low$/iu.test(declaredRisk);
  const simpleField = simpleFieldOperation.test(operations) && !standardContext.test(reviewText);
  const simpleNavigation = readOnlyNavigationOperation.test(operations)
    && !standardContext.test(reviewText);
  if (dataStrategy !== "no_write" || businessWriteOperation.test(riskText)) {
    return {
      caseId,
      level: "standard",
      reasons: [businessWriteOperation.test(riskText)
        ? "operation:ordinary_test_write"
        : `data_strategy:${dataStrategy}`],
      requirementRefs,
      ruleRefs
    };
  }
  if (lowDeclaredRisk || simpleField || simpleNavigation) {
    return {
      caseId,
      level: "light",
      reasons: [simpleNavigation ? "bounded_read_only_navigation" : "bounded_read_only_field"],
      requirementRefs,
      ruleRefs
    };
  }

  const reasons = standardContext.test(reviewText)
    ? ["operation:external_or_stateful_read"]
    : declaredRisk === "高" || /^high$/iu.test(declaredRisk)
      ? ["declared_risk:high"]
      : ["bounded_non_write_complexity"];
  return {
    caseId,
    level: "standard",
    reasons,
    requirementRefs,
    ruleRefs
  };
}

function digestPayload(cases: CaseReviewRiskCase[]): SafeJsonValue {
  return {
    schemaVersion: CASE_REVIEW_RISK_SCHEMA_VERSION,
    cases: cases.map((item) => ({
      caseId: item.caseId,
      level: item.level,
      reasons: [...item.reasons],
      requirementRefs: [...item.requirementRefs],
      ruleRefs: [...item.ruleRefs]
    }))
  };
}

export function caseReviewRiskDigest(
  assessment: Pick<CaseReviewRiskAssessment, "cases">
): string {
  const cases = [...assessment.cases]
    .map((item) => ({
      ...item,
      reasons: uniqueSorted(item.reasons),
      requirementRefs: uniqueSorted(item.requirementRefs),
      ruleRefs: uniqueSorted(item.ruleRefs)
    }))
    .sort((left, right) => left.caseId.localeCompare(right.caseId));
  return createHash("sha256")
    .update(canonicalJson(digestPayload(cases)), "utf8")
    .digest("hex");
}

/**
 * Assesses each testcase independently from its structured basic information,
 * preconditions and executable steps. Source, assumptions and missingInfo are
 * deliberately outside the risk input so descriptive text cannot escalate a case.
 */
export function assessCaseReviewRisk(
  markdownSources: string | string[],
  options: { plan?: string } = {}
): CaseReviewRiskAssessment {
  const sources = Array.isArray(markdownSources) ? markdownSources : [markdownSources];
  const requirementRefsByRule = new Map(
    (options.plan ? parseRuleCaseRecords(options.plan) : [])
      .map((rule) => [rule.id, rule.reqIds] as const)
  );
  const cases = parseCases(sources, options.plan)
    .map((testcase) => classify(testcase, requirementRefsByRule))
    .sort((left, right) => left.caseId.localeCompare(right.caseId));
  if (!cases.length) throw new Error("Case review risk requires at least one testcase body.");
  const duplicates = cases.filter((item, index) =>
    cases.findIndex((candidate) => candidate.caseId === item.caseId) !== index
  );
  if (duplicates.length) {
    throw new Error(`Case review risk contains duplicate caseIds: ${uniqueSorted(
      duplicates.map((item) => item.caseId)
    ).join(", ")}.`);
  }
  const counts: Record<CaseReviewRiskLevel, number> = {
    light: cases.filter((item) => item.level === "light").length,
    standard: cases.filter((item) => item.level === "standard").length,
    strict: cases.filter((item) => item.level === "strict").length
  };
  const maxLevel = cases.reduce<CaseReviewRiskLevel>(
    (current, item) => levelRank[item.level] > levelRank[current] ? item.level : current,
    "light"
  );
  return {
    schemaVersion: CASE_REVIEW_RISK_SCHEMA_VERSION,
    distribution: Object.values(counts).filter((count) => count > 0).length > 1
      ? "mixed"
      : "uniform",
    maxLevel,
    counts,
    cases,
    digest: caseReviewRiskDigest({ cases })
  };
}
