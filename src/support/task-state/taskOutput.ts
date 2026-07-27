import { existsSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import type { TaskOutputPreviewKind } from "./types.js";

const forbiddenSegments = new Set([".auth", ".local", ".git", "archive", "node_modules", "sources", "test-assets"]);
const sensitiveFilePattern = /(^|\/)\.env(?:\.|$)|\.(?:pem|key|p12|pfx)$/i;

function normalized(path: string): string {
  return path.split("\\").join("/");
}

export function assertSafeOutputPath(path: string, workspaceRoot: string): string {
  if (!path.trim() || isAbsolute(path)) throw new Error("Task outputs must use non-empty repository-relative paths.");
  const candidate = resolve(workspaceRoot, path);
  const projectRelative = relative(workspaceRoot, candidate);
  const segments = normalized(projectRelative).split("/");
  if (!projectRelative || projectRelative.startsWith(`..${sep}`) || projectRelative === ".." || segments.some((segment) => forbiddenSegments.has(segment)) || sensitiveFilePattern.test(normalized(projectRelative))) {
    throw new Error("Task output paths cannot reference credentials, local state, archives, or files outside the project.");
  }
  if (!existsSync(candidate) || !statSync(candidate).isFile()) throw new Error(`Task output does not exist or is not a file: ${path}`);
  return normalized(projectRelative);
}

export function inferPreviewKind(path: string): TaskOutputPreviewKind {
  const normalizedPath = normalized(path).toLowerCase();
  if (normalizedPath.endsWith(".md")) return "markdown";
  if (/\.(png|jpe?g|gif|webp|svg)$/.test(normalizedPath)) return "image";
  if (/\.(mp4|webm|mov)$/.test(normalizedPath)) return "video";
  if (/\.(html?|htm)$/.test(normalizedPath)) return "html-report";
  if (normalizedPath.includes("/traces/") || /trace.*\.zip$/.test(normalizedPath)) return "trace";
  return "file";
}

export function outputLabel(path: string): string {
  return basename(path).replace(/[\r\n|\[\]]/g, " ").trim() || "产出文件";
}

export function previewAction(kind: TaskOutputPreviewKind): string {
  return ({
    markdown: "打开预览",
    image: "直接预览",
    video: "直接预览",
    "html-report": "打开报告",
    trace: "用 Playwright 打开",
    file: "打开文件"
  } satisfies Record<TaskOutputPreviewKind, string>)[kind];
}

export function previewKindLabel(kind: TaskOutputPreviewKind): string {
  return ({
    markdown: "Markdown",
    image: "图片",
    video: "视频",
    "html-report": "HTML 报告",
    trace: "Trace",
    file: "文件"
  } satisfies Record<TaskOutputPreviewKind, string>)[kind];
}

export function toProjectFileLink(path: string, workspaceRoot: string, label = outputLabel(path)): string {
  const absolute = resolve(workspaceRoot, path);
  return `[${label}](<${absolute}>)`;
}
