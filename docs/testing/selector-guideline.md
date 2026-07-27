# UI 元素定位规范

<!-- owns: automation.selectors -->

## 1. 目的与适用范围

本文规范 Web、H5、原生 App 和 App 内 WebView 自动化测试中的元素定位方式。目标是使用可读、稳定、可维护的 selector，减少因页面布局、文案、样式或设备差异造成的脚本失效。

项目强制规则以 [AGENTS.md](../../AGENTS.md) 为准。定位策略是脚本实现细节，不应替代测试用例中的业务步骤和预期结果。

## 2. 基本原则

- selector 应表达元素的业务语义或可访问性语义，而不是页面当前结构或视觉位置。
- 一个 selector 应唯一匹配目标元素；匹配多个元素时，先修正定位方式，不以索引兜底。
- Web/H5 优先使用原生 HTML 语义或正确 ARIA 提供的 role、name、state 与 label；关键业务控件可额外提供稳定的 `data-testid`。
- 原生 App 优先要求客户端提供稳定的 accessibility ID；不得在脚本中编写脆弱的 DOM 路径或坐标替代方案。
- 禁止坐标点击、依赖固定像素、依赖元素顺序或依赖临时样式类名。
- 页面文案可以作为短期候选定位，但不能作为频繁变化、国际化或非唯一场景的长期主定位。
- selector 失效时，先确认是否为产品 UI 变更、可访问性标识缺失或脚本问题；不要直接扩大 XPath 范围。

## 3. 定位优先级

Web/H5 的探索和脚本定位优先级如下：

```text
role/name/state
  > label
  > data-testid
  > text
  > XPath
```

| 优先级 | 适用场景 | 示例 | 说明 |
| --- | --- | --- | --- |
| 1 | 语义明确且名称唯一的控件 | `page.getByRole("button", { name: "创建产品" })` | Web/H5 首选；与用户实际感知的角色、名称和状态一致，适合语义探索与脚本生成。 |
| 2 | 有稳定关联的表单字段 | `page.getByLabel("产品名称")` | 要求 `label` 与输入控件正确关联。 |
| 3 | 关键业务控件的稳定测试标识 | `page.getByTestId("create-product-submit")` | 当文案会变、多语言、同名控件或复杂组件导致 ARIA 语义不唯一时使用。 |
| 4 | 文案稳定且唯一的元素 | `page.getByText("创建成功", { exact: true })` | 适合提示、标题或短期候选定位；注意多语言和文案变更。 |
| 5 | 无其他可靠方式时 | `page.locator("//...")` | 必须说明原因、限制匹配范围，并推动补充语义或稳定测试标识。 |

原生 App 的定位优先级独立为：`accessibilityId > resourceId > iOS predicate / class chain`。Web/H5 不把 App accessibility ID 作为 selector 策略的一部分。

CSS selector 仅可用于稳定的业务属性或受控 `id`，例如 `[data-testid="..."]`。不得基于动态 class、DOM 层级、`nth-child` 或列表索引构建 CSS selector。

## 4. Web 与 H5 定位规范

### 4.1 推荐写法

```ts
await page.getByTestId("create-product-submit").click();

await page.getByRole("button", { name: "创建产品" }).click();

await page.getByLabel("产品名称").fill(productName);

await expect(page.getByText("创建成功", { exact: true })).toBeVisible();
```

### 4.2 `data-testid` 命名

`data-testid` 是关键业务控件的稳定测试契约，不替代 ARIA。它使用小写 kebab-case，推荐格式：

```text
<模块>-<页面或组件>-<业务动作或字段>
```

示例：

```text
product-create-name-input
product-create-category-select
product-create-submit
product-create-success-message
```

命名描述业务能力，不描述样式或技术组件，例如不要使用 `blue-button`、`ant-form-item-3`、`left-panel-button`。

### 4.3 不推荐写法

```ts
// 禁止：依赖 DOM 层级和位置
await page.locator("div:nth-child(3) > button").click();

// 禁止：依赖动态样式类名
await page.locator(".ant-btn-primary.css-1abc23").click();

// 禁止：用索引在多个元素中猜测目标
await page.getByRole("button").nth(2).click();

// 禁止：坐标点击
await page.mouse.click(120, 320);
```

## 5. 原生 App 定位规范

