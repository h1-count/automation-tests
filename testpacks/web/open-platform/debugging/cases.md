# 用例集：开放平台设备调试（debugging）

> 测试类型：Web ｜ 默认环境：test ｜ 默认数据策略：no_write（本包全部 no_write）
>
> 上下文来源：前端源码 `web-open-platform/src/routes/integration.ts`（/integration/debugging 路由 193-199 行：**复用 authcode/AuthCode.vue**）、`src/data/menus/integration.ts`（第 10 行「设备调试」菜单项**已被注释下线**）、`src/components/layouts/BaseLayout.vue`（权限失败渲染「您未被授权访问此页面」空态）、`src/utils/permission.ts` + `src/composables/usePermission.ts`（路由权限链：路径精确匹配失败返回 false）、`src/locales`（menu.integration-debugging=接口调试）；查重比对 authcode 包（同组件页面级覆盖已完成，5/5 通过）。
>
> 上下文结论：①设备调试入口已下线：菜单项被注释，产品接入侧边栏无「设备调试」入口（2026-09-03 实证）；②直达 URL /integration/debugging：路由存在但未配置权限（meta.permission 缺失 → 按路径精确匹配，用户权限列表无此路径）→ BaseLayout 渲染「您未被授权访问此页面」空态（2026-09-03 实证），面包屑显示「接口调试」（i18n 名）；③组件同源：debugging 路由与授权码页共用 AuthCode.vue——授权码页正常渲染而 debugging 被拦截，差异仅在权限配置，页面功能面无独立覆盖对象。
>
> 范围外声明：**设备调试功能面**（功能已下线：菜单注释 + 权限未配置，页面不可达——待确认：该功能是否已废弃或待发布？若恢复，按 authcode 同组件事实与权限链另行补用例）；**页面内容级测试**（与 authcode 包完全同组件，授权码页覆盖见 authcode 包 conclusion，不重复设计）。
>
> 本表供测试范围审核。真实密码、Token、密钥、Cookie 等可复用凭据仅从本地 `.env` 或对应登录态存储读取。

## 快速索引

| 模块 | 用例编号 | 用例标题 | 优先级 | 风险 |
| --- | --- | --- | --- | --- |
| 入口与权限 | OP-DBG-001 | 设备调试入口缺失与直达拦截实证 | P2 | 低 |
| 入口与权限 | OP-DBG-002 | 同组件路由权限差异核对（查重） | P2 | 低 |

## 模块：入口与权限

<details>
<summary>OP-DBG-001｜设备调试入口缺失与直达拦截实证｜P2｜低风险</summary>

> 前置条件：已登录。
>
> 是否写入数据：否。
>
> 脚本状态：待审核。

| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
| — | 1 | 观察产品接入侧边栏菜单 | 无 | 菜单无「设备调试」入口（授权码管理/采购管理/协议管理可见） |
| — | 2 | 直达 /integration/debugging | 无 | 渲染「您未被授权访问此页面」空态；面包屑含「接口调试」（i18n 名注解）；URL 不跳转登录页 |

</details>

<details>
<summary>OP-DBG-002｜同组件路由权限差异核对（查重）｜P2｜低风险</summary>

> 前置条件：已登录。
>
> 是否写入数据：否。
>
> 脚本状态：待审核。

| 数据编号 | 步骤 | 操作 | 测试数据 | 预期结果 |
| --- | --- | --- | --- | --- |
| — | 1 | 访问 /integration/authcode | 无 | 授权码总览页正常渲染（标题可见）——同组件在已授权路由下可用 |
| — | 2 | 访问 /integration/debugging | 无 | 同组件路由被权限拦截（空态可见）——差异仅在权限配置；页面功能覆盖以 authcode 包为准（查重结论注解） |

</details>
