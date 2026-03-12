import { createTaskWorkbenchClient, type TaskWorkbenchClient } from "@sandbox-agent/foundry-client";
import { backendClient } from "./backend";
import { frontendClientMode } from "./env";

const workbenchClients = new Map<string, TaskWorkbenchClient>();

export function getTaskWorkbenchClient(workspaceId: string): TaskWorkbenchClient {
  const existing = workbenchClients.get(workspaceId);
  if (existing) {
    return existing;
  }

  const created = createTaskWorkbenchClient({
    mode: frontendClientMode,
    backend: backendClient,
    workspaceId,
  });
  workbenchClients.set(workspaceId, created);
  return created;
}
