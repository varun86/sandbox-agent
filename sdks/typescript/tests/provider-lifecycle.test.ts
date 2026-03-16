import { beforeEach, describe, expect, it, vi } from "vitest";
import { SandboxAgent, SandboxDestroyedError, type SandboxProvider } from "../src/index.ts";

const e2bMocks = vi.hoisted(() => {
  class MockNotFoundError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "NotFoundError";
    }
  }

  return {
    MockNotFoundError,
    betaCreate: vi.fn(),
    connect: vi.fn(),
  };
});

vi.mock("@e2b/code-interpreter", () => ({
  NotFoundError: e2bMocks.MockNotFoundError,
  Sandbox: {
    betaCreate: e2bMocks.betaCreate,
    connect: e2bMocks.connect,
  },
}));

import { e2b } from "../src/providers/e2b.ts";

function createFetch(): typeof fetch {
  return async () => new Response(null, { status: 200 });
}

function createBaseProvider(overrides: Partial<SandboxProvider> = {}): SandboxProvider {
  return {
    name: "mock",
    async create(): Promise<string> {
      return "created";
    },
    async destroy(): Promise<void> {},
    async getUrl(): Promise<string> {
      return "http://127.0.0.1:3000";
    },
    ...overrides,
  };
}

function createMockSandbox() {
  return {
    sandboxId: "sbx-123",
    getHost: vi.fn(() => "sandbox.example"),
    betaPause: vi.fn(async () => true),
    kill: vi.fn(async () => undefined),
    commands: {
      run: vi.fn(async () => ({ exitCode: 0, stderr: "" })),
    },
  };
}

describe("SandboxAgent provider lifecycle", () => {
  it("reconnects an existing sandbox before ensureServer", async () => {
    const order: string[] = [];
    const provider = createBaseProvider({
      reconnect: vi.fn(async () => {
        order.push("reconnect");
      }),
      ensureServer: vi.fn(async () => {
        order.push("ensureServer");
      }),
    });

    const sdk = await SandboxAgent.start({
      sandbox: provider,
      sandboxId: "mock/existing",
      skipHealthCheck: true,
      fetch: createFetch(),
    });

    expect(order).toEqual(["reconnect", "ensureServer"]);

    await sdk.killSandbox();
  });

  it("surfaces SandboxDestroyedError from reconnect", async () => {
    const provider = createBaseProvider({
      reconnect: vi.fn(async () => {
        throw new SandboxDestroyedError("existing", "mock");
      }),
      ensureServer: vi.fn(async () => undefined),
    });

    await expect(
      SandboxAgent.start({
        sandbox: provider,
        sandboxId: "mock/existing",
        skipHealthCheck: true,
        fetch: createFetch(),
      }),
    ).rejects.toBeInstanceOf(SandboxDestroyedError);

    expect(provider.ensureServer).not.toHaveBeenCalled();
  });

  it("uses provider pause and kill hooks for explicit lifecycle control", async () => {
    const pause = vi.fn(async () => undefined);
    const kill = vi.fn(async () => undefined);
    const provider = createBaseProvider({ pause, kill });

    const paused = await SandboxAgent.start({
      sandbox: provider,
      skipHealthCheck: true,
      fetch: createFetch(),
    });
    await paused.pauseSandbox();
    expect(pause).toHaveBeenCalledWith("created");

    const killed = await SandboxAgent.start({
      sandbox: provider,
      skipHealthCheck: true,
      fetch: createFetch(),
    });
    await killed.killSandbox();
    expect(kill).toHaveBeenCalledWith("created");
  });
});

describe("e2b provider", () => {
  beforeEach(() => {
    e2bMocks.betaCreate.mockReset();
    e2bMocks.connect.mockReset();
  });

  it("creates sandboxes with betaCreate, autoPause, and the default timeout", async () => {
    const sandbox = createMockSandbox();
    e2bMocks.betaCreate.mockResolvedValue(sandbox);

    const provider = e2b({
      create: {
        envs: { ANTHROPIC_API_KEY: "test" },
      },
    });

    await expect(provider.create()).resolves.toBe("sbx-123");

    expect(e2bMocks.betaCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        allowInternetAccess: true,
        autoPause: true,
        timeoutMs: 3_600_000,
        envs: { ANTHROPIC_API_KEY: "test" },
      }),
    );
  });

  it("allows timeoutMs and autoPause to be overridden", async () => {
    const sandbox = createMockSandbox();
    e2bMocks.betaCreate.mockResolvedValue(sandbox);

    const provider = e2b({
      timeoutMs: 123_456,
      autoPause: false,
    });

    await provider.create();

    expect(e2bMocks.betaCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        autoPause: false,
        timeoutMs: 123_456,
      }),
    );
  });

  it("pauses by default in destroy and uses kill for permanent deletion", async () => {
    const sandbox = createMockSandbox();
    e2bMocks.connect.mockResolvedValue(sandbox);
    const provider = e2b();

    await provider.destroy("sbx-123");
    expect(e2bMocks.connect).toHaveBeenLastCalledWith("sbx-123", { timeoutMs: 3_600_000 });
    expect(sandbox.betaPause).toHaveBeenCalledTimes(1);
    expect(sandbox.kill).not.toHaveBeenCalled();

    await provider.kill?.("sbx-123");
    expect(sandbox.kill).toHaveBeenCalledTimes(1);
  });

  it("maps missing reconnect targets to SandboxDestroyedError", async () => {
    e2bMocks.connect.mockRejectedValue(new e2bMocks.MockNotFoundError("gone"));
    const provider = e2b();

    await expect(provider.reconnect?.("missing-sandbox")).rejects.toBeInstanceOf(SandboxDestroyedError);
  });
});
