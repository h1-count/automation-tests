import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalJson } from "../task-workflow/canonicalJson.js";
import type { SafeJsonValue } from "../task-workflow/types.js";
import type {
  FormalCapabilityDefinition,
  FormalCapabilityResult
} from "./types.js";

export interface CapabilityCheckContext {
  requestId: string;
  environment: string;
  targetBuildDigest?: string;
  processEnvironment?: NodeJS.ProcessEnv;
  workspaceRoot?: string;
}

export interface CapabilityProviderResult {
  available: boolean;
  reason?: string;
  unblockCondition?: string;
  evidence: Record<string, SafeJsonValue>;
  expiresAt?: string;
}

export interface CapabilityProvider {
  id: string;
  check(
    definition: FormalCapabilityDefinition,
    context: CapabilityCheckContext
  ): Promise<CapabilityProviderResult>;
  setup?(
    definition: FormalCapabilityDefinition,
    context: CapabilityCheckContext
  ): Promise<void>;
  use?(
    definition: FormalCapabilityDefinition,
    context: CapabilityCheckContext
  ): Promise<unknown>;
  cleanup?(
    definition: FormalCapabilityDefinition,
    context: CapabilityCheckContext
  ): Promise<void>;
}

export class CapabilityProviderRegistry {
  private readonly providers = new Map<string, CapabilityProvider>();

  constructor(providers: CapabilityProvider[] = []) {
    for (const provider of providers) this.register(provider);
  }

  register(provider: CapabilityProvider): void {
    if (!provider.id.trim() || this.providers.has(provider.id)) {
      throw new Error(`Duplicate or empty capability provider: ${provider.id}.`);
    }
    this.providers.set(provider.id, provider);
  }

  has(providerId: string): boolean {
    return providerId === environmentCapabilityProvider.id
      || this.providers.has(providerId);
  }

  async check(
    definitions: FormalCapabilityDefinition[],
    context: CapabilityCheckContext
  ): Promise<FormalCapabilityResult[]> {
    const checkedAt = new Date().toISOString();
    return Promise.all(definitions.map(async (definition) => {
      const providerId = definition.source.kind === "environment"
        ? environmentCapabilityProvider.id
        : definition.source.providerId;
      const provider = providerId === environmentCapabilityProvider.id
        ? environmentCapabilityProvider
        : this.providers.get(providerId);
      if (!provider) {
        return {
          ...resultFor(definition, checkedAt, {
          available: false,
          reason: `Capability provider ${providerId} is not registered.`,
          unblockCondition: `Implement and register capability provider ${providerId}, or replace the dependency with a direct UI/browser-response assertion.`,
          evidence: {
            providerId,
            status: "provider_missing"
          }
          }),
          configurationError: "provider_not_registered" as const
        };
      }
      return resultFor(
        definition,
        checkedAt,
        await provider.check(definition, context)
      );
    }));
  }

  async setupForCases(
    definitions: FormalCapabilityDefinition[],
    caseIds: string[],
    context: CapabilityCheckContext
  ): Promise<FormalCapabilityDefinition[]> {
    const selected = definitions.filter((definition) =>
      definition.requiredForCaseIds.some((caseId) => caseIds.includes(caseId))
    );
    const prepared: FormalCapabilityDefinition[] = [];
    try {
      for (const definition of selected) {
        const provider = this.requireProvider(definition);
        await provider.setup?.(definition, context);
        prepared.push(definition);
      }
      return prepared;
    } catch (error) {
      await this.cleanup(prepared, context);
      throw error;
    }
  }

  async use<T = unknown>(
    definition: FormalCapabilityDefinition,
    context: CapabilityCheckContext
  ): Promise<T> {
    const provider = this.requireProvider(definition);
    const checked = await provider.check(definition, context);
    if (!checked.available) {
      throw new Error(
        checked.reason ?? `Capability ${definition.id} is unavailable.`
      );
    }
    if (!provider.use) {
      throw new Error(`Capability provider ${provider.id} does not expose a runtime value.`);
    }
    return await provider.use(definition, context) as T;
  }

