import { ModalClient, type Image, type SandboxCreateParams } from "modal";
import type { SandboxProvider } from "./types.ts";
import { DEFAULT_AGENTS, SANDBOX_AGENT_INSTALL_SCRIPT } from "./shared.ts";

const DEFAULT_AGENT_PORT = 3000;
const DEFAULT_APP_NAME = "sandbox-agent";
const DEFAULT_MEMORY_MIB = 2048;
const DEFAULT_BASE_IMAGE = "node:22-slim";

type ModalCreateOverrides = Omit<Partial<SandboxCreateParams>, "secrets" | "encryptedPorts"> & {
  secrets?: Record<string, string>;
  encryptedPorts?: number[];
  appName?: string;
};

export interface ModalProviderOptions {
  create?: ModalCreateOverrides | (() => ModalCreateOverrides | Promise<ModalCreateOverrides>);
  image?: string | Image;
  agentPort?: number;
}

async function resolveCreateOptions(value: ModalProviderOptions["create"]): Promise<ModalCreateOverrides> {
  if (!value) return {};
  return typeof value === "function" ? await value() : value;
}

export function modal(options: ModalProviderOptions = {}): SandboxProvider {
  const agentPort = options.agentPort ?? DEFAULT_AGENT_PORT;
  const client = new ModalClient();

  return {
    name: "modal",
    async create(): Promise<string> {
      const createOpts = await resolveCreateOptions(options.create);
      const appName = createOpts.appName ?? DEFAULT_APP_NAME;
      const baseImage = options.image ?? DEFAULT_BASE_IMAGE;
      const app = await client.apps.fromName(appName, { createIfMissing: true });

      // Pre-install sandbox-agent and agents in the image so they are cached
      // across sandbox creates and don't need to be installed at runtime.
      const installAgentCmds = DEFAULT_AGENTS.map((agent) => `RUN sandbox-agent install-agent ${agent}`);
      const image = (typeof baseImage === "string" ? client.images.fromRegistry(baseImage) : baseImage).dockerfileCommands([
        "RUN apt-get update && apt-get install -y curl ca-certificates && rm -rf /var/lib/apt/lists/*",
        `RUN curl -fsSL ${SANDBOX_AGENT_INSTALL_SCRIPT} | sh`,
        ...installAgentCmds,
      ]);

      const envVars = createOpts.secrets ?? {};
      const secrets = Object.keys(envVars).length > 0 ? [await client.secrets.fromObject(envVars)] : [];
      const sandboxCreateOpts = { ...createOpts };
      delete sandboxCreateOpts.appName;
      delete sandboxCreateOpts.secrets;

      const extraPorts = createOpts.encryptedPorts ?? [];
      delete sandboxCreateOpts.encryptedPorts;

      const sb = await client.sandboxes.create(app, image, {
        ...sandboxCreateOpts,
        encryptedPorts: [agentPort, ...extraPorts],
        secrets,
        memoryMiB: sandboxCreateOpts.memoryMiB ?? DEFAULT_MEMORY_MIB,
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
