# 登录测试交接文档（2026-08-10）

> 本文件非工作流产物，仅供接手者快速了解现状与接手点；不参与 `check:markdown`/workflow 校验。

## 用户诉求

测试开放平台登录功能。

## 项目流程（Durable Workflow，AGENTS.md 强制）

`plan.md → 计划确认 → 用例生成 → 关系同步 → 完整性校验 → 隔离评审(combined+impact) → 用例确认 → build → readiness → 执行授权 → run → report`

门禁严格：产物指纹(digest)防篡改、租约(lease)防并发、决定表 append-only、不得手工改 `workflow-history.ndjson`。命令入口只有 `task:initialize`/`task:resume`/`task:status`/`task:gate`/`task:manage`。

## 三个请求的当前状态

| 请求 | workflow 状态 | 说明 |
| --- | --- | --- |
| login-20260810 | CANCELLED (seq 31) | digest 漂移：上个会话直接编辑已发布用例文件未走发布流程，旧版本丢失，无法原地修复 |
| login-20260810-2 | CANCELLED (seq 16) | case-generation 误用未来 retryAt 的 retry → RETRY_WAIT 卡 3.5h，无法原地恢复 |
| login-20260810-3 | 未初始化（无 history） | 已备料 plan.md + staging cases，但编号仍是 `-2`，需改 `-3` 后才能 init |

## 已确定的产品决策（已与用户对齐，可沿用）

- 范围：仅账号登录（三入口落点 / 登录控件结构 / 手机号密码登录主路径 / 登录态身份 / 登录边界），不含注册、忘记密码等。
- 环境：test。
- 登录主路径：复用本机已配置的测试管理员账号（`OPEN_PLATFORM_PRODUCT_ADMIN_USERNAME_TEST` / `_PASSWORD_TEST`，只存本地 `.env`，不进任何产物）。
- 安全挑战（滑块/二次验证）：只由用户在同一可见浏览器内最小人工接管，Agent 不读取/记录/伪造/绕过。
- **证据策略（用户明确要求并确认）**：功能性界面（登录页、三入口、登录控件、登录后控制台、路由状态）采集截图/视频作为报告证据；仅在密码/OTP/手机号/Cookie/Token/会话原文的输入与传输瞬间禁录（强制安全边界，不可放宽）。截图/视频不含敏感原文（密码框掩码、手机号脱敏）。

## 产物位置

- 计划草案（已含证据策略修订）：`testcases/web/open-platform/login-20260810-3/plan.md`
- 用例草案（7 个原子用例，已校验完整，等价于 login-20260810 的用例）：`.local/test-task-runtime/web/open-platform/login-20260810-3/staging/cases-account-login.md`
- 两份文件编号仍是 `-2`，接手后需改 `-3`（见下）。

## 接手前需做的编号处理（lease 外完成）

对 `login-20260810-3/plan.md`：

- `OPEN-PLATFORM-LOGIN-20260810-2` → `OPEN-PLATFORM-LOGIN-20260810-3`（计划编号）
- `web/open-platform/login-20260810-2` → `web/open-platform/login-20260810-3`（测试请求）
- `OPEN-LOGIN-20260810-2-` → `OPEN-LOGIN-20260810-3-`（caseId，全文 replace）
- 正式用户决定表：移除 `-2` 的 `accepted` 行，只保留一条 `revision_requested`（新 run 重新确认）

对 staging `cases-account-login.md`：

- `web/open-platform/login-20260810-2` → `login-20260810-3`（所属测试请求）
- `OPEN-LOGIN-20260810-2-` → `OPEN-LOGIN-20260810-3-`（caseId，全文 replace）

改完跑 `npm run check:markdown -- <两份文件>` 与 `npm run check:architecture`。

## 接手步骤（从 login-20260810-3 继续）

