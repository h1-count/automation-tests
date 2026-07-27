export type ReviewFindingCategory =
  | "需求覆盖缺口"
  | "资料明确的设计缺口"
  | "业务裁决/资料冲突"
  | "质量建议";

export type KnowledgeDecisionScope = "需求事实" | "通用规则" | "项目经验候选" | "项目经验" | "未验证推断";

export interface KnowledgeDecisionFinding {
  id: string;
  category: ReviewFindingCategory;
}

export interface KnowledgeDecision {
  findingId: string;
  scope: KnowledgeDecisionScope | "无";
  target: string;
  evidenceStatus: string;
  disposition: string;
}

function filled(value: string): boolean {
  return Boolean(value.trim()) && !value.includes("<") && !value.includes(">");
}

/** Validates plan-only routing; it does not inspect sources or reviewer reasoning. */
export function validateKnowledgeDecisionRows(
  findings: KnowledgeDecisionFinding[],
  decisions: KnowledgeDecision[]
): string[] {
  const issues: string[] = [];
  const findingById = new Map(findings.map((finding) => [finding.id, finding]));
  const candidates = decisions.filter((decision) => /^EXP-CAND-[0-9]+$/.test(decision.findingId));
  const noFindingRows = decisions.filter((decision) => decision.findingId === "无");
  if (findings.length === 0 && candidates.length === 0) {
    return noFindingRows.length === 1 && noFindingRows[0]?.scope === "无" && noFindingRows[0].target === "无" && noFindingRows[0].evidenceStatus === "无" && noFindingRows[0].disposition === "无"
      ? []
      : ["没有发现项或项目经验候选时，沉淀判定必须只保留一行“无”"];
  }
  if (noFindingRows.length > 0) issues.push("存在发现项或项目经验候选时不得同时填写“无”");
  const findingDecisions = decisions.filter((decision) => !/^EXP-CAND-[0-9]+$/.test(decision.findingId) && decision.findingId !== "无");
  const decisionIds = findingDecisions.map((decision) => decision.findingId);
  const missingIds = findings.map((finding) => finding.id).filter((id) => !decisionIds.includes(id));
  const duplicateIds = [...new Set(decisionIds.filter((id, index) => decisionIds.indexOf(id) !== index))];
  const unknownIds = decisionIds.filter((id) => !findingById.has(id));
  if (missingIds.length > 0) issues.push(`缺少发现项沉淀判定：${missingIds.join("、")}`);
  if (duplicateIds.length > 0) issues.push(`发现项重复沉淀判定：${duplicateIds.join("、")}`);
  if (unknownIds.length > 0) issues.push(`沉淀判定引用了不存在的发现项：${[...new Set(unknownIds)].join("、")}`);

  for (const decision of [...findingDecisions, ...candidates]) {
    const finding = findingById.get(decision.findingId);
    if (!finding && !/^EXP-CAND-[0-9]+$/.test(decision.findingId)) continue;
    if (decision.scope === "无" || !filled(decision.target) || !filled(decision.evidenceStatus) || !filled(decision.disposition)) {
      issues.push(`沉淀判定字段不完整：${decision.findingId}`);
      continue;
    }
    if (!finding) {
      if (decision.scope === "项目经验候选") {
        if (!/^CAND-[A-F0-9]{10}$/.test(decision.target) || decision.evidenceStatus !== "待受控探索或正式执行验证" || decision.disposition !== "待验证") {
          issues.push(`项目经验候选必须只引用本地候选编号并等待验证：${decision.findingId}`);
        }
      } else if (decision.scope === "项目经验") {
        if (!decision.target.includes("docs/testing/knowledge/") || !/(受控探索已验证|正式执行已验证)/.test(decision.evidenceStatus) || decision.disposition !== "已提升") {
          issues.push(`已验证项目经验必须直接引用项目经验库：${decision.findingId}`);
        }
      } else {
        issues.push(`项目经验候选或项目经验归属无效：${decision.findingId}`);
      }
      continue;
    }
    if (["需求覆盖缺口", "资料明确的设计缺口"].includes(finding.category) && !["需求事实", "通用规则"].includes(decision.scope)) {
      issues.push(`资料明确缺口不能降级为候选或推断：${decision.findingId}`);
      continue;
    }
    if (finding.category === "业务裁决/资料冲突" && (decision.scope !== "未验证推断" || !decision.disposition.includes("待用户裁决"))) {
      issues.push(`资料冲突必须记录为待用户裁决：${decision.findingId}`);
      continue;
    }
    if (finding.category === "质量建议" && (decision.scope !== "未验证推断" || !decision.disposition.includes("风险登记"))) {
      issues.push(`质量建议必须作为非断言风险登记：${decision.findingId}`);
      continue;
    }
    if (decision.scope === "需求事实" && (!decision.target.includes("REQ") || !decision.target.includes("RULE") || !decision.evidenceStatus.includes("资料已确认") || !decision.disposition.includes("已回链"))) {
      issues.push(`需求事实必须回链 REQ → RULE → caseId：${decision.findingId}`);
    }
    if (decision.scope === "通用规则" && (!decision.target.includes(".md") || !decision.evidenceStatus.includes("资料已确认") || !/(已引用|已更新)/.test(decision.disposition))) {
      issues.push(`通用规则必须指向唯一责任规范：${decision.findingId}`);
    }
    if (decision.scope === "未验证推断" && (!decision.target.includes("plan.md") || !/(待验证|资料冲突|验收缺失)/.test(decision.evidenceStatus) || !/(风险登记|待用户裁决)/.test(decision.disposition))) {
      issues.push(`未验证推断不得成为断言或项目经验：${decision.findingId}`);
    }
  }
  return issues;
}
