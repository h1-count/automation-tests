# 测试任务续跑

对请求 `<request-id>` 调用 `$iot-automation-testing`，先运行：

`npm run task:gate -- --request <request-id> --json`

若状态可执行或为内部等待，恢复返回的唯一事务；有效租约存在时不重复领取。若为确认或阻塞，暂停本 heartbeat 并展示唯一解除条件；若已完成或取消，删除本 heartbeat。不得从本提示推导业务需求。
