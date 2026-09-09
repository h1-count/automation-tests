import path from "node:path";
import { fileURLToPath } from "node:url";
import { findDurableReport } from "./support/request-report-location.mjs";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportId = process.argv[2];
if (!reportId) throw new Error("用法：npm run report:request -- <请求报告标识>");
const reportPath = await findDurableReport(rootDirectory, reportId);
if (!reportPath) throw new Error(`未找到 Markdown 报告 ${reportId}。请先运行 npm run test:fast -- --report-id ${reportId}。`);
process.stdout.write(`${path.relative(rootDirectory, reportPath)}\n`);
