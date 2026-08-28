/**
 * 请求成本分析 CLI：从运行档案与 DSH 会话日志产出时间 + token 双口径成本报告。
 *
 * 用法：
 *   npm run cost:analyze -- --request <type/project/request>
 *     [--sessions-dir <dir>]（默认 ~/.dsh/sessions）
 *     [--pre-slack-min <分钟>]（默认 20，覆盖 initialize 前的主会话预工作）
 *     [--post-slack-min <分钟>]（默认 10，覆盖终态后收尾交付）
 *     [--out <path>]（默认 .local/test-runs/<request>/cost-report.md）
 *
 * 退出码：0 成功；2 参数/档案缺失。
 * 报告只含数字、时间戳与标签；会话 ID 以掩码呈现；不读取/不输出会话内容。
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  aggregateUsage,
  buildCostReport,
  deriveRequestTimeline,
  extractUsageRecord,
  maskSessionId,
  parseJsonl,
  usageWindowMs,
  type UsageRecord
} from "../src/support/task-workflow/requestCostAnalysis.ts";

function required(args: string[], name: string): string {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) {
    console.error(`缺少参数 ${name}`);
    process.exit(2);
  }
  return args[index + 1]!;
}

function optionalNumber(args: string[], name: string, fallback: number): number {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) return fallback;
  const value = Number(args[index + 1]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

const args = process.argv.slice(2);
const request = required(args, "--request");
const sessionsDir = args.includes("--sessions-dir")
  ? required(args, "--sessions-dir")
  : join(homedir(), ".dsh", "sessions");
const preSlackMin = optionalNumber(args, "--pre-slack-min", 20);
const postSlackMin = optionalNumber(args, "--post-slack-min", 10);
const runDir = resolve(".local", "test-runs", ...request.split("/"));
const outPath = args.includes("--out") ? required(args, "--out") : join(runDir, "cost-report.md");

const historyPath = join(runDir, "workflow-history.ndjson");
if (!existsSync(historyPath)) {
  console.error(`未找到运行档案 ${historyPath}`);
  process.exit(2);
}

const timeline = deriveRequestTimeline(parseJsonl(await readFile(historyPath, "utf8")));
const window = usageWindowMs(timeline, preSlackMin * 60_000, postSlackMin * 60_000);
const degradations: string[] = [];

function decompressSession(file: string): string | null {
  if (file.endsWith(".zstd")) {
    const result = spawnSync("zstd", ["-dc", file], { maxBuffer: 1 << 30, encoding: "utf8" });
    if (result.error || result.status !== 0) return null;
    return result.stdout;
  }
  return null;
}

type SessionUsage = { dirName: string; totals: ReturnType<typeof aggregateUsage> };
const sessionUsages: SessionUsage[] = [];

if (existsSync(sessionsDir)) {
  const workspaceRoots = (await readdir(sessionsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(sessionsDir, entry.name));
  for (const workspaceRoot of workspaceRoots) {
    const sessionDirs = (await readdir(workspaceRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(workspaceRoot, entry.name));
    for (const sessionDir of sessionDirs) {
      const zstFile = join(sessionDir, "session.jsonl.zstd");
      const plainFile = join(sessionDir, "session.jsonl");
      let text: string | null = null;
      if (existsSync(zstFile)) {
        text = decompressSession(zstFile);
        if (text === null) degradations.push(`会话 ${maskSessionId(sessionDir.split("/").pop() ?? "")} zstd 解压失败，已跳过。`);
      } else if (existsSync(plainFile)) {
        text = await readFile(plainFile, "utf8");
      }
      if (text === null) continue;
      const records: UsageRecord[] = [];
      for (const line of text.split("\n")) {
        const record = extractUsageRecord(line);
        if (record) records.push(record);
      }
      const totals = aggregateUsage(records, window.startMs, window.endMs);
      if (totals.calls > 0) {
        sessionUsages.push({ dirName: sessionDir.split("/").pop() ?? "", totals });
      }
    }
  }
} else {
  degradations.push(`会话目录不存在：${sessionsDir}（仅时间口径可用）。`);
}

sessionUsages.sort((left, right) => (right.totals.inputTokens + right.totals.cacheReadTokens)
  - (left.totals.inputTokens + left.totals.cacheReadTokens));
const seenLabels = new Map<string, number>();
const sessions = sessionUsages.map((session) => {
  const base = "宿主会话";
  const count = seenLabels.get(base) ?? 0;
  seenLabels.set(base, count + 1);
  return {
    label: count === 0 ? base : `${base} #${count + 1}`,
    sessionIdMasked: maskSessionId(session.dirName),
    totals: session.totals
  };
});

if (timeline.humanWaitSeconds > 60 * 60) {
  degradations.push(
    `人工等待 ${Math.round(timeline.humanWaitSeconds / 60)} 分钟超过 1 小时：时间窗跨长等待段，token 口径可能混入并发会话，应视为上界。`
  );
}

const report = buildCostReport({
  timeline,
  sessions,
  degradations,
  window: { ...window, preSlackMinutes: preSlackMin, postSlackMinutes: postSlackMin }
});

await writeFile(resolve(outPath), report, "utf8");

const totals = sessions.reduce(
  (acc, item) => ({
    calls: acc.calls + item.totals.calls,
    inputTokens: acc.inputTokens + item.totals.inputTokens,
    outputTokens: acc.outputTokens + item.totals.outputTokens,
    cacheReadTokens: acc.cacheReadTokens + item.totals.cacheReadTokens
  }),
  { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }
);
console.log(JSON.stringify({
  request,
  report: outPath,
  wallMinutes: Number((timeline.wallSeconds / 60).toFixed(1)),
  retryIdleMinutes: Number((timeline.retryIdleSeconds / 60).toFixed(1)),
  humanWaitMinutes: Number((timeline.humanWaitSeconds / 60).toFixed(1)),
  reviewerSpans: timeline.reviewerSpans,
  tokenTotals: totals,
  sessions: sessions.map((session) => ({ label: session.label, mask: session.sessionIdMasked, ...session.totals })),
  degradations
}, null, 2));
