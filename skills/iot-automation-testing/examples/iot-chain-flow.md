# IoT 链路示例：设备上报到页面展示

状态：示例，未作为当前环境的已验证执行结果。

## 输入

- 已确认环境、设备物模型、MQTT Topic、Payload 约束和最终业务预期。
- 可用测试设备、API 鉴权方式和页面/App 展示入口。

## 流程示例

1. 在测试计划中确认设备是否可创建、消息是否可安全上报、数据清理方式和等待超时。
2. 用例确认后，声明 API、MQTT 和 Web/App 的组合 `automation.domains`。
3. 使用 IoT 链路模板：准备设备 → MQTT 上报 → API/入库轮询 → 页面或 App 断言。
4. 脚本确认后运行 `npm run test:iot-chain`。
5. 失败时关联 MQTT 摘要、API 摘要、页面/应用证据和等待条件，按失败分类规范分析。

## 仍需由项目补充的信息

- Broker 地址、Topic、Payload、QoS 和权限。
- 测试设备、数据入库路径、告警或状态规则。
- API、页面/App selector、测试账号和清理方式。
