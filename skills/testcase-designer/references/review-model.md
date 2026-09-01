# 评审模型契约（testcase-review-export-v1）

`scripts/build-testcase-review-workbook.mjs` 只接受本契约的 JSON。三步用法：

```bash
# 1. 构建模型（按下方模板写脚本，产物放功能包 runtime/review-model/，不入 Git）
node testpacks/<type>/<project>/<feature>/runtime/review-model/build-<feature>-review-model.mjs

# 2. 先校验结构、行数与摘要一致性
node scripts/build-testcase-review-workbook.mjs --model testpacks/<type>/<project>/<feature>/runtime/review-model/<feature>-review-model.json --validate-only

# 3. 导出工作簿（功能包 review/ 不入 Git）
node scripts/build-testcase-review-workbook.mjs \
  --model testpacks/<type>/<project>/<feature>/runtime/review-model/<feature>-review-model.json \
  --output "testpacks/<type>/<project>/<feature>/review/<review-id>/<功能>用例审核.xlsx" \
  --preview-dir testpacks/<type>/<project>/<feature>/review/<review-id>/previews \
  --receipt testpacks/<type>/<project>/<feature>/runtime/review-model/<feature>-review-receipt.json
```

导出成功后同时得到回执 JSON 与逐表确定性预览（功能包 `review/<review-id>/previews/*.md`）。历史范例见功能包 `runtime/review-model/create-product-review-model.json`（本地保留，不入 Git）。

## 顶层结构

```jsonc
{
  "schema": "testcase-review-export-v1",
  "modelDigest": "…",            // sha256(canonicalJson(model))，构建脚本收尾统一计算
  "callbackSubjectDigest": "…",  // 与 model 内同名字段相等
  "semanticDigest": "…",
  "contentDigest": "…",
  "bindingDigest": "…",
  "model": { /* 见下 */ }
}
```

校验规则（`validateExport`）：

- 五个摘要都必须是 64 位小写十六进制 SHA-256；
- `modelDigest` 必须等于 `sha256(canonicalJson(model))`；其余四个摘要必须与 model 内同名字段相等；
- `indexRows` 非空；`modules` 非空；模块展开的 cases 总数 === `indexRows.length`；每个 case 的 `executionRows` 非空。

## model 字段

```jsonc
{
  "schema": "testcase-review-model-v1",
  "requestId": "web/open-platform/<feature>-fast-<yyyymmdd>",  // digest 用、写入"说明"表
  "title": "开放平台<功能名>",
  "formatVersion": "testcase-v1-layered",                       // 固定值
  "callbackSubjectDigest": "…",
  "selectedCaseIds": ["OP-XXX-001", "…"],
  "semanticDigest": "…",
  "contentDigest": "…",
  "bindingDigest": "…",
  "defaults": { "testType": "Web", "environment": "test", "dataStrategy": "no_write" },
  "statistics": {
    "caseCount": 5,             // 必须 === indexRows.length === 展开用例数
    "p0Count": 5,               // priority === "P0" 的数量（公式 COUNTIF 口径会复核）
    "highRiskCount": 1,         // risk === "高" 的数量
    "parameterizedCount": 1     // 含 D01 式数据编号的用例数
  },
  "indexRows": [
    { "module": "登录", "caseId": "OP-AUTH-001", "title": "…", "priority": "P0", "risk": "中" }
  ],
  "modules": [
    {
      "name": "登录",
      "cases": [
        {
          "caseId": "OP-AUTH-001",
          "title": "…",
          "priority": "P0",
          "risk": "中",
          "ruleIds": [],                  // 快速通道固定为空数组
          "preconditions": "前置条件整段文本",
          "environment": "test",
          "dataStrategy": "no_write",
          "sourceRefs": [],               // 快速通道固定为空数组
          "differences": [
            "是否写入数据=否",
            "脚本状态=待审核"
          ],
          "executionRows": [
            {
              "stepIndex": 1,             // 用例内从 1 连续递增
              "action": "打开登录页",      // 工作簿渲染为 "1. 打开登录页"
              "data": "无",               // 合成值 / D01 / .env 变量名；禁止真实凭据
              "expected": "登录面板可见",
              "dataId": "—"               // 可省略，默认 "—"；参数化行填 "D01"
            }
          ]
        }
      ]
    }
  ]
}
```

“RULE / 差异”列渲染规则：`ruleIds` 为空且 `differences` 非空时显示 `差异：是否写入数据=…；脚本状态=…`。快速通道不维护 RULE，**统一**：`ruleIds: []`，`differences` 固定两条 `"是否写入数据=<口径>"`、`"脚本状态=<状态>"`，口径与 cases.md 折叠正文逐字一致。

## 摘要（digest）计算约定

与既有构建脚本保持一致的确定性口径（模型内容变 ⇒ 摘要必变）：

