export const DEFAULT_SANDBOX_AGENT_IMAGE = "rivetdev/sandbox-agent:0.5.0-rc.2-full";
export const SANDBOX_AGENT_INSTALL_SCRIPT = "https://releases.rivet.dev/sandbox-agent/0.4.x/install.sh";
export const DEFAULT_AGENTS = ["claude", "codex"] as const;

export function buildServerStartCommand(port: number): string {
  return `nohup sandbox-agent server --no-token --host 0.0.0.0 --port ${port} >/tmp/sandbox-agent.log 2>&1 &`;
}
