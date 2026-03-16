import { compute } from "computesdk";
import type { SandboxProvider } from "./types.ts";
import { DEFAULT_AGENTS, SANDBOX_AGENT_INSTALL_SCRIPT } from "./shared.ts";

const DEFAULT_AGENT_PORT = 3000;

export interface ComputeSdkProviderOptions {
  create?: {
    envs?: Record<string, string>;
  };
  agentPort?: number;
}

export function computesdk(options: ComputeSdkProviderOptions = {}): SandboxProvider {
  const agentPort = options.agentPort ?? DEFAULT_AGENT_PORT;

  return {
    name: "computesdk",
    async create(): Promise<string> {
      const envs = options.create?.envs;
      const sandbox = await compute.sandbox.create({
        envs: envs && Object.keys(envs).length > 0 ? envs : undefined,
      });

      const run = async (cmd: string, runOptions?: { background?: boolean }) => {
        const result = await sandbox.runCommand(cmd, runOptions);
        if (typeof result?.exitCode === "number" && result.exitCode !== 0) {
          throw new Error(`computesdk command failed: ${cmd} (exit ${result.exitCode})\n${result.stderr || ""}`);
        }
        return result;
      };

      await run(`curl -fsSL ${SANDBOX_AGENT_INSTALL_SCRIPT} | sh`);
      for (const agent of DEFAULT_AGENTS) {
        await run(`sandbox-agent install-agent ${agent}`);
      }
      await run(`sandbox-agent server --no-token --host 0.0.0.0 --port ${agentPort}`, {
        background: true,
      });

      return sandbox.sandboxId;
    },
    async destroy(sandboxId: string): Promise<void> {
      const sandbox = await compute.sandbox.getById(sandboxId);
      if (sandbox) await sandbox.destroy();
    },
    async getUrl(sandboxId: string): Promise<string> {
      const sandbox = await compute.sandbox.getById(sandboxId);
      if (!sandbox) throw new Error(`computesdk sandbox not found: ${sandboxId}`);
      return sandbox.getUrl({ port: agentPort });
    },
    async ensureServer(sandboxId: string): Promise<void> {
      const sandbox = await compute.sandbox.getById(sandboxId);
      if (!sandbox) throw new Error(`computesdk sandbox not found: ${sandboxId}`);
      await sandbox.runCommand(`sandbox-agent server --no-token --host 0.0.0.0 --port ${agentPort}`, {
        background: true,
      });
    },
  };
}
