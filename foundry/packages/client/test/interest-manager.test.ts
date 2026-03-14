import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceEvent, WorkspaceSummarySnapshot } from "@sandbox-agent/foundry-shared";
import type { ActorConn, BackendClient } from "../src/backend-client.js";
import { RemoteInterestManager } from "../src/interest/remote-manager.js";

class FakeActorConn implements ActorConn {
  private readonly listeners = new Map<string, Set<(payload: any) => void>>();
  private readonly errorListeners = new Set<(error: unknown) => void>();
  disposeCount = 0;

  on(event: string, listener: (payload: any) => void): () => void {
    let current = this.listeners.get(event);
    if (!current) {
      current = new Set();
      this.listeners.set(event, current);
    }
    current.add(listener);
    return () => {
      current?.delete(listener);
      if (current?.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  onError(listener: (error: unknown) => void): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  emit(event: string, payload: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(payload);
    }
  }

  emitError(error: unknown): void {
    for (const listener of this.errorListeners) {
      listener(error);
    }
  }

  async dispose(): Promise<void> {
    this.disposeCount += 1;
  }
}

function workspaceSnapshot(): WorkspaceSummarySnapshot {
  return {
    workspaceId: "ws-1",
    repos: [{ id: "repo-1", label: "repo-1", taskCount: 1, latestActivityMs: 10 }],
    taskSummaries: [
      {
        id: "task-1",
        repoId: "repo-1",
        title: "Initial task",
        status: "idle",
        repoName: "repo-1",
        updatedAtMs: 10,
        branch: "main",
        pullRequest: null,
        sessionsSummary: [],
      },
    ],
    openPullRequests: [],
  };
}

function createBackend(conn: FakeActorConn, snapshot: WorkspaceSummarySnapshot): BackendClient {
  return {
    connectWorkspace: vi.fn(async () => conn),
    getWorkspaceSummary: vi.fn(async () => snapshot),
  } as unknown as BackendClient;
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("RemoteInterestManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shares one connection per topic key and applies incoming events", async () => {
    const conn = new FakeActorConn();
    const backend = createBackend(conn, workspaceSnapshot());
    const manager = new RemoteInterestManager(backend);
    const params = { workspaceId: "ws-1" } as const;
    const listenerA = vi.fn();
    const listenerB = vi.fn();

    const unsubscribeA = manager.subscribe("workspace", params, listenerA);
    const unsubscribeB = manager.subscribe("workspace", params, listenerB);
    await flushAsyncWork();

    expect(backend.connectWorkspace).toHaveBeenCalledTimes(1);
    expect(backend.getWorkspaceSummary).toHaveBeenCalledTimes(1);
    expect(manager.getStatus("workspace", params)).toBe("connected");
    expect(manager.getSnapshot("workspace", params)?.taskSummaries[0]?.title).toBe("Initial task");
    expect(manager.listDebugTopics()).toEqual([
      expect.objectContaining({
        topicKey: "workspace",
        cacheKey: "workspace:ws-1",
        listenerCount: 2,
        status: "connected",
      }),
    ]);

    conn.emit("workspaceUpdated", {
      type: "taskSummaryUpdated",
      taskSummary: {
        id: "task-1",
        repoId: "repo-1",
        title: "Updated task",
        status: "running",
        repoName: "repo-1",
        updatedAtMs: 20,
        branch: "feature/live",
        pullRequest: null,
        sessionsSummary: [],
      },
    } satisfies WorkspaceEvent);

    expect(manager.getSnapshot("workspace", params)?.taskSummaries[0]?.title).toBe("Updated task");
    expect(listenerA).toHaveBeenCalled();
    expect(listenerB).toHaveBeenCalled();
    expect(manager.listDebugTopics()[0]?.lastRefreshAt).toEqual(expect.any(Number));

    unsubscribeA();
    unsubscribeB();
    manager.dispose();
  });

  it("keeps a topic warm during the grace period and tears it down afterwards", async () => {
    const conn = new FakeActorConn();
    const backend = createBackend(conn, workspaceSnapshot());
    const manager = new RemoteInterestManager(backend);
    const params = { workspaceId: "ws-1" } as const;

    const unsubscribeA = manager.subscribe("workspace", params, () => {});
    await flushAsyncWork();
    unsubscribeA();

    vi.advanceTimersByTime(29_000);
    expect(manager.listDebugTopics()).toEqual([]);

    const unsubscribeB = manager.subscribe("workspace", params, () => {});
    await flushAsyncWork();

    expect(backend.connectWorkspace).toHaveBeenCalledTimes(1);
    expect(conn.disposeCount).toBe(0);

    unsubscribeB();
    expect(manager.listDebugTopics()).toEqual([]);
    vi.advanceTimersByTime(30_000);

    expect(conn.disposeCount).toBe(1);
    expect(manager.getSnapshot("workspace", params)).toBeUndefined();
  });

  it("surfaces connection errors to subscribers", async () => {
    const conn = new FakeActorConn();
    const backend = createBackend(conn, workspaceSnapshot());
    const manager = new RemoteInterestManager(backend);
    const params = { workspaceId: "ws-1" } as const;

    manager.subscribe("workspace", params, () => {});
    await flushAsyncWork();

    conn.emitError(new Error("socket dropped"));

    expect(manager.getStatus("workspace", params)).toBe("error");
    expect(manager.getError("workspace", params)?.message).toBe("socket dropped");
  });
});
