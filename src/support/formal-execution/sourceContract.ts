import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { parse } from "yaml";
import type {
  FormalBusinessOracleAuthority,
  FormalExecutionManifest
} from "./types.js";
import {
  markdownSection,
  markdownTableRows,
  parseCaseIds,
  parseRuleCaseRecords,
  parseRuleDesignDetails,
  validateRelationProjection
} from "../testcase/relationProjection.js";

export const FORMAL_SOURCE_CONTRACT_SCHEMA_VERSION = "source-contract-evidence-v3" as const;

interface SourceFileDigest {
  path: string;
  sha256: string;
}

interface RegisteredSourceContractAuthority {
  kind: "registered_source";
  materialId: string;
  sectionId: string;
  sourceSha256: string;
  sourceFiles: SourceFileDigest[];
}

interface FormalUserDecisionContractAuthority {
  kind: "formal_user_decision";
  decisionType: string;
  subjectDigest: string;
}

type SourceContractAuthority =
  | RegisteredSourceContractAuthority
  | FormalUserDecisionContractAuthority;

interface SourceContractEntry {
  caseId: string;
  oracleId: string;
  ruleRef: string;
  observationKind: string;
  authorities: SourceContractAuthority[];
}

interface SourceContractEvidenceV3 {
  schemaVersion: typeof FORMAL_SOURCE_CONTRACT_SCHEMA_VERSION;
  requestId: string;
  projectId: string;
  targetBuildDigest: string;
  contracts: SourceContractEntry[];
}

export interface ResolvedFormalSourceContract {
  targetBuildDigest: string;
  evidenceDigest: string;
  contractKeys: string[];
}

interface UnknownRecord {
  [key: string]: unknown;
}

interface RegisteredSourceFact {
  materialId: string;
  materialPath: string;
  sectionId: string;
  sourceSha256: string;
  indexId: string;
  indexPath: string;
  sourceFiles: SourceFileDigest[];
}

interface BusinessTraceabilityFact {
  caseId: string;
  oracleId: string;
  ruleRef: string;
  requirementIds: string[];
  observableExpectationDigest: string;
  authorityDigest: string;
  packageName: string;
}

/**
 * Validates a v3 source contract against the immutable business-oracle declarations,
 * the reviewed source registry/index, and the actual source bytes.
 */
export async function resolveFormalSourceContract(input: {
  content: Buffer;
  sourcePath: string;
  manifest: FormalExecutionManifest;
  workspaceRoot: string;
}): Promise<ResolvedFormalSourceContract> {
  if (!["formal-execution-manifest-v3", "formal-execution-manifest-v4"].includes(input.manifest.schemaVersion)) {
    throw new Error(
      `${input.sourcePath} uses ${FORMAL_SOURCE_CONTRACT_SCHEMA_VERSION}, which requires formal-execution-manifest-v3.`
    );
  }
  const raw = parseJsonObject(input.content, `Source contract ${input.sourcePath}`);
  assertExactKeys(raw, [
    "contracts",
    "projectId",
    "requestId",
    "schemaVersion",
    "targetBuildDigest"
  ], `Source contract ${input.sourcePath}`);
  if (raw.schemaVersion !== FORMAL_SOURCE_CONTRACT_SCHEMA_VERSION) {
    throw new Error(`Source contract ${input.sourcePath} has an unsupported schema.`);
  }
  if (raw.requestId !== input.manifest.requestId) {
    throw new Error(`Source contract requestId differs from ${input.manifest.requestId}: ${input.sourcePath}.`);
  }
  if (raw.projectId !== input.manifest.projectId) {
    throw new Error(`Source contract projectId differs from ${input.manifest.projectId}: ${input.sourcePath}.`);
  }
  const targetBuildDigest = requireDigest(raw.targetBuildDigest, "source contract targetBuildDigest");
  const contracts = parseContracts(raw.contracts, input.sourcePath);
  assertExactContractSet(input.manifest, contracts, input.sourcePath);

  const traceabilityFacts = await validateBusinessTraceability({
    manifest: input.manifest,
    contracts,
    workspaceRoot: input.workspaceRoot
  });

  const registry = await loadSourceRegistry(input.workspaceRoot);
  const registeredFacts: RegisteredSourceFact[] = [];
  for (const contract of contracts) {
    for (const authority of contract.authorities) {
      if (authority.kind !== "registered_source") continue;
      const sourceFiles = await validateSourceFiles(
        authority.sourceFiles,
        input.workspaceRoot,
        `${contract.caseId}/${contract.oracleId}`
      );
      registeredFacts.push(await validateRegisteredSource({
        authority,
        projectId: input.manifest.projectId,
        workspaceRoot: input.workspaceRoot,
        registry,
        sourceFiles
      }));
    }
  }

  const normalizedFacts = registeredFacts.sort((left, right) =>
    `${left.materialId}:${left.sectionId}`.localeCompare(`${right.materialId}:${right.sectionId}`)
  );
  const evidenceDigest = sha256(Buffer.concat([
    input.content,
    Buffer.from("\0", "utf8"),
    Buffer.from(canonicalJson({
      registeredSources: normalizedFacts,
      traceability: traceabilityFacts
    }), "utf8")
  ]));
  return {
    targetBuildDigest,
    evidenceDigest,
    contractKeys: contracts.map(contractKey).sort()
  };
}

