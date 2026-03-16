export interface SandboxProvider {
  /** Provider name. Must match the prefix in sandbox IDs (for example "e2b"). */
  name: string;

  /** Provision a new sandbox and return the provider-specific ID. */
  create(): Promise<string>;

  /** Permanently tear down a sandbox. */
  destroy(sandboxId: string): Promise<void>;

  /**
   * Return the sandbox-agent base URL for this sandbox.
   * Providers that cannot expose a URL should implement `getFetch()` instead.
   */
  getUrl?(sandboxId: string): Promise<string>;

  /**
   * Return a fetch implementation that routes requests to the sandbox.
   * Providers that expose a URL can implement `getUrl()` instead.
   */
  getFetch?(sandboxId: string): Promise<typeof globalThis.fetch>;

  /**
   * Ensure the sandbox-agent server process is running inside the sandbox.
   * Called during health-wait after consecutive failures, and before
   * reconnecting to an existing sandbox. Implementations should be
   * idempotent — if the server is already running, this should be a no-op
   * (e.g. the duplicate process exits on port conflict).
   */
  ensureServer?(sandboxId: string): Promise<void>;
}
