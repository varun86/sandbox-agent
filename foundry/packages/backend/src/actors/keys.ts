export type ActorKey = string[];

export function workspaceKey(workspaceId: string): ActorKey {
  return ["ws", workspaceId];
}

export function authUserKey(userId: string): ActorKey {
  return ["ws", "app", "user", userId];
}

export function projectKey(workspaceId: string, repoId: string): ActorKey {
  return ["ws", workspaceId, "project", repoId];
}

export function taskKey(workspaceId: string, repoId: string, taskId: string): ActorKey {
  return ["ws", workspaceId, "project", repoId, "task", taskId];
}

export function taskSandboxKey(workspaceId: string, sandboxId: string): ActorKey {
  return ["ws", workspaceId, "sandbox", sandboxId];
}

export function historyKey(workspaceId: string, repoId: string): ActorKey {
  return ["ws", workspaceId, "project", repoId, "history"];
}

export function projectPrSyncKey(workspaceId: string, repoId: string): ActorKey {
  return ["ws", workspaceId, "project", repoId, "pr-sync"];
}

export function projectBranchSyncKey(workspaceId: string, repoId: string): ActorKey {
  return ["ws", workspaceId, "project", repoId, "branch-sync"];
}
