import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 用例-脚本完整性检查（2026-09-02）：对每个功能包做 cases.md 用例 ID ↔ spec 覆盖锚点的双向比对。
// 背景：对应关系此前靠人工约定（「覆盖用例 OP-XXX-NNN」注释 / 标题内嵌 ID），OP-AUTH-001 曾丢失锚点
// 而无人察觉。本脚本让"每条用例都有脚本锚点、每个锚点都有用例"成为跑前机器检查项。
//
// 提取口径：
// - 用例 ID 全集：cases.md 中的 OP-<MODULE>-<NNN>（索引表与详情块共用同一编号体系，去重即全集）。
// - 脚本锚点（三类正式锚点，缺一不可属于其中之一）：
//   ① 测试标题内嵌 ID：test("OP-XXX-NNN …")；
//   ② 「覆盖用例」注释行上的 ID（允许一条测试覆盖多条用例的写法）；
//   ③ 「OP-XXX-NNN 步骤」形式的步骤级引用（合并链路内被覆盖用例的锚定方式，如 019）。
//   普通提及（如"与 OP-AUTH-007 同控件跨表单"这类交叉引用）不算锚点——否则删除正式锚点后
//   交叉引用会掩盖缺口（2026-09-02 反向验证实证）。
//
// 用法：
//   node scripts/audit-case-coverage.mjs                 # 检查 testpacks 下全部功能包
//   node scripts/audit-case-coverage.mjs <功能包目录>...  # 只检查指定包
// 退出码：全部通过 0；任一缺口 1（供 run-fast-tests.mjs 跑前门禁与 CI 复用）。

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const caseIdPattern = /OP-[A-Z]+-\d{3}/g;

function extractCaseIds(text) {
  return new Set(text.match(caseIdPattern) ?? []);
}

function extractSpecAnchors(text) {
  const anchored = new Set();
  // 局部复测只能通过 Playwright --grep 选择测试标题；注释与步骤引用不再算执行锚点。
  for (const match of text.matchAll(/test(?:\.fixme)?\("([^"]*)"/g)) {
    for (const id of match[1].match(caseIdPattern) ?? []) anchored.add(id);
  }
  return anchored;
}

async function auditPack(packDirectory) {
  const packName = path.relative(rootDirectory, packDirectory);
  const casesPath = path.join(packDirectory, "cases.md");
  const problems = [];
  let caseIds = new Set();
  try {
    caseIds = extractCaseIds(await fs.readFile(casesPath, "utf8"));
  } catch {
    return { packName, problems: [`缺少 cases.md（${casesPath}），无法建立用例全集`], caseCount: 0 };
  }
  if (caseIds.size === 0) {
    return { packName, problems: ["cases.md 中未提取到任何 OP-*-NNN 用例 ID"], caseCount: 0 };
  }

  const packEntries = await fs.readdir(packDirectory, { withFileTypes: true });
  const specFiles = packEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".spec.ts"))
    .map((entry) => entry.name);
  if (specFiles.length === 0) {
    return { packName, problems: ["功能包内没有任何 *.spec.ts 测试脚本"], caseCount: caseIds.size };
  }

  const anchoredIds = new Set();
  for (const specFile of specFiles) {
    const specText = await fs.readFile(path.join(packDirectory, specFile), "utf8");
    for (const id of extractSpecAnchors(specText)) anchoredIds.add(id);
  }

  // 缺口一：用例表有、脚本未锚定（漏实现或锚点注释丢失）。
  for (const id of [...caseIds].sort()) {
    if (!anchoredIds.has(id)) problems.push(`用例 ${id} 未出现在可选择的 test() 标题`);
  }
  // 缺口二：脚本锚定了、用例表没有（脚本越界实现或用例被删未同步）。
  for (const id of [...anchoredIds].sort()) {
    if (!caseIds.has(id)) problems.push(`脚本锚点 ${id} 在 cases.md 中不存在（脚本越界或用例表未同步）`);
  }

  return { packName, problems, caseCount: caseIds.size, anchoredCount: anchoredIds.size, specFiles };
}

async function collectPackDirectories(overrides) {
  if (overrides.length > 0) return overrides.map((entry) => path.resolve(rootDirectory, entry));
  const directories = [];
  async function walk(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const child = path.join(current, entry.name);
      if (await fs.access(path.join(child, "cases.md")).then(() => true).catch(() => false)) {
        directories.push(child);
      } else {
        await walk(child);
      }
    }
  }
  await walk(path.join(rootDirectory, "testpacks"));
  return directories;
}

const overrides = process.argv.slice(2);
const packDirectories = await collectPackDirectories(overrides);
if (packDirectories.length === 0) {
  console.error("未找到任何功能包（含 cases.md 的目录）。");
  process.exit(1);
}

let failed = false;
for (const packDirectory of packDirectories) {
  const result = await auditPack(packDirectory);
  const label = `${result.packName}（用例 ${result.caseCount} 条${result.anchoredCount !== undefined ? ` / 锚点 ${result.anchoredCount} 个` : ""}）`;
  if (result.problems.length === 0) {
    console.log(`[用例覆盖] ${label} ✓ 全部锚定`);
  } else {
    failed = true;
    console.error(`[用例覆盖] ${label} ✗ 存在 ${result.problems.length} 处缺口：`);
    for (const problem of result.problems) console.error(`  - ${problem}`);
  }
}

if (failed) {
  console.error("用例-脚本完整性检查未通过：请补齐脚本锚点或同步用例表后再跑测试。");
  process.exit(1);
}
