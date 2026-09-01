const environmentAliases = {
  test: "test",
  pre: "pre",
  staging: "pre",
  prod: "prod",
  production: "prod"
} as const;

export type TestEnvironment = (typeof environmentAliases)[keyof typeof environmentAliases];

export interface TestEnvironmentConfig {
  name: TestEnvironment;
  openPlatformWebBaseUrl: string;
  openPlatformAuthStatePath?: string;
  openPlatformAdminLoginUrl?: string;
  centralAdminLoginUrl?: string;
}

/** Resolves the selected environment to its configured endpoint. */
export function resolveTestEnvironment(requestedEnvironmentOverride?: string): TestEnvironmentConfig {
  const requestedEnvironment = (requestedEnvironmentOverride ?? process.env.TEST_ENV ?? process.env.DEFAULT_TEST_ENV ?? "test")
    .trim()
    .toLowerCase();
  const name = environmentAliases[requestedEnvironment as keyof typeof environmentAliases];

  if (!name) {
    throw new Error(
      `Unsupported TEST_ENV "${requestedEnvironment}". Use one of: test, pre, prod.`
    );
  }

  if (name === "prod" && process.env.ALLOW_PRODUCTION_TESTS !== "true") {
    throw new Error(
      "Production testing is disabled. Confirm the production test plan, then explicitly set ALLOW_PRODUCTION_TESTS=true."
    );
  }

  const suffix = name.toUpperCase();
  const openPlatformWebBaseUrl = requiredEnvironmentValue(
    `OPEN_PLATFORM_WEB_BASE_URL_${suffix}`
  );
  const openPlatformAuthStatePath = optionalEnvironmentValue(
    `OPEN_PLATFORM_AUTH_STATE_PATH_${suffix}`
  );

  return {
    name,
    openPlatformWebBaseUrl,
    openPlatformAuthStatePath: openPlatformAuthStatePath
      ? resolve(process.cwd(), openPlatformAuthStatePath)
      : undefined,
    openPlatformAdminLoginUrl: optionalEnvironmentValue(
      `OPEN_PLATFORM_ADMIN_LOGIN_URL_${suffix}`
    ),
    centralAdminLoginUrl: optionalEnvironmentValue(`CENTRAL_ADMIN_LOGIN_URL_${suffix}`)
  };
}

function requiredEnvironmentValue(name: string): string {
  const value = optionalEnvironmentValue(name);

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function optionalEnvironmentValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}
import { resolve } from "node:path";
