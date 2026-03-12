import { getOrCreateWorkspace } from "../actors/handles.js";
import { APP_SHELL_WORKSPACE_ID } from "../actors/workspace/app-shell.js";

export interface ResolvedGithubAuth {
  githubToken: string;
  scopes: string[];
}

export async function resolveWorkspaceGithubAuth(c: any, workspaceId: string): Promise<ResolvedGithubAuth | null> {
  if (!workspaceId || workspaceId === APP_SHELL_WORKSPACE_ID) {
    return null;
  }

  try {
    const appWorkspace = await getOrCreateWorkspace(c, APP_SHELL_WORKSPACE_ID);
    const resolved = await appWorkspace.resolveAppGithubToken({
      organizationId: workspaceId,
      requireRepoScope: true,
    });
    if (!resolved?.accessToken) {
      return null;
    }
    return {
      githubToken: resolved.accessToken,
      scopes: Array.isArray(resolved.scopes) ? resolved.scopes : [],
    };
  } catch {
    return null;
  }
}
