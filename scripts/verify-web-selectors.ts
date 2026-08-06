import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  SelectorEvidenceCache,
  type SelectorEvidenceIdentity,
  type SelectorVerificationEvidence
} from "../src/support/web/selectorEvidenceCache.js";

const input = parseArgs(process.argv.slice(2));
const specPath = resolve(process.cwd(), input.specPath);
if (!existsSync(specPath) || !input.specPath.endsWith(".selector-verify.spec.ts")) {
  throw new Error("Selector verification requires an existing *.selector-verify.spec.ts file.");
}
const selectorContractDigest = input.selectorContractDigest
  ?? sha256(await readFile(specPath));
const identity = input.targetBuildDigest
  ? {
      targetBuildDigest: input.targetBuildDigest,
      routeState: input.routeState,
      selectorContractDigest,
      locale: input.locale,
      role: input.role
    } satisfies SelectorEvidenceIdentity
  : undefined;
const cache = new SelectorEvidenceCache();
if (identity && await cache.read(identity)) {
  process.stdout.write("[selector-verification] 命中与目标构建、页面状态和 selector 契约绑定的有效缓存；跳过浏览器验证。\n");
  process.exit(0);
}
if (!identity) {
  process.stderr.write("[selector-verification] 未提供 TARGET_BUILD_DIGEST，本次验证不会写入可复用缓存。\n");
}

const executable = resolve(process.cwd(), "node_modules/.bin/playwright");
if (!existsSync(executable)) throw new Error("The local Playwright executable is unavailable.");
const output = await run(executable, [
  "test",
  "--config=playwright.selector-verification.config.ts",
  input.specPath
]);
if (output.exitCode !== 0) process.exit(output.exitCode);
const evidence = extractEvidence(output.stdout);
if (identity) await cache.write(identity, evidence);

function parseArgs(args: string[]): {
  specPath: string;
  targetBuildDigest?: string;
  selectorContractDigest?: string;
  routeState: string;
  locale: string;
  role: string;
} {
  const values = new Map<string, string>();
  let specPath = "";
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg.startsWith("--")) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
      values.set(arg, value);
      index += 1;
    } else if (!specPath) {
      specPath = arg;
    } else {
      throw new Error("Selector verification accepts exactly one verification spec.");
    }
  }
  if (!specPath) {
    throw new Error(
      "Usage: npm run test:web:verify-selectors -- <spec> [--target-build-digest <sha256>] [--route-state <route/state>] [--locale <locale>] [--role <role>]"
    );
  }
  return {
    specPath,
    targetBuildDigest: values.get("--target-build-digest")
      ?? process.env.TARGET_BUILD_DIGEST?.trim()
      ?? undefined,
    selectorContractDigest: values.get("--selector-contract-digest"),
    routeState: values.get("--route-state") ?? specPath,
    locale: values.get("--locale") ?? process.env.TEST_LOCALE?.trim() ?? "default",
    role: values.get("--role") ?? process.env.TEST_ROLE?.trim() ?? "anonymous"
  };
}

function extractEvidence(stdout: string): SelectorVerificationEvidence[] {
  const evidence = stdout.split(/\r?\n/)
    .filter((line) => line.includes("[selector-verification] {"))
    .map((line) => {
      const json = line.slice(line.indexOf("{"));
      return JSON.parse(json) as SelectorVerificationEvidence;
    });
  if (
    evidence.length === 0
    || evidence.some((item) =>
      item.result !== "runtime_verified"
      || item.matchCount !== 1
      || !item.caseId?.trim()
      || !item.route?.trim()
      || !item.selectorType?.trim()
      || !item.reachableBoundary?.trim()
    )
  ) {
    throw new Error("Selector verification did not emit complete unique runtime evidence.");
  }
  return evidence;
}

function run(command: string, args: string[]): Promise<{ exitCode: number; stdout: string }> {
  return new Promise((accept, reject) => {
    let stdout = "";
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "inherit"]
    });
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      process.stdout.write(text);
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Selector verification was interrupted by ${signal}.`));
      else accept({ exitCode: code ?? 1, stdout });
    });
  });
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
