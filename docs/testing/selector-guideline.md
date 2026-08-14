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

## 8. 候选 selector 的生成与修复流程

1. 先读取已有 action、Page Object、fixture 和相似测试，优先复用现有稳定 selector。
2. Web/H5 在资格为 `eligible` 时，可先用 Chrome DevTools MCP 的只读 accessibility snapshot 获取真实页面候选 locator；它只能观察非生产、无登录态、无敏感数据的页面，不能点击、填写、执行脚本或读取网络正文。宿主适配、浏览器或页面不可用时记录 `fallback`，继续源码路径，不得令用例 deferred/invalid。
3. 再从与目标环境版本对应的路由、页面组件、直接状态依赖和测试契约补齐候选。只有同时满足以下条件，才能把源码证据标为 `source_verified`：业务容器明确；accessible name 或稳定 test id 可确定；与目标状态有关的条件分支已覆盖；候选 selector 在目标作用域内唯一；不存在未解析的 iframe、Shadow DOM、Portal、国际化、权限或运行时名称分支。源码只证明工程实现，不替代已确认业务预期。
4. MCP 候选和 `source_verified` 都足以生成候选脚本，但都不能写入 `runtime_verified`。`readiness` 使用 `npm run test:web:verify-selectors -- <*.selector-verify.spec.ts>` 自动执行无头零写入验证；验证脚本必须使用受保护的 Web fixture，检查匹配数量为 1、可见性、accessible name/state，并用 `click({ trial: true })` 检查可操作性。缓存键必须同时包含目标构建摘要、路由/页面状态、selector contract 摘要、locale 和 role；通过后才标为 `runtime_verified`。
5. 单纯存在页面状态迁移不能触发可见 Inspector。只有真实页面候选和源码契约仍无法收敛、无头验证出现多匹配或不可达、源码与目标环境运行时不一致，或动态语义无法静态确定时，才使用 `test:web:inspect`。此时由带网络 guard 的 Playwright Inspector 读取目标区域的 DOM、ARIA 无障碍树和必要的脱敏网络摘要；App 与 WebView 原生 context 仍使用 Appium Inspector。
6. 探索证据卡只覆盖真实可达状态，记录输入摘要、页面状态、ARIA 摘要、候选 locator、必要的脱敏网络方法/路径/状态摘要、关联 `caseId`、`reachableBoundary`、被阻止写请求数量和未解决问题；不得保存完整页面、截图、console 原文、query/header/body/cookie/token、输入值或业务资源 ID。不得把未到达的保存、注册、提交、上传或创建资源后的页面写成已验证。
7. 探索不得点击保存、注册、提交、发送验证码、上传或创建资源；网络阻断只是防御措施，不能把危险点击当作探测手段。本地 mock、组件 fixture 或预置只读状态可以用于验证下游。需要 API/fixture 创建远端状态时，只能进入已确认执行清单后的正式 setup。
8. 写入边界导致下游无法在探索阶段到达，但源码和状态契约足以生成实现时，可以登记 `runtime_validation_pending` 正式脚本；工程证据必须写明 `reachableBoundary` 和待正式执行验证范围。正式执行发现 selector 或状态契约不成立时按脚本问题重开现有工程范围，不能归类为产品失败或沿用旧执行清单。
9. Web/H5 缺少唯一语义时，优先收敛到稳定的 `data-testid`；仍无法唯一定位时才使用唯一文本或受限 XPath，并记录补充 ARIA 或 `data-testid` 的改进项。只有页面不可访问、候选均不唯一且无法通过业务容器收敛，或缺少生成脚本所需的状态契约时，才请求人工补充信息或决策。
10. 将 selector、接口契约、证据等级、可达边界或可测试性缺口回链到 `plan.md` 工程层区块中的 `caseId` 映射。

### 8.1 正式执行中的定位漂移识别

v7 `full_replan` 或 `affected_rebuild` 生成的 Web/H5 正式脚本，对可恢复点击定位使用 `guardedRoleLocator()`。包装器先验证已冻结的精确 `role/name`；失败时只在同一业务容器、同一页面状态和同一 role 内执行零写入观察。候选观察只允许读取受限 accessible name、检查唯一可见性，并以 `click({ trial: true })` 验证可操作性；不得自动点击候选元素。

自动修复资格必须同时满足：定位策略、role、业务容器、页面状态和预期动作均未变化；候选唯一、可见且可操作；新旧 accessible name 存在确定性的包含关系；该文案只用于定位，不属于用例预期或业务 Oracle；当前 attempt 尚未完成阶段、外部转换、数据 intent、操作 reservation、资源生产或其他副作用。修复只允许替换受控包装器内唯一的字符串字面量。

出现多候选、role/容器/页面状态变化、业务语义变化、候选不可操作、已有副作用，或需要坐标、索引、动态 class、宽泛 CSS/XPath、正则或模糊匹配时，必须拒绝自动修复。`direct_execute` 的稳定套件脚本不可就地修改；这类请求只能进入后续 `affected_rebuild`。业务步骤、预期、Oracle、规则或权限边界需要变化时，属于用例修订，不属于定位漂移。

## 9. 审核清单

审核新增或修改 selector 时，确认：

- Web/H5 是否优先使用 `role/name/state > label > data-testid > text > XPath`；App 是否优先使用 accessibility ID。
- Web/H5 是否按“只读真实页面候选（可选）→ `source_verified` → `runtime_verified` → 可见 Inspector fallback”选择最小证据强度；`state_transition` 是否未被单独当作 Inspector 触发器。
- 是否唯一匹配目标元素，且不依赖位置、坐标、动态 class 或列表索引。
- 是否与业务动作或断言语义一致。
- 是否复用了已有 action 或已有稳定 selector。
- 无头验证是否只使用 trial actionability，探索证据是否只声明 `reachableBoundary` 以内的状态。
- selector 缓存是否绑定目标构建、路由/状态、contract、locale 和 role；是否按页面状态聚合验证并在任一输入变化后失效。
- 写入边界后的脚本是否标记 `runtime_validation_pending`，且远端状态准备留在执行授权后的正式 setup。
- XPath 是否有明确原因、限制范围和后续替代计划。
- WebView 是否先正确切换 context。
- selector 变更是否运行了最相关的测试，并保留失败证据或验证结果。
- 正式运行时修复是否来自受控包装器、唯一同语义候选和零副作用证明，且没有 fallback 点击或宽泛匹配。
