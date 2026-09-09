# 用例集：开放平台新模块与新路由（new-modules）

> 测试类型：Web ｜ 默认环境：test ｜ 默认数据策略：no_write（演示页查询为 mock 数据；动态路由不可达，无写入入口）
>
> 上下文来源：前端源码 `web-open-platform/src/routes/ui-components.ts`（UI组件示例<开发>，hidden: PROD——仅开发环境显示，4 子路由：tag-select-demo/mock-demo/search-page-demo/apifox-renderer-demo）、`routes/dynamics.ts`（动态路由组：/app/sdk-development、/ai-agent/my-agent、/user-center/developer-info、/user-center/company-info——**directRoutes 已注册但 2026-09-04 实证全部渲染 404「抱歉，当前页面无法访问」**）、`pages/ui-components/TagSelectDemo.vue`、`MockDemo.vue`、`SearchPageDemo.vue`、`experience/general.md`、`experience/open-platform.md`。
>
> 上下文结论：①UI组件示例 3 页在 dev 环境可达（2026-09-04 实证）：tag-select-demo（单选/多选/创建新标签演示，多选上限 3）、mock-demo（用户列表/产品详情两张 mock 卡片，当前「暂无数据」）、search-page-demo（mock 列表含 1 行演示数据 asdfasfda + 搜索筛选区）；apifox-renderer-demo 子路由存在（页面文件 ApifoxRendererDemo.vue 在列）；②动态路由 4 页（app/ai-agent/user-center 组）实证**全部 404**（「抱歉，当前页面无法访问 | 网址错误或不存在」）——路由定义在 dynamics.ts 但未生效（未上线/未挂载/菜单未开放），属「新模块待发布」证据面；③全部演示页数据为前端 mock，无后端写入。
>
> 范围外声明：**apifox-renderer-demo**（依赖 Apifox 文档渲染外部资源，稳定性受外部服务影响，本轮注解可达性、不做内容断言）；**动态路由新模块功能面**（页面未上线，功能未知——待发布后按正式功能另立用例）；**mock-demo 数据加载**（mock 服务数据非稳定断言对象，仅结构渲染）。
>
> 本表供测试范围审核。真实密码、Token、密钥、Cookie 等可复用凭据仅从本地 `.env` 或对应登录态存储读取。

## 快速索引

| 模块 | 用例编号 | 用例标题 | 优先级 | 风险 |
| --- | --- | --- | --- | --- |
| UI组件示例 | OP-NEWM-001 | UI 组件示例三页渲染与基础交互 | P1 | 低 |
| 新模块路由 | OP-NEWM-002 | 未上线动态路由 404 实证 | P2 | 低 |

## 模块：UI组件示例

<details>
<summary>OP-NEWM-001｜UI 组件示例三页渲染与基础交互｜P1｜低风险</summary>

> 前置条件：已登录（dev 环境菜单显示）。
>
> 是否写入数据：否（mock 数据仅前端内存）。
>
> 脚本状态：待审核。

| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
| — | 1 | 打开 tag-select-demo | 无 | 单选模式标签可点选/取消（「前端开发」点选→当前选中更新；再点取消恢复）；多选模式可选多个（上限 3 注解） |
| — | 2 | 打开 mock-demo | 无 | 「用户列表/获取用户数据」「产品详情/获取产品数据」两卡片渲染（当前数据态注解） |
| — | 3 | 打开 search-page-demo | 无 | 搜索筛选区（是否在线/产品/设备类型/地区/激活时间）+ mock 列表渲染（实证注解数据行） |

</details>

## 模块：新模块路由

<details>
<summary>OP-NEWM-002｜未上线动态路由 404 实证｜P2｜低风险</summary>

> 前置条件：已登录。
>
> 是否写入数据：否。
>
> 脚本状态：待审核。

| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
| — | 1 | 依次直达 /ai-agent/my-agent、/app/sdk-development、/user-center/developer-info、/user-center/company-info | 无 | 全部渲染 404 空态「抱歉，当前页面无法访问」（实证注解：dynamics.ts 已注册路由但未生效——新模块未上线证据，待发布后另立用例） |
| — | 2 | 核对侧边栏菜单 | 无 | 注解：侧边栏无 AI智能体/APP/用户中心入口（与 404 一致） |

</details>
