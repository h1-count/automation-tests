// 本地静态文件服务：请求级报告（汇总页 + Allure 明细）必须经 http:// 打开。
// Allure 3 报告通过 fetch() 加载数据文件，file:// 协议下被浏览器 CORS 一律拦截
// （实测：双击 index.html 只有外壳、无用例数据，控制台报 "Failed to fetch"）。
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const directory = path.resolve(rootDirectory, option("--dir", ""));
const preferredPort = Number(option("--port", "0"));
// --no-open：运行器自动拉起时使用（每次复测都弹浏览器太吵）；手动 report:allure 默认仍自动打开。
const autoOpen = !args.includes("--no-open");
if (!directory || !fs.existsSync(path.join(directory, "index.html"))) {
  throw new Error(`报告目录无效或缺少 index.html：${directory}`);
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".zip": "application/zip",
  ".webm": "video/webm",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

const server = http.createServer((request, response) => {
  try {
    const requestPath = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/u, "");
    let filePath = path.join(directory, safePath);
    if (!filePath.startsWith(directory)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    let stat = fs.statSync(filePath, { throwIfNoEntry: false });
    if (stat?.isDirectory()) {
      filePath = path.join(filePath, "index.html");
      stat = fs.statSync(filePath, { throwIfNoEntry: false });
    }
    if (!stat?.isFile()) {
      // Allure 明细是单页应用：非文件路径回退到其 index.html（历史路由深链可直达）。
      const fallback = path.join(directory, "allure-report", "index.html");
      if (fs.existsSync(fallback)) {
        response.writeHead(200, { "Content-Type": contentTypes[".html"] });
        fs.createReadStream(fallback).pipe(response);
        return;
      }
      response.writeHead(404).end("Not Found");
      return;
    }
    response.writeHead(200, { "Content-Type": contentTypes[path.extname(filePath).toLowerCase()] ?? "application/octet-stream" });
    fs.createReadStream(filePath).pipe(response);
  } catch (error) {
    response.writeHead(500).end(`Internal Error: ${error instanceof Error ? error.message : String(error)}`);
  }
});

// 端口被占用等监听失败时干净退出（非 0），运行器据此自动右移端口重试。
server.on("error", (error) => {
  process.stderr.write(`报告服务启动失败：${error.message}\n`);
  process.exit(1);
});

server.listen(preferredPort, "127.0.0.1", () => {
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/index.html`;
  process.stdout.write(`报告服务已启动：${url}（Ctrl+C 停止）\n`);
  if (!autoOpen) return;
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  import("node:child_process").then(({ spawn }) => {
    const child = spawn(opener, [url], { stdio: "ignore", shell: process.platform === "win32" });
    child.on("error", () => process.stdout.write(`请手动打开：${url}\n`));
  });
});
