# 用例集：开放平台文档中心（docs-center）

> 测试类型：Web ｜ 默认环境：test ｜ 默认数据策略：no_write（本包全部 no_write，纯只读文档页）
>
> 上下文来源：`sources/open-platform/需求/产品接入系统功能需求说明/产品接入系统功能需求说明.md`（「文档中心/服务支持」章节）、前端源码 `web-open-platform/src/routes/service-support.ts`（home/technical-ticket/faq 三路由，均 auth:false）、`components/Service-support/index.vue` + `ServiceSupportViewer.vue`（629 行：fetch `/service-support/content.json` 目录 + `/service-support/content/{path}.md` 正文，markdown-it 渲染）、`pages/service/FAQ.vue` + `components/FAQ/FAQViewer.vue`（同款 fetch 模式）、`public/service-support/`（**空目录——content.json 及 md 正文均未部署**）、`experience/general.md`、`experience/open-platform.md`。
>
> 上下文结论：①文档中心（/service-support/home）2026-09-04 实证**加载失败**：`fetch('/service-support/content.json')` 返回 vite SPA fallback（text/html）→ JSON 解析 SyntaxError → 「加载服务支持目录失败」toast + 正文区「加载失败，请刷新页面重试」——根因 `public/service-support/` 为空目录（静态内容资源未部署/未提交）；②常见问题页（/service-support/faq）同款 Viewer 模式，实证同样「加载失败」；③技术工单（同路由组）在 work-order 包覆盖；④两页面均 auth:false 无需登录态即可访问。
>
> 范围外声明：**文档内容正确性核对**（内容资源缺失，无从核对——待部署后补内容级用例）；**目录导航/正文锚点跳转交互**（依赖 content.json 加载成功，当前不可达）。
>
> 本表供测试范围审核。真实密码、Token、密钥、Cookie 等可复用凭据仅从本地 `.env` 或对应登录态存储读取。

## 快速索引

| 模块 | 用例编号 | 用例标题 | 优先级 | 风险 |
| --- | --- | --- | --- | --- |
| 文档中心 | OP-DOC-001 | 文档中心页加载失败实证（content.json 缺失） | P0 | 中 |
| 文档中心 | OP-DOC-002 | 常见问题页同款失败实证（查重） | P2 | 低 |

## 模块：文档中心

<details>
<summary>OP-DOC-001｜文档中心页加载失败实证（content.json 缺失）｜P0｜中风险</summary>

> 前置条件：无（auth:false，无需登录）。
>
> 是否写入数据：否。
>
> 脚本状态：待审核。

| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
| — | 1 | 直达 /service-support/home | 无 | 页面可达，路由不跳转登录 |
| — | 2 | 观察目录与正文区 | 无 | 实证注解：目录空 + 正文区「加载失败，请刷新页面重试」（content.json 返回 HTML→解析失败；public/service-support 目录为空——疑似缺陷/静态资源待部署，与研发确认） |
| — | 3 | 核对失败提示 | 无 | 页面含「加载失败」字样（以当前实际行为为准，注解记录）；无 JS 崩溃白屏 |

</details>

<details>
<summary>OP-DOC-002｜常见问题页同款失败实证（查重）｜P2｜低风险</summary>

> 前置条件：无（auth:false）。
>
> 是否写入数据：否。
>
> 脚本状态：待审核。

| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
| — | 1 | 直达 /service-support/faq | 无 | 页面可达；实证注解：同款「加载失败」表现（FAQViewer 同 fetch 模式同根因） |
| — | 2 | 查重结论注解 | 无 | 注解：faq 与 home 同因 content.json/内容 md 缺失而失败，修复应同源生效 |

</details>
