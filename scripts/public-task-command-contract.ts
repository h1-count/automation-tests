export const PUBLIC_TASK_COMMANDS = {
  "task:initialize": "tsx src/support/task-workflow/cli/manage.ts init",
  "task:resume": "tsx src/support/task-workflow/cli/manage.ts resume",
  "task:status": "tsx src/support/task-workflow/cli/status.ts",
  "task:gate": "tsx src/support/task-workflow/cli/gate.ts",
  "task:manage": "tsx src/support/task-workflow/cli/manage.ts"
} as const;

export interface PublicTaskCommandInspection {
  mismatches: string[];
  unexpected: string[];
}

export function inspectPublicTaskCommands(
  scripts: Record<string, string>
): PublicTaskCommandInspection {
  const allowedNames = new Set(Object.keys(PUBLIC_TASK_COMMANDS));
  const mismatches = Object.entries(PUBLIC_TASK_COMMANDS)
    .filter(([name, command]) => scripts[name] !== command)
    .map(([name, command]) => `${name} must be ${command}`);
  const unexpected = Object.keys(scripts)
    .filter((name) => name.startsWith("task:") && !allowedNames.has(name))
    .sort();

  return { mismatches, unexpected };
}
