// 每次运行由 run-fast-tests 注入公共功能目录下的本地历史文件。
// 完整报告仍只写入 artifacts/current/，历史仅保留 Allure 的紧凑 JSONL 数据。
export default {
  historyPath: process.env.ALLURE_HISTORY_PATH
};
