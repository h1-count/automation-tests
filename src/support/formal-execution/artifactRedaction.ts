import { existsSync } from "node:fs";
import { readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

const textExtensions = new Set([
  ".html",
  ".json",
  ".jsonl",
  ".log",
  ".md",
  ".txt",
  ".xml"
]);

const sensitivePatterns = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b1[3-9]\d{9}\b/g,
  /\b(password|passwd|passcode|otp|token|cookie|authorization)\b\s*[:=]\s*(?!\[REDACTED\])[^\s,;<]+/gi
] as const;

export async function sanitizeFormalArtifact(path: string): Promise<boolean> {
  if (!existsSync(path)) return false;
  const bytes = await readFile(path);
  if (textExtensions.has(extname(path).toLowerCase())) {
    const original = bytes.toString("utf8");
    const sanitized = redact(original);
    if (sanitized !== original) await writeFile(path, sanitized, "utf8");
    return !containsSensitiveText(sanitized);
  }
  const searchable = bytes.toString("latin1");
  if (containsSensitiveText(searchable)) {
    await unlink(path);
    return false;
  }
  return true;
}

export async function sanitizeFormalArtifactTrees(paths: string[]): Promise<string[]> {
  const removed: string[] = [];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    const metadata = await stat(path);
    if (metadata.isFile()) {
      if (!(await sanitizeFormalArtifact(path))) removed.push(path);
      continue;
    }
    if (!metadata.isDirectory()) continue;
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      const candidate = resolve(path, entry.name);
      if (entry.isDirectory()) {
        removed.push(...await sanitizeFormalArtifactTrees([candidate]));
      } else if (entry.isFile() && !(await sanitizeFormalArtifact(candidate))) {
        removed.push(candidate);
      }
    }
  }
  return removed;
}

function redact(value: string): string {
  return value
    .replace(sensitivePatterns[0], "Bearer [REDACTED]")
    .replace(sensitivePatterns[1], "[REDACTED_PHONE]")
    .replace(sensitivePatterns[2], "$1=[REDACTED]");
}

function containsSensitiveText(value: string): boolean {
  return sensitivePatterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}