原生 App 首选 accessibility ID。客户端应为可操作或需要断言的关键元素提供稳定的 accessibility ID。

```ts
const createButton = await $("~create-product-submit");
await createButton.click();

const productNameInput = await $("~product-create-name-input");
await productNameInput.setValue(productName);
```

建议使用与 Web `data-testid` 对应的业务命名，便于跨端理解和复用，例如 `product-create-submit`。

若只能使用 Android resource ID 或 iOS predicate，应在脚本中记录平台限制，并在测试计划或缺失信息中说明后续稳定化方案。不得使用坐标点击作为替代方案。

## 6. App 内 WebView 定位规范

WebView 测试分为两个阶段：

1. 使用 Appium 的原生 context 定位并完成进入 WebView 前的原生操作。
2. 切换到 WebView context 后，按 Web/H5 规范使用 `data-testid`、role、label、text 等定位方式。

切换前必须确认可用 context；切换失败时记录设备、App 版本、可用 context 列表和错误信息。不得在未确认 context 的情况下尝试坐标点击或猜测 WebView 元素。

## 7. XPath 使用约束

XPath 只在没有稳定测试标识、accessibility ID、语义 role、label 或唯一文本时使用，并满足以下条件：

- 定位范围从明确的父容器开始，避免全页面模糊匹配。
- 不依赖绝对层级、元素索引或动态 class。
- 在脚本或注释中说明使用原因和替代方案。
- 将“补充 `data-testid` 或 accessibility ID”记录为改进项。

示例：

```ts
// 临时使用：当前页面未提供稳定测试标识，待产品端补充 product-create-submit。
const submitButton = page.locator(
  "//form[@data-testid='product-create-form']//button[normalize-space()='创建产品']"
);
```

## 8. Codex 生成与修复 selector 的流程

1. 先读取已有 action、Page Object、fixture 和相似测试，优先复用现有稳定 selector。
2. Web/H5 正式脚本生成前，按[流程规范的可见探索门禁](./automation-guideline.md#33-受控探索与缺失信息补全)同时显示专用 Chrome 与 Playwright Inspector；在 Inspector 中实际读取目标区域的 DOM、ARIA 无障碍树和脱敏网络摘要，并从 role/name/state、label 和可见语义生成候选 selector。App 使用 Appium Inspector 信息。
3. 对每个候选 selector 验证唯一匹配、可操作性和业务语义。脱敏探索证据卡固定记录探索时间、页面路径与状态、目标区域的 ARIA `role/name/state/label` 摘要、候选 locator、匹配数量、稳定性限制、网络方法/路径/状态摘要、关联 `caseId`、未解决问题和零写入结论；敏感信息与采集边界按[环境规范](./environment-guideline.md#61-运行模式)处理。无法显示 Inspector 与受管 Chrome、未读取目标区域 ARIA，或未证明候选唯一时，不得把探索标为完成或生成正式 selector。
4. Web/H5 缺少唯一语义时，优先收敛到稳定的 `data-testid`；仍无法唯一定位时才使用唯一文本或受限 XPath，并记录补充 ARIA 或 `data-testid` 的改进项。不得仅因此长期跳过用例。
5. 只有页面不可访问、候选定位均不唯一且无法通过业务容器收敛，或探索会触发未经确认的外部操作时，才请求人工补充信息或决策。
6. 将 selector、接口契约或可测试性缺口回链到 `plan.md` 工程层区块中的 `caseId` 映射；候选 selector 必须保留其可访问性语义、唯一性结果和稳定性限制。生成或修复脚本后，先输出 diff、影响用例和风险，待用户审核后再执行。

## 9. 审核清单

审核新增或修改 selector 时，确认：

- Web/H5 是否优先使用 `role/name/state > label > data-testid > text > XPath`；App 是否优先使用 accessibility ID。
- Web/H5 正式 selector 是否具有可见 Inspector 探索证据，并能回链到目标区域的脱敏 ARIA 摘要和唯一性结果。
- 是否唯一匹配目标元素，且不依赖位置、坐标、动态 class 或列表索引。
- 是否与业务动作或断言语义一致。
- 是否复用了已有 action 或已有稳定 selector。
- XPath 是否有明确原因、限制范围和后续替代计划。
- WebView 是否先正确切换 context。
- selector 变更是否运行了最相关的测试，并保留失败证据或验证结果。
