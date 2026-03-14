import type {
  AppEvent,
  FoundryAppSnapshot,
  ProviderId,
  SandboxProcessesEvent,
  SessionEvent,
  TaskEvent,
  WorkbenchSessionDetail,
  WorkbenchTaskDetail,
  WorkspaceEvent,
  WorkspaceSummarySnapshot,
} from "@sandbox-agent/foundry-shared";
import type { ActorConn, BackendClient, SandboxProcessRecord } from "../backend-client.js";

/**
 * Topic definitions for the interest manager.
 *
 * Each topic describes one actor connection plus one materialized read model.
 * Events always carry full replacement payloads for the changed entity so the
 * client can replace cached state directly instead of reconstructing patches.
 */
export interface TopicDefinition<TData, TParams, TEvent> {
  key: (params: TParams) => string;
  event: string;
  connect: (backend: BackendClient, params: TParams) => Promise<ActorConn>;
  fetchInitial: (backend: BackendClient, params: TParams) => Promise<TData>;
  applyEvent: (current: TData, event: TEvent) => TData;
}

export interface AppTopicParams {}
export interface WorkspaceTopicParams {
  workspaceId: string;
}
export interface TaskTopicParams {
  workspaceId: string;
  repoId: string;
  taskId: string;
}
export interface SessionTopicParams {
  workspaceId: string;
  repoId: string;
  taskId: string;
  sessionId: string;
}
export interface SandboxProcessesTopicParams {
  workspaceId: string;
  providerId: ProviderId;
  sandboxId: string;
}

function upsertById<T extends { id: string }>(items: T[], nextItem: T, sort: (left: T, right: T) => number): T[] {
  const filtered = items.filter((item) => item.id !== nextItem.id);
  return [...filtered, nextItem].sort(sort);
}

function upsertByPrId<T extends { prId: string }>(items: T[], nextItem: T, sort: (left: T, right: T) => number): T[] {
  const filtered = items.filter((item) => item.prId !== nextItem.prId);
  return [...filtered, nextItem].sort(sort);
}

export const topicDefinitions = {
  app: {
    key: () => "app",
    event: "appUpdated",
    connect: (backend: BackendClient, _params: AppTopicParams) => backend.connectWorkspace("app"),
    fetchInitial: (backend: BackendClient, _params: AppTopicParams) => backend.getAppSnapshot(),
    applyEvent: (_current: FoundryAppSnapshot, event: AppEvent) => event.snapshot,
  } satisfies TopicDefinition<FoundryAppSnapshot, AppTopicParams, AppEvent>,

  workspace: {
    key: (params: WorkspaceTopicParams) => `workspace:${params.workspaceId}`,
    event: "workspaceUpdated",
    connect: (backend: BackendClient, params: WorkspaceTopicParams) => backend.connectWorkspace(params.workspaceId),
    fetchInitial: (backend: BackendClient, params: WorkspaceTopicParams) => backend.getWorkspaceSummary(params.workspaceId),
    applyEvent: (current: WorkspaceSummarySnapshot, event: WorkspaceEvent) => {
      switch (event.type) {
        case "taskSummaryUpdated":
          return {
            ...current,
            taskSummaries: upsertById(current.taskSummaries, event.taskSummary, (left, right) => right.updatedAtMs - left.updatedAtMs),
          };
        case "taskRemoved":
          return {
            ...current,
            taskSummaries: current.taskSummaries.filter((task) => task.id !== event.taskId),
          };
        case "repoAdded":
        case "repoUpdated":
          return {
            ...current,
            repos: upsertById(current.repos, event.repo, (left, right) => right.latestActivityMs - left.latestActivityMs),
          };
        case "repoRemoved":
          return {
            ...current,
            repos: current.repos.filter((repo) => repo.id !== event.repoId),
          };
        case "pullRequestUpdated":
          return {
            ...current,
            openPullRequests: upsertByPrId(current.openPullRequests, event.pullRequest, (left, right) => right.updatedAtMs - left.updatedAtMs),
          };
        case "pullRequestRemoved":
          return {
            ...current,
            openPullRequests: current.openPullRequests.filter((pullRequest) => pullRequest.prId !== event.prId),
          };
      }
    },
  } satisfies TopicDefinition<WorkspaceSummarySnapshot, WorkspaceTopicParams, WorkspaceEvent>,

  task: {
    key: (params: TaskTopicParams) => `task:${params.workspaceId}:${params.taskId}`,
    event: "taskUpdated",
    connect: (backend: BackendClient, params: TaskTopicParams) => backend.connectTask(params.workspaceId, params.repoId, params.taskId),
    fetchInitial: (backend: BackendClient, params: TaskTopicParams) => backend.getTaskDetail(params.workspaceId, params.repoId, params.taskId),
    applyEvent: (_current: WorkbenchTaskDetail, event: TaskEvent) => event.detail,
  } satisfies TopicDefinition<WorkbenchTaskDetail, TaskTopicParams, TaskEvent>,

  session: {
    key: (params: SessionTopicParams) => `session:${params.workspaceId}:${params.taskId}:${params.sessionId}`,
    event: "sessionUpdated",
    connect: (backend: BackendClient, params: SessionTopicParams) => backend.connectTask(params.workspaceId, params.repoId, params.taskId),
    fetchInitial: (backend: BackendClient, params: SessionTopicParams) =>
      backend.getSessionDetail(params.workspaceId, params.repoId, params.taskId, params.sessionId),
    applyEvent: (current: WorkbenchSessionDetail, event: SessionEvent) => {
      if (event.session.sessionId !== current.sessionId) {
        return current;
      }
      return event.session;
    },
  } satisfies TopicDefinition<WorkbenchSessionDetail, SessionTopicParams, SessionEvent>,

  sandboxProcesses: {
    key: (params: SandboxProcessesTopicParams) => `sandbox:${params.workspaceId}:${params.providerId}:${params.sandboxId}`,
    event: "processesUpdated",
    connect: (backend: BackendClient, params: SandboxProcessesTopicParams) => backend.connectSandbox(params.workspaceId, params.providerId, params.sandboxId),
    fetchInitial: async (backend: BackendClient, params: SandboxProcessesTopicParams) =>
      (await backend.listSandboxProcesses(params.workspaceId, params.providerId, params.sandboxId)).processes,
    applyEvent: (_current: SandboxProcessRecord[], event: SandboxProcessesEvent) => event.processes,
  } satisfies TopicDefinition<SandboxProcessRecord[], SandboxProcessesTopicParams, SandboxProcessesEvent>,
} as const;

export type TopicKey = keyof typeof topicDefinitions;
export type TopicParams<K extends TopicKey> = Parameters<(typeof topicDefinitions)[K]["fetchInitial"]>[1];
export type TopicData<K extends TopicKey> = Awaited<ReturnType<(typeof topicDefinitions)[K]["fetchInitial"]>>;
