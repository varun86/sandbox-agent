import { authUserKey, taskKey, historyKey, projectBranchSyncKey, projectKey, projectPrSyncKey, taskSandboxKey, workspaceKey } from "./keys.js";

export function actorClient(c: any) {
  return c.client();
}

export async function getOrCreateWorkspace(c: any, workspaceId: string) {
  return await actorClient(c).workspace.getOrCreate(workspaceKey(workspaceId), {
    createWithInput: workspaceId,
  });
}

export async function getOrCreateAuthUser(c: any, userId: string) {
  return await actorClient(c).authUser.getOrCreate(authUserKey(userId), {
    createWithInput: { userId },
  });
}

export function getAuthUser(c: any, userId: string) {
  return actorClient(c).authUser.get(authUserKey(userId));
}

export async function getOrCreateProject(c: any, workspaceId: string, repoId: string, remoteUrl: string) {
  return await actorClient(c).project.getOrCreate(projectKey(workspaceId, repoId), {
    createWithInput: {
      workspaceId,
      repoId,
      remoteUrl,
    },
  });
}

export function getProject(c: any, workspaceId: string, repoId: string) {
  return actorClient(c).project.get(projectKey(workspaceId, repoId));
}

export function getTask(c: any, workspaceId: string, repoId: string, taskId: string) {
  return actorClient(c).task.get(taskKey(workspaceId, repoId, taskId));
}

export async function getOrCreateTask(c: any, workspaceId: string, repoId: string, taskId: string, createWithInput: Record<string, unknown>) {
  return await actorClient(c).task.getOrCreate(taskKey(workspaceId, repoId, taskId), {
    createWithInput,
  });
}

export async function getOrCreateHistory(c: any, workspaceId: string, repoId: string) {
  return await actorClient(c).history.getOrCreate(historyKey(workspaceId, repoId), {
    createWithInput: {
      workspaceId,
      repoId,
    },
  });
}

export async function getOrCreateProjectPrSync(c: any, workspaceId: string, repoId: string, repoPath: string, intervalMs: number) {
  return await actorClient(c).projectPrSync.getOrCreate(projectPrSyncKey(workspaceId, repoId), {
    createWithInput: {
      workspaceId,
      repoId,
      repoPath,
      intervalMs,
    },
  });
}

export async function getOrCreateProjectBranchSync(c: any, workspaceId: string, repoId: string, repoPath: string, intervalMs: number) {
  return await actorClient(c).projectBranchSync.getOrCreate(projectBranchSyncKey(workspaceId, repoId), {
    createWithInput: {
      workspaceId,
      repoId,
      repoPath,
      intervalMs,
    },
  });
}

export function getTaskSandbox(c: any, workspaceId: string, sandboxId: string) {
  return actorClient(c).taskSandbox.get(taskSandboxKey(workspaceId, sandboxId));
}

export async function getOrCreateTaskSandbox(c: any, workspaceId: string, sandboxId: string, createWithInput?: Record<string, unknown>) {
  return await actorClient(c).taskSandbox.getOrCreate(taskSandboxKey(workspaceId, sandboxId), {
    createWithInput,
  });
}

export function selfProjectPrSync(c: any) {
  return actorClient(c).projectPrSync.getForId(c.actorId);
}

export function selfProjectBranchSync(c: any) {
  return actorClient(c).projectBranchSync.getForId(c.actorId);
}

export function selfHistory(c: any) {
  return actorClient(c).history.getForId(c.actorId);
}

export function selfTask(c: any) {
  return actorClient(c).task.getForId(c.actorId);
}

export function selfWorkspace(c: any) {
  return actorClient(c).workspace.getForId(c.actorId);
}

export function selfProject(c: any) {
  return actorClient(c).project.getForId(c.actorId);
}

export function selfAuthUser(c: any) {
  return actorClient(c).authUser.getForId(c.actorId);
}