/** Validates optional sourceFiles on legacy selector/source/browser evidence. */
export async function validateLegacyEvidenceSourceFiles(input: {
  evidence: Record<string, unknown>;
  workspaceRoot: string;
  sourcePath: string;
}): Promise<void> {
  if (input.evidence.sourceFiles === undefined) return;
  if (!Array.isArray(input.evidence.sourceFiles)) {
    throw new Error(`Build evidence sourceFiles must be an array: ${input.sourcePath}.`);
  }
  const files = input.evidence.sourceFiles.map((value, index) => {
    const item = requireRecord(value, `sourceFiles[${index}] in ${input.sourcePath}`);
    const path = requireNonEmptyString(item.path, `sourceFiles[${index}].path`);
    const digest = requireDigest(item.sha256 ?? item.digest, `sourceFiles[${index}] digest`);
    return { path, sha256: digest };
  });
  await validateSourceFiles(files, input.workspaceRoot, input.sourcePath);
}

async function validateBusinessTraceability(input: {
  manifest: FormalExecutionManifest;
  contracts: SourceContractEntry[];
  workspaceRoot: string;
}): Promise<BusinessTraceabilityFact[]> {
  const requestDirectoryRelative = `testcases/${input.manifest.requestId}`;
  const requestDirectory = await containedExistingPath(
    input.workspaceRoot,
    requestDirectoryRelative,
    "formal testcase request directory"
  );
  const planPath = await containedExistingPath(requestDirectory, "plan.md", "formal testcase plan");
  const plan = await readFile(planPath, "utf8");
  const packageNames = (await readdir(requestDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^cases-.+\.md$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (packageNames.length === 0) {
    throw new Error(`Formal source authority requires testcase packages under ${requestDirectoryRelative}.`);
  }
  const packages = Object.fromEntries(await Promise.all(packageNames.map(async (name) => [
    name,
    await readFile(resolve(requestDirectory, name), "utf8")
  ])));
  const relationIssues = validateRelationProjection(plan, packages);
  if (relationIssues.length > 0) {
    throw new Error(
      `Formal source authority found invalid plan/package relations: ${relationIssues[0]!.detail}`
    );
  }

  const rules = parseRuleCaseRecords(plan);
  const designs = parseRuleDesignDetails(plan);
  const requirementIds = new Set(
    markdownTableRows(markdownSection(plan, "## 需求追溯矩阵"))
      .flatMap((row) => extractIds(row[0] ?? "", /\bREQ-[A-Z0-9]+(?:-[A-Z0-9]+)+\b/g))
  );
  const casePackages = packageCaseBlocks(packages);
  const facts: BusinessTraceabilityFact[] = [];
  for (const contract of input.contracts) {
    const matchingRules = rules.filter((rule) => rule.id === contract.ruleRef);
    if (matchingRules.length !== 1) {
      throw new Error(`${contract.caseId}/${contract.oracleId} ruleRef ${contract.ruleRef} is missing or duplicated in plan.md.`);
    }
    const rule = matchingRules[0]!;
    if (!rule.caseIds.includes(contract.caseId)) {
      throw new Error(`${contract.ruleRef} does not map to ${contract.caseId} in plan.md.`);
    }
    if (!["适用", "受控执行"].includes(rule.applicability)) {
      throw new Error(`${contract.ruleRef} is not applicable for formal execution in plan.md.`);
    }
    if (rule.reqIds.length === 0 || rule.reqIds.some((reqId) => !requirementIds.has(reqId))) {
      throw new Error(`${contract.ruleRef} has no complete REQ mapping in plan.md.`);
    }
    const matchingDesigns = designs.filter((design) => design.id === contract.ruleRef);
    if (matchingDesigns.length !== 1) {
      throw new Error(`${contract.ruleRef} has no unique rule design in plan.md.`);
    }
    const design = matchingDesigns[0]!;
    if (!sameValues(rule.caseIds, design.caseIds)) {
      throw new Error(`${contract.ruleRef} rule and design case sets differ in plan.md.`);
    }
    if (!isConcreteExpectation(design.observableExpectation)) {
      throw new Error(`${contract.ruleRef} has no concrete observableExpectation in plan.md.`);
    }
    const packageMatches = casePackages.filter((entry) => entry.caseId === contract.caseId);
    if (packageMatches.length !== 1) {
      throw new Error(`${contract.caseId} is missing or duplicated across current testcase packages.`);
    }
    const packageMatch = packageMatches[0]!;
    const declaredRuleRefs = extractMetadataRefs(packageMatch.block, "规则覆盖编号", "RULE");
    if (!declaredRuleRefs.includes(contract.ruleRef)) {
      throw new Error(`${contract.caseId} testcase package does not declare ${contract.ruleRef}.`);
    }
    const sourceSection = markdownSection(packageMatch.block, "## 来源");
    const sourceRows = markdownTableRows(sourceSection);
    for (const authority of contract.authorities) {
      if (authority.kind === "registered_source") {
        const matchingSourceRow = sourceRows.some((row) => {
          const serialized = row.join(" | ");
          return serialized.includes(authority.materialId)
            && serialized.includes(authority.sectionId)
            && serialized.includes(authority.sourceSha256);
        });
        if (!matchingSourceRow) {
          throw new Error(
            `${contract.caseId} testcase source table does not match ${authority.materialId}/${authority.sectionId}/${authority.sourceSha256}.`
          );
        }
      } else {
        assertAcceptedFormalDecision(plan, authority.decisionType, authority.subjectDigest);
      }
    }
    facts.push({
      caseId: contract.caseId,
      oracleId: contract.oracleId,
      ruleRef: contract.ruleRef,
      requirementIds: [...rule.reqIds].sort(),
      observableExpectationDigest: sha256(Buffer.from(design.observableExpectation.trim(), "utf8")),
      authorityDigest: sha256(Buffer.from(canonicalJson(
        contract.authorities.map(stripSourceFiles).sort((left, right) =>
          canonicalJson(left).localeCompare(canonicalJson(right))
        )
      ), "utf8")),
      packageName: packageMatch.name
    });
  }
  return facts.sort((left, right) =>
    `${left.caseId}:${left.oracleId}`.localeCompare(`${right.caseId}:${right.oracleId}`)
  );
}

function packageCaseBlocks(packages: Record<string, string>): Array<{
  name: string;
  caseId: string;
  block: string;
}> {
  return Object.entries(packages).flatMap(([name, content]) =>
    content.split(/^## 测试用例：/m).slice(1).flatMap((body) => {
      const block = `## 测试用例：${body}`;
      const caseId = parseCaseIds(
        block.match(/^\|\s*用例编号\s*\|\s*(.*?)\s*\|\s*$/m)?.[1] ?? ""
      )[0];
      return caseId ? [{ name, caseId, block }] : [];
    })
  );
}

function extractMetadataRefs(block: string, label: string, prefix: "RULE" | "REQ"): string[] {
  const value = block.match(new RegExp(`^\\|\\s*${label}\\s*\\|\\s*(.*?)\\s*\\|\\s*$`, "m"))?.[1] ?? "";
  return extractIds(value, new RegExp(`\\b${prefix}-[A-Z0-9]+(?:-[A-Z0-9]+)+\\b`, "g"));
}

function extractIds(value: string, pattern: RegExp): string[] {
  return [...new Set(value.match(pattern) ?? [])].sort();
}

function isConcreteExpectation(value: string): boolean {
  const normalized = value.replace(/`/g, "").trim();
  return normalized.length > 0
    && !["无", "待填写", "待补充", "未知", "已定义校验", "符合预期", "功能正常"].includes(normalized);
}

function assertAcceptedFormalDecision(plan: string, decisionType: string, subjectDigest: string): void {
  const rows = markdownTableRows(markdownSection(plan, "## 正式用户决定"));
  const requiredHeader = [
    "决定类型",
    "subjectDigest",
    "正式决定",
    "决定内容与适用范围",
    "后续处理"
  ];
  const header = rows.find((row) => row.some((cell) => cell === "subjectDigest"));
  if (!header || JSON.stringify(header) !== JSON.stringify(requiredHeader)) {
    throw new Error("plan.md formal user decision table must use the exact controlled columns.");
  }
  const typeIndex = header.indexOf("决定类型");
  const digestIndex = header.indexOf("subjectDigest");
  const resolutionIndex = header.indexOf("正式决定");
  const clean = (value: string): string => value.trim().replace(/^`|`$/g, "");
  const matchingRows = rows.filter((row) =>
    clean(row[typeIndex] ?? "") === decisionType
    && clean(row[digestIndex] ?? "") === subjectDigest
  );
  if (
    matchingRows.length !== 1
    || !["accepted", "已接受"].includes(clean(matchingRows[0]?.[resolutionIndex] ?? ""))
  ) {
    throw new Error(
      `plan.md requires exactly one accepted ${decisionType} decision for subjectDigest ${subjectDigest}.`
    );
  }
}

async function loadSourceRegistry(workspaceRoot: string): Promise<{
  sourcesRoot: string;
  manifest: UnknownRecord;
}> {
  const sourcesRoot = resolve(workspaceRoot, "sources");
  const manifestPath = resolve(sourcesRoot, "manifest.yaml");
  const manifest = parseYamlObject(await readFile(manifestPath, "utf8"), "sources/manifest.yaml");
  if (manifest.version !== 3) {
    throw new Error("Formal source authority requires sources/manifest.yaml version 3.");
  }
  return { sourcesRoot, manifest };
}

async function validateRegisteredSource(input: {
  authority: RegisteredSourceContractAuthority;
  projectId: string;
  workspaceRoot: string;
  registry: { sourcesRoot: string; manifest: UnknownRecord };
  sourceFiles: SourceFileDigest[];
}): Promise<RegisteredSourceFact> {
  const materials = recordArray(input.registry.manifest.materials);
  const matchingMaterials = materials.filter((item) => item.id === input.authority.materialId);
  if (matchingMaterials.length !== 1) {
    throw new Error(`Registered source ${input.authority.materialId} is missing or duplicated in sources/manifest.yaml.`);
  }
  const material = matchingMaterials[0]!;
  const applicableProjects = stringArray(material.applicable_projects);
  if (material.status !== "active" || !applicableProjects.includes(input.projectId)) {
    throw new Error(
      `Registered source ${input.authority.materialId} is inactive or not applicable to ${input.projectId}.`
    );
  }
  const materialPath = requireNonEmptyString(
    material.path,
    `material path for ${input.authority.materialId}`
  );
  const indexRegistrations = recordArray(input.registry.manifest.knowledge_indexes).filter((item) =>
    item.project === input.projectId
    && item.status === "reviewed"
    && stringArray(item.covered_material_ids).includes(input.authority.materialId)
  );
  if (indexRegistrations.length !== 1) {
    throw new Error(
      `Registered source ${input.authority.materialId} requires exactly one reviewed ${input.projectId} knowledge index.`
    );
  }
  const indexRegistration = indexRegistrations[0]!;
  const indexId = requireNonEmptyString(indexRegistration.id, "knowledge index id");
  const indexPath = requireNonEmptyString(indexRegistration.path, `knowledge index path for ${indexId}`);
  const absoluteIndexPath = await containedExistingPath(input.registry.sourcesRoot, indexPath, "knowledge index");
  const index = parseYamlObject(await readFile(absoluteIndexPath, "utf8"), indexPath);
  if (index.project !== input.projectId || index.index_status !== "reviewed") {
    throw new Error(`Knowledge index ${indexPath} is not reviewed for ${input.projectId}.`);
  }
  const documents = recordArray(index.documents).filter((item) =>
    item.material_id === input.authority.materialId
  );
  if (documents.length !== 1) {
    throw new Error(
      `Knowledge index ${indexPath} is missing or duplicates ${input.authority.materialId}.`
    );
  }
  const document = documents[0]!;
  if (document.source_path !== materialPath) {
    throw new Error(
      `Registered source ${input.authority.materialId} path differs between manifest and reviewed index.`
    );
  }
  const indexedDigest = requireDigest(
    document.source_sha256,
    `reviewed source digest for ${input.authority.materialId}`
  );
  if (indexedDigest !== input.authority.sourceSha256) {
    throw new Error(
      `Registered source ${input.authority.materialId} digest differs from its oracle authority.`
    );
  }
  const sections = recordArray(document.sections).filter((item) =>
    item.section_id === input.authority.sectionId
  );
  if (sections.length !== 1) {
    throw new Error(
      `Registered source ${input.authority.materialId} has no unique reviewed section ${input.authority.sectionId}.`
    );
  }
  const absoluteSourcePath = await containedExistingPath(
    input.registry.sourcesRoot,
    materialPath,
    `registered source ${input.authority.materialId}`
  );
  const actualDigest = await digestSourcePath(absoluteSourcePath);
  if (actualDigest !== indexedDigest) {
    throw new Error(
      `Registered source ${input.authority.materialId} bytes differ from the reviewed source SHA-256.`
    );
  }
  return {
    materialId: input.authority.materialId,
    materialPath,
    sectionId: input.authority.sectionId,
    sourceSha256: actualDigest,
    indexId,
    indexPath,
    sourceFiles: input.sourceFiles
  };
}

function parseContracts(value: unknown, sourcePath: string): SourceContractEntry[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Source contract ${sourcePath} requires non-empty contracts.`);
  }
  const contracts = value.map((entry, index) => {
    const raw = requireRecord(entry, `contracts[${index}] in ${sourcePath}`);
    assertExactKeys(raw, [
      "authorities",
      "caseId",
      "observationKind",
      "oracleId",
      "ruleRef"
    ], `contracts[${index}] in ${sourcePath}`);
    const authorities = parseAuthorities(raw.authorities, `contracts[${index}] in ${sourcePath}`);
    return {
      caseId: requireNonEmptyString(raw.caseId, `contracts[${index}].caseId`),
      oracleId: requireNonEmptyString(raw.oracleId, `contracts[${index}].oracleId`),
      ruleRef: requireNonEmptyString(raw.ruleRef, `contracts[${index}].ruleRef`),
      observationKind: requireNonEmptyString(
        raw.observationKind,
        `contracts[${index}].observationKind`
      ),
      authorities
    };
  });
  assertUnique(contracts.map(contractKey), "source contract caseId/oracleId");
  return contracts;
}

