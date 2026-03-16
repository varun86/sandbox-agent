import { Sandbox } from "@e2b/code-interpreter";
import type { SandboxProvider } from "./types.ts";
import { DEFAULT_AGENTS, SANDBOX_AGENT_INSTALL_SCRIPT } from "./shared.ts";

const DEFAULT_AGENT_PORT = 3000;

export interface E2BProviderOptions {
  create?: Record<string, unknown> | (() => Record<string, unknown> | Promise<Record<string, unknown>>);
  connect?: Record<string, unknown> | ((sandboxId: string) => Record<string, unknown> | Promise<Record<string, unknown>>);
  agentPort?: number;
}

async function resolveOptions(value: E2BProviderOptions["create"] | E2BProviderOptions["connect"], sandboxId?: string): Promise<Record<string, unknown>> {
  if (!value) return {};
  if (typeof value === "function") {
    if (sandboxId) {
      return await (value as (id: string) => Record<string, unknown> | Promise<Record<string, unknown>>)(sandboxId);
    }
    return await (value as () => Record<string, unknown> | Promise<Record<string, unknown>>)();
  }
  return value;
}

export function e2b(options: E2BProviderOptions = {}): SandboxProvider {
  const agentPort = options.agentPort ?? DEFAULT_AGENT_PORT;

  return {
    name: "e2b",
    async create(): Promise<string> {
      const createOpts = await resolveOptions(options.create);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sandbox = await Sandbox.create({ allowInternetAccess: true, ...createOpts } as any);

      await sandbox.commands.run(`curl -fsSL ${SANDBOX_AGENT_INSTALL_SCRIPT} | sh`).then((r) => {
        if (r.exitCode !== 0) throw new Error(`e2b install failed:\n${r.stderr}`);
      });
      for (const agent of DEFAULT_AGENTS) {
        await sandbox.commands.run(`sandbox-agent install-agent ${agent}`).then((r) => {
          if (r.exitCode !== 0) throw new Error(`e2b agent install failed: ${agent}\n${r.stderr}`);
        });
      }
      await sandbox.commands.run(`sandbox-agent server --no-token --host 0.0.0.0 --port ${agentPort}`, { background: true, timeoutMs: 0 });

      return sandbox.sandboxId;
    },
    async destroy(sandboxId: string): Promise<void> {
      const connectOpts = await resolveOptions(options.connect, sandboxId);
      const sandbox = await Sandbox.connect(sandboxId, connectOpts as any);
      await sandbox.kill();
    },
    async getUrl(sandboxId: string): Promise<string> {
      const connectOpts = await resolveOptions(options.connect, sandboxId);
      const sandbox = await Sandbox.connect(sandboxId, connectOpts as any);
      return `https://${sandbox.getHost(agentPort)}`;
    },
    async ensureServer(sandboxId: string): Promise<void> {
      const connectOpts = await resolveOptions(options.connect, sandboxId);
      const sandbox = await Sandbox.connect(sandboxId, connectOpts as any);
      await sandbox.commands.run(`sandbox-agent server --no-token --host 0.0.0.0 --port ${agentPort}`, { background: true, timeoutMs: 0 });
    },
  };
}