1. 编号处理 + markdown/架构校验（见上）。
2. `npm run task:initialize -- --request web/open-platform/login-20260810-3 --plan testcases/web/open-platform/login-20260810-3/plan.md`
3. source-selection：`activity-start` → `activity-succeed --verified "sources selected: ..."`（三个 manifest 章节：aiot-platform-project-document/platform-home-and-registration、iot-platform-help/account-registration-faq、open-platform-axure-prototype/prototype-account-login）。
4. plan-validation：`activity-start` → `artifact-publish-succeed --source plan.md --target plan.md --publish PUB-LOGIN-20260810-3-PLAN --verified "check:markdown/architecture passed"`。
5. plan-confirmation：`callback-request --activity plan-confirmation` → 用户 `accepted` → 把含 `accepted` 行的 plan 复制到 runtime staging 作为 candidate，磁盘 plan 只保留 `revision_requested` 作为 current，再 `callback-resolve --callback <id> --resolution accepted --plan-source <staging plan>`（见教训 4）。
6. **case-generation（关键）**：staging cases 已就绪 → `activity-start --lease-ms 600000` → **立即** `artifact-publish-succeed --source <staging cases> --target testcases/.../cases-account-login.md --publish PUB-LOGIN-20260810-3-CASES`，lease 内不做任何编辑。
7. relation-sync、completeness-validation：自动校验，通过则进入评审。
8. 隔离评审 combined+impact（真实只读子 Agent，strict 评级）→ 收敛 → 用例确认。
9. build（工程设计、selector 契约、候选脚本）→ readiness（执行清单）→ 执行授权 → run（登录主路径需 headed + 用户人工接管安全挑战）→ report。

## 关键教训（避免再踩坑）

1. **lease 只有 2 分钟**：`activity-start` 后，lease 内只做“发布/成功”一个动作；所有文件编辑必须在 `activity-start` 之前（lease 外）完成。需要较长处理时间就显式传 `--lease-ms`（如 600000）。
2. **不要对还要继续的 activity 用“未来 retryAt”的 retry**：retry 的 `retryAt` 决定何时恢复；RETRY_WAIT 在 `retryAt<=now` 时才由 gate 自动转 READY。只有要 cancel（需要 checkpoint 安全）时才用远未来 retryAt 把 activity 推到 RETRY_WAIT；**要继续的 activity 在 lease 过期后应 reconcile confirmed（直接发布已就绪产物），而不是 retry**。
3. **已发布产物文件绝不能直接编辑**：修改 cases/plan 必须走 staging → 发布流程（由 case-generation/relation-sync/case-review-evolution 重新发布）；直接改磁盘会导致 digest 漂移死锁（SUCCEEDED 节点不可重开）。
4. **callback-resolve 的 append-only**：staging plan 的决定表必须 = 磁盘 current 的决定行 + 恰好追加一行；`--plan-source` 指向**暂存副本**（不是磁盘 current，否则二者相同无法“追加一行”）。
5. **RETRY_WAIT（retryAt 未来）不可原地恢复**：不能 reconcile/start/activity-fail（无 lease），只能等 retryAt 到期或 cancel 重跑。
6. **请求用户动作/结束回合/输出结论前**，必须 `npm run task:gate -- --request <id> --assert-safe-reply`。

## 参考命令

```bash
# 状态/门禁
npm run task:status  -- --request web/open-platform/login-20260810-3
npm run task:gate    -- --request web/open-platform/login-20260810-3 --json
npm run task:gate    -- --request web/open-platform/login-20260810-3 --assert-safe-reply

# 启动/恢复
npm run task:initialize -- --request web/open-platform/login-20260810-3 --plan testcases/web/open-platform/login-20260810-3/plan.md
npm run task:resume     -- --request web/open-platform/login-20260810-3

# Activity 推进（示例）
npm run task:manage -- activity-start          --request <id> --activity <id> --owner claude-code --lease-ms 600000
npm run task:manage -- activity-succeed        --request <id> --activity <id> --claim <token> --verified "..."
npm run task:manage -- artifact-publish-succeed --request <id> --activity <id> --source <staging> --target <final> --publish <PUB-ID> --claim <token> --verified "..."
npm run task:manage -- reconcile               --request <id> --activity <id> --outcome confirmed --evidence "..."
npm run task:manage -- callback-request        --request <id> --activity plan-confirmation
npm run task:manage -- callback-resolve        --request <id> --callback <id> --resolution accepted --plan-source <staging plan>
```
