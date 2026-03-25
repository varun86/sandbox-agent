import { ModalClient } from "modal";
import type { SandboxProvider } from "./types.ts";
import { DEFAULT_AGENTS, SANDBOX_AGENT_INSTALL_SCRIPT } from "./shared.ts";

const DEFAULT_AGENT_PORT = 3000;
const DEFAULT_APP_NAME = "sandbox-agent";
const DEFAULT_MEMORY_MIB = 2048;

export interface ModalProviderOptions {
  create?: {
    secrets?: Record<string, string>;
    appName?: string;
    memoryMiB?: number;
  };
  agentPort?: number;
}

export function modal(options: ModalProviderOptions = {}): SandboxProvider {
  const agentPort = options.agentPort ?? DEFAULT_AGENT_PORT;
  const appName = options.create?.appName ?? DEFAULT_APP_NAME;
  const memoryMiB = options.create?.memoryMiB ?? DEFAULT_MEMORY_MIB;
  const client = new ModalClient();

  return {
    name: "modal",
    defaultCwd: "/root",
    async create(): Promise<string> {
      const app = await client.apps.fromName(appName, { createIfMissing: true });

      // Pre-install sandbox-agent and agents in the image so they are cached
      // across sandbox creates and don't need to be installed at runtime.
      const installAgentCmds = DEFAULT_AGENTS.map((agent) => `RUN sandbox-agent install-agent ${agent}`);
      const image = client.images
        .fromRegistry("node:22-slim")
        .dockerfileCommands([
          "RUN apt-get update && apt-get install -y curl ca-certificates && rm -rf /var/lib/apt/lists/*",
          `RUN curl -fsSL ${SANDBOX_AGENT_INSTALL_SCRIPT} | sh`,
          ...installAgentCmds,
        ]);

      const envVars = options.create?.secrets ?? {};
      const secrets = Object.keys(envVars).length > 0 ? [await client.secrets.fromObject(envVars)] : [];

      const sb = await client.sandboxes.create(app, image, {
        encryptedPorts: [agentPort],
        secrets,
        memoryMiB,
      });

      // Start the server as a long-running exec process. We intentionally
      // do NOT await p.wait() — the process stays alive for the sandbox
      // lifetime and keeps the port open for the tunnel.
      sb.exec(["sandbox-agent", "server", "--no-token", "--host", "0.0.0.0", "--port", String(agentPort)]);

      return sb.sandboxId;
    },
    async destroy(sandboxId: string): Promise<void> {
      const sb = await client.sandboxes.fromId(sandboxId);
      await sb.terminate();
    },
    async getUrl(sandboxId: string): Promise<string> {
      const sb = await client.sandboxes.fromId(sandboxId);
      const tunnels = await sb.tunnels();
      const tunnel = tunnels[agentPort];
      if (!tunnel) {
        throw new Error(`modal: no tunnel found for port ${agentPort}`);
      }
      return tunnel.url;
    },
    async ensureServer(sandboxId: string): Promise<void> {
      const sb = await client.sandboxes.fromId(sandboxId);
      sb.exec(["sandbox-agent", "server", "--no-token", "--host", "0.0.0.0", "--port", String(agentPort)]);
    },
  };
}