  async cleanup(
    prepared: FormalCapabilityDefinition[],
    context: CapabilityCheckContext
  ): Promise<void> {
    const failures: string[] = [];
    for (const definition of [...prepared].reverse()) {
      try {
        await this.requireProvider(definition).cleanup?.(definition, context);
      } catch (error) {
        failures.push(
          `${definition.id}: ${error instanceof Error ? error.message : "unknown cleanup failure"}`
        );
      }
    }
    if (failures.length > 0) {
      throw new Error(`Capability cleanup failed: ${failures.join("; ")}`);
    }
  }

  private requireProvider(definition: FormalCapabilityDefinition): CapabilityProvider {
    const providerId = definition.source.kind === "environment"
      ? environmentCapabilityProvider.id
      : definition.source.providerId;
    const provider = providerId === environmentCapabilityProvider.id
      ? environmentCapabilityProvider
      : this.providers.get(providerId);
    if (!provider) throw new Error(`Capability provider ${providerId} is not registered.`);
    return provider;
  }
}

export const environmentCapabilityProvider: CapabilityProvider = {
  id: "environment",
  async check(definition, context) {
    if (definition.source.kind !== "environment") {
      throw new Error("Environment capability provider received a non-environment definition.");
    }
    const value = (context.processEnvironment ?? process.env)[definition.source.variable]?.trim();
    const available = Boolean(value)
      && (
        !definition.source.pattern
        || new RegExp(definition.source.pattern).test(value!)
      );
    return {
      available,
      reason: available ? undefined : definition.unavailableReason,
      unblockCondition: available ? undefined : definition.unblockCondition,
      evidence: {
        providerId: "environment",
        variableNameDigest: sha256(definition.source.variable),
        configured: Boolean(value),
        patternSatisfied: available
      }
    };
  },
  async use(definition, context) {
    if (definition.source.kind !== "environment") {
      throw new Error("Environment capability provider received a non-environment definition.");
    }
    const value = (context.processEnvironment ?? process.env)[definition.source.variable]?.trim();
    if (!value || (
      definition.source.pattern
      && !new RegExp(definition.source.pattern).test(value)
    )) {
      throw new Error(definition.unavailableReason);
    }
    return value;
  }
};

export function createDefaultCapabilityProviderRegistry(): CapabilityProviderRegistry {
  return new CapabilityProviderRegistry([
    fileCapabilityProvider("file_evidence"),
    selectorEvidenceProvider,
    fileCapabilityProvider("auth_state"),
    moduleAdapterProvider
  ]);
}

