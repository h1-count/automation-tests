import type { CleanupAction, TestResourceType } from "./types.js";

export class CleanupActionRegistry {
  private readonly actions = new Map<string, CleanupAction>();

  register(action: CleanupAction): void {
    if (!action.id.trim() || this.actions.has(action.id)) {
      throw new Error(`Cleanup action ID is empty or already registered: ${action.id}`);
    }
    this.actions.set(action.id, action);
  }

  get(id: string | undefined, resourceType?: TestResourceType): CleanupAction | undefined {
    if (!id) {
      return undefined;
    }
    const action = this.actions.get(id);
    return !action || (resourceType && action.resourceType !== resourceType) ? undefined : action;
  }
}