| 摘要 | 口径 |
| --- | --- |
| `callbackSubjectDigest` | `sha256(cases.md 文件全文)` —— 审核对象就是这份用例表 |
| `semanticDigest` | `sha256(canonicalJson({ selectedCaseIds, modules }))` |
| `contentDigest` | `sha256(canonicalJson({ title, modules }))` |
| `bindingDigest` | `sha256(requestId)` |
| `modelDigest` | `sha256(canonicalJson(model))`，收尾统一计算并镜像到顶层 |

`canonicalJson`：与 `scripts/build-testcase-review-workbook.mjs` 中的实现一致 —— 对象键名排序后拼接，数组保序，字符串/数字/布尔直接 `JSON.stringify`。**不要手改 JSON**：任何手改都会使 `modelDigest` 失配；一律改构建脚本后重跑。

## 构建脚本模板

复制到 `testpacks/<type>/<project>/<feature>/runtime/review-model/build-<feature>-review-model.mjs`，替换用例数据即可：

```js
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const packRoot = path.resolve(import.meta.dirname, "..", "..");
const outputPath = path.join(import.meta.dirname, "<feature>-review-model.json");
const caseFile = path.join(packRoot, "cases.md");

const sha256 = (v) => createHash("sha256").update(v).digest("hex");
const canonicalJson = (v) => v === null || ["boolean", "string", "number"].includes(typeof v)
  ? JSON.stringify(v)
  : Array.isArray(v)
    ? `[${v.map(canonicalJson).join(",")}]`
    : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(",")}}`;

const testCase = (caseId, title, priority, risk, preconditions, differences, executionRows) => ({
  caseId, title, priority, risk,
  ruleIds: [], preconditions, environment: "test", dataStrategy: "no_write",
  sourceRefs: [], differences, executionRows,
});

const cases = [
  testCase("OP-XXX-001", "验证…", "P0", "中", "前置条件…",
    ["是否写入数据=否", "脚本状态=待审核"], [
      { stepIndex: 1, action: "打开…", data: "无", expected: "…可见" },
      // 参数化行追加 dataId: "D01"
    ]),
  // …与 cases.md 逐条对应，一条不落
];

const modules = [{ name: "<模块>", cases }];
for (const m of modules) for (const c of m.cases) c.module = m.name;
const allCases = modules.flatMap((m) => m.cases);
const selectedCaseIds = allCases.map((c) => c.caseId);
const requestId = "web/<project>/<feature>-fast-<yyyymmdd>";
const title = "<功能标题>";
const model = {
  schema: "testcase-review-model-v1", requestId, title,
  formatVersion: "testcase-v1-layered",
  callbackSubjectDigest: sha256(await fs.readFile(caseFile, "utf8")),
  selectedCaseIds,
  semanticDigest: sha256(canonicalJson({ selectedCaseIds, modules })),
  contentDigest: sha256(canonicalJson({ title, modules })),
  bindingDigest: sha256(requestId),
  defaults: { testType: "Web", environment: "test", dataStrategy: "no_write" },
  statistics: {
    caseCount: allCases.length,
    p0Count: allCases.filter((c) => c.priority === "P0").length,
    highRiskCount: allCases.filter((c) => c.risk === "高").length,
    parameterizedCount: allCases.filter((c) => c.executionRows.some((r) => (r.dataId ?? "—") !== "—")).length,
  },
  indexRows: allCases.map(({ module, caseId, title: t, priority, risk }) => ({ module, caseId, title: t, priority, risk })),
  modules,
};
const exported = {
  schema: "testcase-review-export-v1",
  modelDigest: sha256(canonicalJson(model)),
  callbackSubjectDigest: model.callbackSubjectDigest,
  semanticDigest: model.semanticDigest,
  contentDigest: model.contentDigest,
  bindingDigest: model.bindingDigest,
  model,
};
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(exported, null, 2)}\n`, "utf8");
console.log(`model written: ${outputPath}`);
```

注意：模板给 `modules[].cases[].module` 赋了额外字段（供 `indexRows` 提取），该字段会进入 canonicalJson 参与 `modelDigest`，属预期行为，保持与范例一致即可。

## 常见校验失败

| 报错 | 原因 |
| --- | --- |
| `modelDigest does not match` | 手改过 JSON / canonicalJson 实现与脚本不一致 → 改构建脚本重跑 |
| `Review model must contain at least one testcase` | `indexRows` 为空 |
| `module cases do not match index rows` | indexRows 与 modules 展开数量不一致（漏加/重复用例） |
| `Every review model testcase must contain execution rows` | 某用例 `executionRows` 为空数组 |
| `P0/高风险统计与模型不一致` | `statistics` 与实际 priority/risk 数量对不上（工作簿公式审计口径） |