const moduleAdapterProvider: CapabilityProvider = {
  id: "module_adapter",
  async check(definition, context) {
    if (definition.source.kind !== "provider") {
      throw new Error("module_adapter received a non-provider capability definition.");
    }
    const modulePath = configurationString(definition, "modulePath");
    const exportName = configurationString(definition, "exportName");
    if (!modulePath || !exportName || !/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(exportName)) {
      return {
        available: false,
        reason: "Module adapter configuration is incomplete.",
        unblockCondition: "Configure a workspace modulePath and safe exportName.",
        evidence: { providerId: "module_adapter", status: "configuration_missing" } as Record<string, SafeJsonValue>
      };
    }
    const workspaceRoot = resolve(context.workspaceRoot ?? process.cwd());
    const absolute = resolve(workspaceRoot, modulePath);
    const relativePath = relative(workspaceRoot, absolute);
    if (isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
      return {
        available: false,
        reason: "Module adapter path is outside the workspace.",
        unblockCondition: "Use a workspace-scoped adapter module.",
        evidence: { providerId: "module_adapter", status: "path_outside_workspace" } as Record<string, SafeJsonValue>
      };
    }
    if (!existsSync(absolute)) {
      return {
        available: false,
        reason: definition.unavailableReason,
        unblockCondition: definition.unblockCondition,
        evidence: {
          providerId: "module_adapter",
          pathDigest: sha256(relativePath),
          exportNameDigest: sha256(exportName),
          status: "module_missing"
        } as Record<string, SafeJsonValue>
      };
    }
    const expectedDigest = configurationString(definition, "expectedDigest");
    const contentDigest = sha256(await readFile(absolute));
    const available = !expectedDigest || expectedDigest === contentDigest;
    return {
      available,
      reason: available ? undefined : "Module adapter changed after review.",
      unblockCondition: available ? undefined : "Review the adapter and refresh its expected digest.",
      evidence: {
        providerId: "module_adapter",
        pathDigest: sha256(relativePath),
        exportNameDigest: sha256(exportName),
        contentDigest,
        digestMatches: available
      } as Record<string, SafeJsonValue>
    };
  },
  async use(definition, context) {
    if (definition.source.kind !== "provider") {
      throw new Error("module_adapter received a non-provider capability definition.");
    }
    const checked = await moduleAdapterProvider.check(definition, context);
    if (!checked.available) throw new Error(checked.reason ?? definition.unavailableReason);
    const workspaceRoot = resolve(context.workspaceRoot ?? process.cwd());
    const modulePath = configurationString(definition, "modulePath")!;
    const exportName = configurationString(definition, "exportName")!;
    const imported = await import(pathToFileURL(resolve(workspaceRoot, modulePath)).href) as Record<string, unknown>;
    if (!(exportName in imported)) {
      throw new Error(`Module adapter export ${exportName} is unavailable.`);
    }
    return imported[exportName];
  }
};

const selectorEvidenceProvider: CapabilityProvider = {
  id: "selector_evidence",
  async check(definition, context) {
    const fileResult = await fileCapabilityProvider("selector_evidence").check(
      definition,
      context
    );
    if (!fileResult.available || definition.source.kind !== "provider") {
      return fileResult;
    }
    const configuredPath = configurationString(definition, "path")!;
    const workspaceRoot = resolve(context.workspaceRoot ?? process.cwd());
    let evidence: Record<string, unknown>;
    try {
      evidence = JSON.parse(
        await readFile(resolve(workspaceRoot, configuredPath), "utf8")
      ) as Record<string, unknown>;
    } catch {
      return {
        available: false,
        reason: "Selector evidence is not valid JSON.",
        unblockCondition: "Regenerate selector evidence from the source and runtime contract.",
        evidence: {
          ...fileResult.evidence,
          providerId: "selector_evidence",
          status: "invalid_json"
        }
      };
    }
    const schemaMatches = evidence.schemaVersion === "selector-contract-evidence-v1";
    const requestMatches = evidence.requestId === context.requestId;
    const buildMatches = !context.targetBuildDigest
      || evidence.targetBuildDigest === context.targetBuildDigest;
    const scopeId = configurationString(definition, "scopeId");
    const runtimeScopes = evidence.runtimeScopes;
    const scopeStatus = scopeId
      && runtimeScopes
      && typeof runtimeScopes === "object"
      && !Array.isArray(runtimeScopes)
      ? (runtimeScopes as Record<string, unknown>)[scopeId]
      : undefined;
    const runtimeVerified = scopeId
      ? Boolean(
          scopeStatus
          && typeof scopeStatus === "object"
          && !Array.isArray(scopeStatus)
          && (scopeStatus as Record<string, unknown>).status === "runtime_verified"
        )
      : evidence.runtimeValidation === "runtime_verified";
    const available = schemaMatches && requestMatches && buildMatches && runtimeVerified;
    return {
      available,
      reason: available
        ? undefined
        : "Selector evidence does not prove the current request, build, and runtime contract.",
      unblockCondition: available
        ? undefined
        : "Deploy the matching build and regenerate runtime-verified selector evidence.",
      evidence: {
        ...fileResult.evidence,
        providerId: "selector_evidence",
        status: available ? "runtime_verified" : "contract_unverified",
        schemaMatches,
        requestMatches,
        buildMatches,
        scopeId: scopeId ?? "all",
        runtimeVerified
      }
    };
  }
};