function parseAuthorities(value: unknown, label: string): SourceContractAuthority[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} requires non-empty authorities.`);
  }
  const authorities = value.map((entry, index) => {
    const raw = requireRecord(entry, `${label}.authorities[${index}]`);
    if (raw.kind === "registered_source") {
      assertExactKeys(raw, [
        "kind",
        "materialId",
        "sectionId",
        "sourceFiles",
        "sourceSha256"
      ], `${label}.authorities[${index}]`);
      if (!Array.isArray(raw.sourceFiles) || raw.sourceFiles.length === 0) {
        throw new Error(`${label}.authorities[${index}] requires non-empty sourceFiles.`);
      }
      const sourceFiles = raw.sourceFiles.map((file, fileIndex) => {
        const sourceFile = requireRecord(
          file,
          `${label}.authorities[${index}].sourceFiles[${fileIndex}]`
        );
        assertExactKeys(
          sourceFile,
          ["path", "sha256"],
          `${label}.authorities[${index}].sourceFiles[${fileIndex}]`
        );
        return {
          path: requireNonEmptyString(sourceFile.path, "source file path"),
          sha256: requireDigest(sourceFile.sha256, "source file sha256")
        };
      });
      return {
        kind: "registered_source" as const,
        materialId: requireNonEmptyString(raw.materialId, "registered source materialId"),
        sectionId: requireNonEmptyString(raw.sectionId, "registered source sectionId"),
        sourceSha256: requireDigest(raw.sourceSha256, "registered source sourceSha256"),
        sourceFiles
      };
    }
    if (raw.kind === "formal_user_decision") {
      assertExactKeys(
        raw,
        ["decisionType", "kind", "subjectDigest"],
        `${label}.authorities[${index}]`
      );
      return {
        kind: "formal_user_decision" as const,
        decisionType: requireNonEmptyString(raw.decisionType, "formal decision type"),
        subjectDigest: requireDigest(raw.subjectDigest, "formal decision subjectDigest")
      };
    }
    throw new Error(`${label}.authorities[${index}] has an unsupported authority kind.`);
  });
  assertUnique(authorities.map((authority) => canonicalJson(stripSourceFiles(authority))), `${label} authority`);
  return authorities;
}

function assertExactContractSet(
  manifest: FormalExecutionManifest,
  actual: SourceContractEntry[],
  sourcePath: string
): void {
  const expected = manifest.cases.flatMap((definition) =>
    (definition.businessOracles ?? []).map((oracle) => ({
      caseId: definition.caseId,
      oracle
    }))
  );
  const expectedKeys = expected.map(({ caseId, oracle }) => `${caseId}\0${oracle.oracleId}`);
  assertUnique(expectedKeys, "manifest business oracle caseId/oracleId");
  const actualByKey = new Map(actual.map((contract) => [
    `${contract.caseId}\0${contract.oracleId}`,
    contract
  ]));
  if (!sameValues(expectedKeys, [...actualByKey.keys()])) {
    throw new Error(`Source contract ${sourcePath} does not exactly cover manifest business oracles.`);
  }
  for (const { caseId, oracle } of expected) {
    const contract = actualByKey.get(`${caseId}\0${oracle.oracleId}`)!;
    if (contract.ruleRef !== oracle.ruleRef || contract.observationKind !== oracle.observationKind) {
      throw new Error(
        `Source contract ${caseId}/${oracle.oracleId} rule or observation kind differs from the manifest.`
      );
    }
    const expectedAuthorities = oracle.authorities.map((authority) => canonicalJson(authority));
    const actualAuthorities = contract.authorities.map((authority) =>
      canonicalJson(stripSourceFiles(authority))
    );
    if (!sameValues(expectedAuthorities, actualAuthorities)) {
      throw new Error(
        `Source contract ${caseId}/${oracle.oracleId} authorities differ from the manifest.`
      );
    }
  }
}

function stripSourceFiles(authority: SourceContractAuthority): FormalBusinessOracleAuthority {
  if (authority.kind === "formal_user_decision") return authority;
  return {
    kind: authority.kind,
    materialId: authority.materialId,
    sectionId: authority.sectionId,
    sourceSha256: authority.sourceSha256
  };
}

async function validateSourceFiles(
  files: SourceFileDigest[],
  workspaceRoot: string,
  label: string
): Promise<SourceFileDigest[]> {
  assertUnique(files.map((file) => file.path), `${label} source file path`);
  const validated: SourceFileDigest[] = [];
  for (const file of files) {
    const absolute = await containedExistingPath(workspaceRoot, file.path, `${label} source file`);
    const metadata = await stat(absolute);
    if (!metadata.isFile()) {
      throw new Error(`${label} source file must resolve to a regular file: ${file.path}.`);
    }
    const actual = sha256(await readFile(absolute));
    if (actual !== file.sha256) {
      throw new Error(`${label} source file digest differs from actual bytes: ${file.path}.`);
    }
    validated.push({ path: file.path, sha256: actual });
  }
  return validated.sort((left, right) => left.path.localeCompare(right.path));
}

async function digestSourcePath(path: string): Promise<string> {
  const metadata = await stat(path);
  if (metadata.isFile()) return sha256(await readFile(path));
  if (!metadata.isDirectory()) throw new Error(`Registered source is neither a file nor a directory: ${path}.`);
  const files = await listDirectoryFiles(path);
  const hash = createHash("sha256");
  if (files.length === 0) hash.update("empty-directory\0");
  for (const file of files) {
    hash.update(relative(path, file));
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function listDirectoryFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Registered source directory contains an unsupported symbolic link: ${path}.`);
    }
    if (entry.isDirectory()) files.push(...await listDirectoryFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

async function containedExistingPath(root: string, path: string, label: string): Promise<string> {
  const canonicalRoot = await realpath(resolve(root));
  const candidate = resolve(canonicalRoot, path);
  const lexical = relative(canonicalRoot, candidate);
  if (isAbsolute(path) || isOutside(lexical)) {
    throw new Error(`${label} is outside its allowed root: ${path}.`);
  }
  let canonicalCandidate: string;
  try {
    canonicalCandidate = await realpath(candidate);
  } catch {
    throw new Error(`${label} does not exist: ${path}.`);
  }
  const resolvedRelative = relative(canonicalRoot, canonicalCandidate);
  if (isOutside(resolvedRelative)) {
    throw new Error(`${label} resolves outside its allowed root: ${path}.`);
  }
  return canonicalCandidate;
}

function isOutside(path: string): boolean {
  return path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path);
}

function parseJsonObject(content: Buffer, label: string): UnknownRecord {
  try {
    return requireRecord(JSON.parse(content.toString("utf8")), label);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`${label} must`)) throw error;
    throw new Error(`${label} is not valid JSON.`);
  }
}

function parseYamlObject(content: string, label: string): UnknownRecord {
  try {
    return requireRecord(parse(content), label);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`${label} must`)) throw error;
    throw new Error(`${label} is not valid YAML.`);
  }
}

function requireRecord(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as UnknownRecord;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function requireDigest(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function recordArray(value: unknown): UnknownRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is UnknownRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function assertExactKeys(value: UnknownRecord, keys: string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} has unsupported or missing fields.`);
  }
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} values must be unique.`);
}

function sameValues(left: string[], right: string[]): boolean {
  return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
}

function contractKey(contract: SourceContractEntry): string {
  return `${contract.caseId}/${contract.oracleId}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
