import { createBackendClient } from "@openhandoff/client";
import { backendEndpoint, defaultWorkspaceId, frontendClientMode } from "./env";

export const backendClient = createBackendClient({
  endpoint: backendEndpoint,
  defaultWorkspaceId,
  mode: frontendClientMode,
});