function fileCapabilityProvider(id: string): CapabilityProvider {
  return {
    id,
    async check(definition, context) {
      if (definition.source.kind !== "provider") {
        throw new Error(`${id} received a non-provider capability definition.`);
      }
      const configuredPath = configurationString(definition, "path");
      if (!configuredPath) {
        return {
          available: false,
          reason: `${id} requires a configured evidence path.`,
          unblockCondition: `Configure ${id}.path with a workspace-scoped evidence file.`,
          evidence: { providerId: id, status: "path_missing" } as Record<string, SafeJsonValue>
        };
      }
      const workspaceRoot = resolve(context.workspaceRoot ?? process.cwd());
      const evidencePath = resolve(workspaceRoot, configuredPath);
      const relativePath = relative(workspaceRoot, evidencePath);
      if (isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
        return {
          available: false,
          reason: `${id} evidence path is outside the workspace.`,
          unblockCondition: "Use a workspace-scoped evidence path.",
          evidence: { providerId: id, status: "path_outside_workspace" } as Record<string, SafeJsonValue>
        };
      }
      if (!existsSync(evidencePath)) {
        return {
          available: false,
          reason: definition.unavailableReason,
          unblockCondition: definition.unblockCondition,
          evidence: {
            providerId: id,
            pathDigest: sha256(relativePath),
            status: "file_missing"
          } as Record<string, SafeJsonValue>
        };
      }
      const metadata = await stat(evidencePath);
      if (!metadata.isFile()) {
        return {
          available: false,
          reason: `${id} evidence path is not a file.`,
          unblockCondition: "Provide a regular evidence file.",
          evidence: {
            providerId: id,
            pathDigest: sha256(relativePath),
            status: "not_file"
          } as Record<string, SafeJsonValue>
        };
      }
      const expectedDigest = configurationString(definition, "expectedDigest");
      const contentDigest = expectedDigest
        ? sha256(await readFile(evidencePath, "utf8"))
        : undefined;
      const digestMatches = !expectedDigest || expectedDigest === contentDigest;
      return {
        available: digestMatches,
        reason: digestMatches ? undefined : `${id} evidence changed after readiness.`,
        unblockCondition: digestMatches ? undefined : `Refresh ${id} readiness evidence.`,
        evidence: {
          providerId: id,
          pathDigest: sha256(relativePath),
          size: metadata.size,
          modifiedAtMs: Math.trunc(metadata.mtimeMs),
          digestMatches,
          ...(contentDigest ? { contentDigest } : {})
        } as Record<string, SafeJsonValue>
      };
    }
  };
}

function resultFor(
  definition: FormalCapabilityDefinition,
  checkedAt: string,
  result: CapabilityProviderResult
): FormalCapabilityResult {
  return {
    capabilityId: definition.id,
    available: result.available,
    affectedCaseIds: [...definition.requiredForCaseIds],
    reason: result.available ? undefined : result.reason ?? definition.unavailableReason,
    unblockCondition: result.available
      ? undefined
      : result.unblockCondition ?? definition.unblockCondition,
    checkedAt,
    evidenceDigest: sha256(canonicalJson({
      schemaVersion: "capability-evidence-v1",
      capabilityId: definition.id,
      available: result.available,
      evidence: result.evidence
    } as unknown as SafeJsonValue)),
    ...(result.expiresAt ? { expiresAt: result.expiresAt } : {})
  };
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function configurationString(
  definition: FormalCapabilityDefinition,
  key: string
): string | undefined {
  if (definition.source.kind !== "provider") return undefined;
  const value = definition.source.configuration?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
