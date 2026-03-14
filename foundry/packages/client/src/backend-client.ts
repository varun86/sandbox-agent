import { createClient } from "rivetkit/client";
import type {
  AgentType,
  AddRepoInput,
  AppConfig,
  FoundryAppSnapshot,
  FoundryBillingPlanId,
  CreateTaskInput,
  AppEvent,
  SessionEvent,
  SandboxProcessesEvent,
  TaskRecord,
  TaskSummary,
  TaskWorkbenchChangeModelInput,
  TaskWorkbenchCreateTaskInput,
  TaskWorkbenchCreateTaskResponse,
  TaskWorkbenchDiffInput,
  TaskWorkbenchRenameInput,
  TaskWorkbenchRenameSessionInput,
  TaskWorkbenchSelectInput,
  TaskWorkbenchSetSessionUnreadInput,
  TaskWorkbenchSendMessageInput,
  TaskWorkbenchSnapshot,
  TaskWorkbenchTabInput,
  TaskWorkbenchUpdateDraftInput,
  TaskEvent,
  WorkbenchTaskDetail,
  WorkbenchTaskSummary,
  WorkbenchSessionDetail,
  WorkspaceEvent,
  WorkspaceSummarySnapshot,
  HistoryEvent,
  HistoryQueryInput,
  ProviderId,
  RepoOverview,
  RepoStackActionInput,
  RepoStackActionResult,
  RepoRecord,
  StarSandboxAgentRepoInput,
  StarSandboxAgentRepoResult,
  SwitchResult,
  UpdateFoundryOrganizationProfileInput,
} from "@sandbox-agent/foundry-shared";
import type { ProcessCreateRequest, ProcessInfo, ProcessLogFollowQuery, ProcessLogsResponse, ProcessSignalQuery } from "sandbox-agent";
import { createMockBackendClient } from "./mock/backend-client.js";
import { taskKey, taskSandboxKey, workspaceKey } from "./keys.js";

export type TaskAction = "push" | "sync" | "merge" | "archive" | "kill";

export interface SandboxSessionRecord {
  id: string;
  agent: string;
  agentSessionId: string;
  lastConnectionId: string;
  createdAt: number;
  destroyedAt?: number;
  status?: "pending_provision" | "pending_session_create" | "ready" | "running" | "idle" | "error";
}

export interface SandboxSessionEventRecord {
  id: string;
  eventIndex: number;
  sessionId: string;
  createdAt: number;
  connectionId: string;
  sender: "client" | "agent";
  payload: unknown;
}

export type SandboxProcessRecord = ProcessInfo;

export interface ActorConn {
  on(event: string, listener: (payload: any) => void): () => void;
  onError(listener: (error: unknown) => void): () => void;
  dispose(): Promise<void>;
}

interface WorkspaceHandle {
  connect(): ActorConn;
  addRepo(input: AddRepoInput): Promise<RepoRecord>;
  listRepos(input: { workspaceId: string }): Promise<RepoRecord[]>;
  createTask(input: CreateTaskInput): Promise<TaskRecord>;
  listTasks(input: { workspaceId: string; repoId?: string }): Promise<TaskSummary[]>;
  getRepoOverview(input: { workspaceId: string; repoId: string }): Promise<RepoOverview>;
  runRepoStackAction(input: RepoStackActionInput): Promise<RepoStackActionResult>;
  history(input: HistoryQueryInput): Promise<HistoryEvent[]>;
  switchTask(taskId: string): Promise<SwitchResult>;
  getTask(input: { workspaceId: string; taskId: string }): Promise<TaskRecord>;
  attachTask(input: { workspaceId: string; taskId: string; reason?: string }): Promise<{ target: string; sessionId: string | null }>;
  pushTask(input: { workspaceId: string; taskId: string; reason?: string }): Promise<void>;
  syncTask(input: { workspaceId: string; taskId: string; reason?: string }): Promise<void>;
  mergeTask(input: { workspaceId: string; taskId: string; reason?: string }): Promise<void>;
  archiveTask(input: { workspaceId: string; taskId: string; reason?: string }): Promise<void>;
  killTask(input: { workspaceId: string; taskId: string; reason?: string }): Promise<void>;
  useWorkspace(input: { workspaceId: string }): Promise<{ workspaceId: string }>;
  starSandboxAgentRepo(input: StarSandboxAgentRepoInput): Promise<StarSandboxAgentRepoResult>;
  getWorkspaceSummary(input: { workspaceId: string }): Promise<WorkspaceSummarySnapshot>;
  applyTaskSummaryUpdate(input: { taskSummary: WorkbenchTaskSummary }): Promise<void>;
  removeTaskSummary(input: { taskId: string }): Promise<void>;
  reconcileWorkbenchState(input: { workspaceId: string }): Promise<WorkspaceSummarySnapshot>;
  createWorkbenchTask(input: TaskWorkbenchCreateTaskInput): Promise<TaskWorkbenchCreateTaskResponse>;
  markWorkbenchUnread(input: TaskWorkbenchSelectInput): Promise<void>;
  renameWorkbenchTask(input: TaskWorkbenchRenameInput): Promise<void>;
  renameWorkbenchBranch(input: TaskWorkbenchRenameInput): Promise<void>;
  createWorkbenchSession(input: TaskWorkbenchSelectInput & { model?: string }): Promise<{ tabId: string }>;
  renameWorkbenchSession(input: TaskWorkbenchRenameSessionInput): Promise<void>;
  setWorkbenchSessionUnread(input: TaskWorkbenchSetSessionUnreadInput): Promise<void>;
  updateWorkbenchDraft(input: TaskWorkbenchUpdateDraftInput): Promise<void>;
  changeWorkbenchModel(input: TaskWorkbenchChangeModelInput): Promise<void>;
  sendWorkbenchMessage(input: TaskWorkbenchSendMessageInput): Promise<void>;
  stopWorkbenchSession(input: TaskWorkbenchTabInput): Promise<void>;
  closeWorkbenchSession(input: TaskWorkbenchTabInput): Promise<void>;
  publishWorkbenchPr(input: TaskWorkbenchSelectInput): Promise<void>;
  revertWorkbenchFile(input: TaskWorkbenchDiffInput): Promise<void>;
  reloadGithubOrganization(): Promise<void>;
  reloadGithubPullRequests(): Promise<void>;
  reloadGithubRepository(input: { repoId: string }): Promise<void>;
  reloadGithubPullRequest(input: { repoId: string; prNumber: number }): Promise<void>;
}

interface AppWorkspaceHandle {
  connect(): ActorConn;
  getAppSnapshot(input: { sessionId: string }): Promise<FoundryAppSnapshot>;
  skipAppStarterRepo(input: { sessionId: string }): Promise<FoundryAppSnapshot>;
  starAppStarterRepo(input: { sessionId: string; organizationId: string }): Promise<FoundryAppSnapshot>;
  selectAppOrganization(input: { sessionId: string; organizationId: string }): Promise<FoundryAppSnapshot>;
  updateAppOrganizationProfile(input: UpdateFoundryOrganizationProfileInput & { sessionId: string }): Promise<FoundryAppSnapshot>;
  triggerAppRepoImport(input: { sessionId: string; organizationId: string }): Promise<FoundryAppSnapshot>;
  beginAppGithubInstall(input: { sessionId: string; organizationId: string }): Promise<{ url: string }>;
  createAppCheckoutSession(input: { sessionId: string; organizationId: string; planId: FoundryBillingPlanId }): Promise<{ url: string }>;
  createAppBillingPortalSession(input: { sessionId: string; organizationId: string }): Promise<{ url: string }>;
  cancelAppScheduledRenewal(input: { sessionId: string; organizationId: string }): Promise<FoundryAppSnapshot>;
  resumeAppSubscription(input: { sessionId: string; organizationId: string }): Promise<FoundryAppSnapshot>;
  recordAppSeatUsage(input: { sessionId: string; workspaceId: string }): Promise<FoundryAppSnapshot>;
}

interface TaskHandle {
  getTaskSummary(): Promise<WorkbenchTaskSummary>;
  getTaskDetail(): Promise<WorkbenchTaskDetail>;
  getSessionDetail(input: { sessionId: string }): Promise<WorkbenchSessionDetail>;
  connect(): ActorConn;
}

interface TaskSandboxHandle {
  connect(): ActorConn;
  createSession(input: {
    id?: string;
    agent: string;
    model?: string;
    sessionInit?: {
      cwd?: string;
    };
  }): Promise<{ id: string }>;
  listSessions(input?: { cursor?: string; limit?: number }): Promise<{ items: SandboxSessionRecord[]; nextCursor?: string }>;
  getEvents(input: { sessionId: string; cursor?: string; limit?: number }): Promise<{ items: SandboxSessionEventRecord[]; nextCursor?: string }>;
  createProcess(input: ProcessCreateRequest): Promise<SandboxProcessRecord>;
  listProcesses(): Promise<{ processes: SandboxProcessRecord[] }>;
  getProcessLogs(processId: string, query?: ProcessLogFollowQuery): Promise<ProcessLogsResponse>;
  stopProcess(processId: string, query?: ProcessSignalQuery): Promise<SandboxProcessRecord>;
  killProcess(processId: string, query?: ProcessSignalQuery): Promise<SandboxProcessRecord>;
  deleteProcess(processId: string): Promise<void>;
  rawSendSessionMethod(sessionId: string, method: string, params: Record<string, unknown>): Promise<unknown>;
  destroySession(sessionId: string): Promise<void>;
  sandboxAgentConnection(): Promise<{ endpoint: string; token?: string }>;
  providerState(): Promise<{ providerId: ProviderId; sandboxId: string; state: string; at: number }>;
}

interface RivetClient {
  workspace: {
    getOrCreate(key?: string | string[], opts?: { createWithInput?: unknown }): WorkspaceHandle;
  };
  task: {
    get(key?: string | string[]): TaskHandle;
    getOrCreate(key?: string | string[], opts?: { createWithInput?: unknown }): TaskHandle;
  };
  taskSandbox: {
    get(key?: string | string[]): TaskSandboxHandle;
    getOrCreate(key?: string | string[], opts?: { createWithInput?: unknown }): TaskSandboxHandle;
    getForId(actorId: string): TaskSandboxHandle;
  };
}

export interface BackendClientOptions {
  endpoint: string;
  defaultWorkspaceId?: string;
  mode?: "remote" | "mock";
}

export interface BackendClient {
  getAppSnapshot(): Promise<FoundryAppSnapshot>;
  connectWorkspace(workspaceId: string): Promise<ActorConn>;
  connectTask(workspaceId: string, repoId: string, taskId: string): Promise<ActorConn>;
  connectSandbox(workspaceId: string, providerId: ProviderId, sandboxId: string): Promise<ActorConn>;
  subscribeApp(listener: () => void): () => void;
  signInWithGithub(): Promise<void>;
  signOutApp(): Promise<FoundryAppSnapshot>;
  skipAppStarterRepo(): Promise<FoundryAppSnapshot>;
  starAppStarterRepo(organizationId: string): Promise<FoundryAppSnapshot>;
  selectAppOrganization(organizationId: string): Promise<FoundryAppSnapshot>;
  updateAppOrganizationProfile(input: UpdateFoundryOrganizationProfileInput): Promise<FoundryAppSnapshot>;
  triggerAppRepoImport(organizationId: string): Promise<FoundryAppSnapshot>;
  reconnectAppGithub(organizationId: string): Promise<void>;
  completeAppHostedCheckout(organizationId: string, planId: FoundryBillingPlanId): Promise<void>;
  openAppBillingPortal(organizationId: string): Promise<void>;
  cancelAppScheduledRenewal(organizationId: string): Promise<FoundryAppSnapshot>;
  resumeAppSubscription(organizationId: string): Promise<FoundryAppSnapshot>;
  recordAppSeatUsage(workspaceId: string): Promise<FoundryAppSnapshot>;
  addRepo(workspaceId: string, remoteUrl: string): Promise<RepoRecord>;
  listRepos(workspaceId: string): Promise<RepoRecord[]>;
  createTask(input: CreateTaskInput): Promise<TaskRecord>;
  listTasks(workspaceId: string, repoId?: string): Promise<TaskSummary[]>;
  getRepoOverview(workspaceId: string, repoId: string): Promise<RepoOverview>;
  runRepoStackAction(input: RepoStackActionInput): Promise<RepoStackActionResult>;
  getTask(workspaceId: string, taskId: string): Promise<TaskRecord>;
  listHistory(input: HistoryQueryInput): Promise<HistoryEvent[]>;
  switchTask(workspaceId: string, taskId: string): Promise<SwitchResult>;
  attachTask(workspaceId: string, taskId: string): Promise<{ target: string; sessionId: string | null }>;
  runAction(workspaceId: string, taskId: string, action: TaskAction): Promise<void>;
  createSandboxSession(input: {
    workspaceId: string;
    providerId: ProviderId;
    sandboxId: string;
    prompt: string;
    cwd?: string;
    agent?: AgentType | "opencode";
  }): Promise<{ id: string; status: "running" | "idle" | "error" }>;
  listSandboxSessions(
    workspaceId: string,
    providerId: ProviderId,
    sandboxId: string,
    input?: { cursor?: string; limit?: number },
  ): Promise<{ items: SandboxSessionRecord[]; nextCursor?: string }>;
  listSandboxSessionEvents(
    workspaceId: string,
    providerId: ProviderId,
    sandboxId: string,
    input: { sessionId: string; cursor?: string; limit?: number },
  ): Promise<{ items: SandboxSessionEventRecord[]; nextCursor?: string }>;
  createSandboxProcess(input: { workspaceId: string; providerId: ProviderId; sandboxId: string; request: ProcessCreateRequest }): Promise<SandboxProcessRecord>;
  listSandboxProcesses(workspaceId: string, providerId: ProviderId, sandboxId: string): Promise<{ processes: SandboxProcessRecord[] }>;
  getSandboxProcessLogs(
    workspaceId: string,
    providerId: ProviderId,
    sandboxId: string,
    processId: string,
    query?: ProcessLogFollowQuery,
  ): Promise<ProcessLogsResponse>;
  stopSandboxProcess(
    workspaceId: string,
    providerId: ProviderId,
    sandboxId: string,
    processId: string,
    query?: ProcessSignalQuery,
  ): Promise<SandboxProcessRecord>;
  killSandboxProcess(
    workspaceId: string,
    providerId: ProviderId,
    sandboxId: string,
    processId: string,
    query?: ProcessSignalQuery,
  ): Promise<SandboxProcessRecord>;
  deleteSandboxProcess(workspaceId: string, providerId: ProviderId, sandboxId: string, processId: string): Promise<void>;
  subscribeSandboxProcesses(workspaceId: string, providerId: ProviderId, sandboxId: string, listener: () => void): () => void;
  sendSandboxPrompt(input: {
    workspaceId: string;
    providerId: ProviderId;
    sandboxId: string;
    sessionId: string;
    prompt: string;
    notification?: boolean;
  }): Promise<void>;
  sandboxSessionStatus(
    workspaceId: string,
    providerId: ProviderId,
    sandboxId: string,
    sessionId: string,
  ): Promise<{ id: string; status: "running" | "idle" | "error" }>;
  sandboxProviderState(
    workspaceId: string,
    providerId: ProviderId,
    sandboxId: string,
  ): Promise<{ providerId: ProviderId; sandboxId: string; state: string; at: number }>;
  getSandboxAgentConnection(workspaceId: string, providerId: ProviderId, sandboxId: string): Promise<{ endpoint: string; token?: string }>;
  getWorkspaceSummary(workspaceId: string): Promise<WorkspaceSummarySnapshot>;
  getTaskDetail(workspaceId: string, repoId: string, taskId: string): Promise<WorkbenchTaskDetail>;
  getSessionDetail(workspaceId: string, repoId: string, taskId: string, sessionId: string): Promise<WorkbenchSessionDetail>;
  getWorkbench(workspaceId: string): Promise<TaskWorkbenchSnapshot>;
  subscribeWorkbench(workspaceId: string, listener: () => void): () => void;
  createWorkbenchTask(workspaceId: string, input: TaskWorkbenchCreateTaskInput): Promise<TaskWorkbenchCreateTaskResponse>;
  markWorkbenchUnread(workspaceId: string, input: TaskWorkbenchSelectInput): Promise<void>;
  renameWorkbenchTask(workspaceId: string, input: TaskWorkbenchRenameInput): Promise<void>;
  renameWorkbenchBranch(workspaceId: string, input: TaskWorkbenchRenameInput): Promise<void>;
  createWorkbenchSession(workspaceId: string, input: TaskWorkbenchSelectInput & { model?: string }): Promise<{ tabId: string }>;
  renameWorkbenchSession(workspaceId: string, input: TaskWorkbenchRenameSessionInput): Promise<void>;
  setWorkbenchSessionUnread(workspaceId: string, input: TaskWorkbenchSetSessionUnreadInput): Promise<void>;
  updateWorkbenchDraft(workspaceId: string, input: TaskWorkbenchUpdateDraftInput): Promise<void>;
  changeWorkbenchModel(workspaceId: string, input: TaskWorkbenchChangeModelInput): Promise<void>;
  sendWorkbenchMessage(workspaceId: string, input: TaskWorkbenchSendMessageInput): Promise<void>;
  stopWorkbenchSession(workspaceId: string, input: TaskWorkbenchTabInput): Promise<void>;
  closeWorkbenchSession(workspaceId: string, input: TaskWorkbenchTabInput): Promise<void>;
  publishWorkbenchPr(workspaceId: string, input: TaskWorkbenchSelectInput): Promise<void>;
  revertWorkbenchFile(workspaceId: string, input: TaskWorkbenchDiffInput): Promise<void>;
  reloadGithubOrganization(workspaceId: string): Promise<void>;
  reloadGithubPullRequests(workspaceId: string): Promise<void>;
  reloadGithubRepository(workspaceId: string, repoId: string): Promise<void>;
  reloadGithubPullRequest(workspaceId: string, repoId: string, prNumber: number): Promise<void>;
  health(): Promise<{ ok: true }>;
  useWorkspace(workspaceId: string): Promise<{ workspaceId: string }>;
  starSandboxAgentRepo(workspaceId: string): Promise<StarSandboxAgentRepoResult>;
}

export function rivetEndpoint(config: AppConfig): string {
  return `http://${config.backend.host}:${config.backend.port}/v1/rivet`;
}

export function createBackendClientFromConfig(config: AppConfig): BackendClient {
  return createBackendClient({
    endpoint: rivetEndpoint(config),
    defaultWorkspaceId: config.workspace.default,
  });
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function normalizeLegacyBackendEndpoint(endpoint: string): string {
  const normalized = stripTrailingSlash(endpoint);
  if (normalized.endsWith("/api/rivet")) {
    return `${normalized.slice(0, -"/api/rivet".length)}/v1/rivet`;
  }
  return normalized;
}

function deriveBackendEndpoints(endpoint: string): { appEndpoint: string; rivetEndpoint: string } {
  const normalized = normalizeLegacyBackendEndpoint(endpoint);
  if (normalized.endsWith("/rivet")) {
    return {
      appEndpoint: normalized.slice(0, -"/rivet".length),
      rivetEndpoint: normalized,
    };
  }
  return {
    appEndpoint: normalized,
    rivetEndpoint: `${normalized}/rivet`,
  };
}

function signedOutAppSnapshot(): FoundryAppSnapshot {
  return {
    auth: { status: "signed_out", currentUserId: null },
    activeOrganizationId: null,
    onboarding: {
      starterRepo: {
        repoFullName: "rivet-dev/sandbox-agent",
        repoUrl: "https://github.com/rivet-dev/sandbox-agent",
        status: "pending",
        starredAt: null,
        skippedAt: null,
      },
    },
    users: [],
    organizations: [],
  };
}

export function createBackendClient(options: BackendClientOptions): BackendClient {
  if (options.mode === "mock") {
    return createMockBackendClient(options.defaultWorkspaceId);
  }

  const endpoints = deriveBackendEndpoints(options.endpoint);
  const rivetApiEndpoint = endpoints.rivetEndpoint;
  const appApiEndpoint = endpoints.appEndpoint;
  const client = createClient({ endpoint: rivetApiEndpoint }) as unknown as RivetClient;
  const workbenchSubscriptions = new Map<
    string,
    {
      listeners: Set<() => void>;
      disposeConnPromise: Promise<(() => Promise<void>) | null> | null;
    }
  >();
  const sandboxProcessSubscriptions = new Map<
    string,
    {
      listeners: Set<() => void>;
      disposeConnPromise: Promise<(() => Promise<void>) | null> | null;
    }
  >();
  const appSubscriptions = {
    listeners: new Set<() => void>(),
    disposeConnPromise: null as Promise<(() => Promise<void>) | null> | null,
  };

  const appRequest = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const headers = new Headers(init?.headers);
    if (init?.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const res = await fetch(`${appApiEndpoint}${path}`, {
      ...init,
      headers,
      credentials: "include",
    });
    if (!res.ok) {
      throw new Error(`app request failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
  };

  const getSessionId = async (): Promise<string | null> => {
    const res = await fetch(`${appApiEndpoint}/auth/get-session`, {
      credentials: "include",
    });
    if (res.status === 401) {
      return null;
    }
    if (!res.ok) {
      throw new Error(`auth session request failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json().catch(() => null)) as { session?: { id?: string | null } | null } | null;
    const sessionId = data?.session?.id;
    return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
  };

  const workspace = async (workspaceId: string): Promise<WorkspaceHandle> =>
    client.workspace.getOrCreate(workspaceKey(workspaceId), {
      createWithInput: workspaceId,
    });

  const appWorkspace = async (): Promise<AppWorkspaceHandle> =>
    client.workspace.getOrCreate(workspaceKey("app"), {
      createWithInput: "app",
    }) as unknown as AppWorkspaceHandle;

  const task = async (workspaceId: string, repoId: string, taskId: string): Promise<TaskHandle> => client.task.get(taskKey(workspaceId, repoId, taskId));

  const sandboxByKey = async (workspaceId: string, _providerId: ProviderId, sandboxId: string): Promise<TaskSandboxHandle> => {
    return (client as any).taskSandbox.get(taskSandboxKey(workspaceId, sandboxId));
  };

  function isActorNotFoundError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("Actor not found");
  }

  const sandboxByActorIdFromTask = async (workspaceId: string, providerId: ProviderId, sandboxId: string): Promise<TaskSandboxHandle | null> => {
    const ws = await workspace(workspaceId);
    const rows = await ws.listTasks({ workspaceId });
    const candidates = [...rows].sort((a, b) => b.updatedAt - a.updatedAt);

    for (const row of candidates) {
      try {
        const detail = await ws.getTask({ workspaceId, taskId: row.taskId });
        if (detail.providerId !== providerId) {
          continue;
        }
        const sandbox = detail.sandboxes.find(
          (sb) =>
            sb.sandboxId === sandboxId &&
            sb.providerId === providerId &&
            typeof (sb as any).sandboxActorId === "string" &&
            (sb as any).sandboxActorId.length > 0,
        ) as { sandboxActorId?: string } | undefined;
        if (sandbox?.sandboxActorId) {
          return (client as any).taskSandbox.getForId(sandbox.sandboxActorId);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!isActorNotFoundError(error) && !message.includes("Unknown task")) {
          throw error;
        }
        // Best effort fallback path; ignore missing task actors here.
      }
    }

    return null;
  };

  const withSandboxHandle = async <T>(
    workspaceId: string,
    providerId: ProviderId,
    sandboxId: string,
    run: (handle: TaskSandboxHandle) => Promise<T>,
  ): Promise<T> => {
    const handle = await sandboxByKey(workspaceId, providerId, sandboxId);
    try {
      return await run(handle);
    } catch (error) {
      if (!isActorNotFoundError(error)) {
        throw error;
      }
      const fallback = await sandboxByActorIdFromTask(workspaceId, providerId, sandboxId);
      if (!fallback) {
        throw error;
      }
      return await run(fallback);
    }
  };

  const connectWorkspace = async (workspaceId: string): Promise<ActorConn> => {
    return (await workspace(workspaceId)).connect() as ActorConn;
  };

  const connectTask = async (workspaceId: string, repoId: string, taskIdValue: string): Promise<ActorConn> => {
    return (await task(workspaceId, repoId, taskIdValue)).connect() as ActorConn;
  };

  const connectSandbox = async (workspaceId: string, providerId: ProviderId, sandboxId: string): Promise<ActorConn> => {
    try {
      return (await sandboxByKey(workspaceId, providerId, sandboxId)).connect() as ActorConn;
    } catch (error) {
      if (!isActorNotFoundError(error)) {
        throw error;
      }
      const fallback = await sandboxByActorIdFromTask(workspaceId, providerId, sandboxId);
      if (!fallback) {
        throw error;
      }
      return fallback.connect() as ActorConn;
    }
  };

  const getWorkbenchCompat = async (workspaceId: string): Promise<TaskWorkbenchSnapshot> => {
    const summary = await (await workspace(workspaceId)).getWorkspaceSummary({ workspaceId });
    const tasks = (
      await Promise.all(
        summary.taskSummaries.map(async (taskSummary) => {
          let detail;
          try {
            detail = await (await task(workspaceId, taskSummary.repoId, taskSummary.id)).getTaskDetail();
          } catch (error) {
            if (isActorNotFoundError(error)) {
              return null;
            }
            throw error;
          }
          const sessionDetails = await Promise.all(
            detail.sessionsSummary.map(async (session) => {
              try {
                const full = await (await task(workspaceId, detail.repoId, detail.id)).getSessionDetail({ sessionId: session.id });
                return [session.id, full] as const;
              } catch (error) {
                if (isActorNotFoundError(error)) {
                  return null;
                }
                throw error;
              }
            }),
          );
          const sessionDetailsById = new Map(sessionDetails.filter((entry): entry is readonly [string, WorkbenchSessionDetail] => entry !== null));
          return {
            id: detail.id,
            repoId: detail.repoId,
            title: detail.title,
            status: detail.status,
            repoName: detail.repoName,
            updatedAtMs: detail.updatedAtMs,
            branch: detail.branch,
            pullRequest: detail.pullRequest,
            tabs: detail.sessionsSummary.map((session) => {
              const full = sessionDetailsById.get(session.id);
              return {
                id: session.id,
                sessionId: session.sessionId,
                sessionName: session.sessionName,
                agent: session.agent,
                model: session.model,
                status: session.status,
                thinkingSinceMs: session.thinkingSinceMs,
                unread: session.unread,
                created: session.created,
                draft: full?.draft ?? { text: "", attachments: [], updatedAtMs: null },
                transcript: full?.transcript ?? [],
              };
            }),
            fileChanges: detail.fileChanges,
            diffs: detail.diffs,
            fileTree: detail.fileTree,
            minutesUsed: detail.minutesUsed,
          };
        }),
      )
    ).filter((task): task is TaskWorkbenchSnapshot["tasks"][number] => task !== null);

    const projects = summary.repos
      .map((repo) => ({
        id: repo.id,
        label: repo.label,
        updatedAtMs: tasks.filter((task) => task.repoId === repo.id).reduce((latest, task) => Math.max(latest, task.updatedAtMs), repo.latestActivityMs),
        tasks: tasks.filter((task) => task.repoId === repo.id).sort((left, right) => right.updatedAtMs - left.updatedAtMs),
      }))
      .filter((repo) => repo.tasks.length > 0);

    return {
      workspaceId,
      repos: summary.repos.map((repo) => ({ id: repo.id, label: repo.label })),
      projects,
      tasks: tasks.sort((left, right) => right.updatedAtMs - left.updatedAtMs),
    };
  };

  const subscribeWorkbench = (workspaceId: string, listener: () => void): (() => void) => {
    let entry = workbenchSubscriptions.get(workspaceId);
    if (!entry) {
      entry = {
        listeners: new Set(),
        disposeConnPromise: null,
      };
      workbenchSubscriptions.set(workspaceId, entry);
    }

    entry.listeners.add(listener);

    if (!entry.disposeConnPromise) {
      entry.disposeConnPromise = (async () => {
        const handle = await workspace(workspaceId);
        const conn = (handle as any).connect();
        const unsubscribeEvent = conn.on("workbenchUpdated", () => {
          const current = workbenchSubscriptions.get(workspaceId);
          if (!current) {
            return;
          }
          for (const currentListener of [...current.listeners]) {
            currentListener();
          }
        });
        const unsubscribeError = conn.onError(() => {});
        return async () => {
          unsubscribeEvent();
          unsubscribeError();
          await conn.dispose();
        };
      })().catch(() => null);
    }

    return () => {
      const current = workbenchSubscriptions.get(workspaceId);
      if (!current) {
        return;
      }
      current.listeners.delete(listener);
      if (current.listeners.size > 0) {
        return;
      }

      workbenchSubscriptions.delete(workspaceId);
      void current.disposeConnPromise?.then(async (disposeConn) => {
        await disposeConn?.();
      });
    };
  };

  const sandboxProcessSubscriptionKey = (workspaceId: string, providerId: ProviderId, sandboxId: string): string => `${workspaceId}:${providerId}:${sandboxId}`;

  const subscribeSandboxProcesses = (workspaceId: string, providerId: ProviderId, sandboxId: string, listener: () => void): (() => void) => {
    const key = sandboxProcessSubscriptionKey(workspaceId, providerId, sandboxId);
    let entry = sandboxProcessSubscriptions.get(key);
    if (!entry) {
      entry = {
        listeners: new Set(),
        disposeConnPromise: null,
      };
      sandboxProcessSubscriptions.set(key, entry);
    }

    entry.listeners.add(listener);

    if (!entry.disposeConnPromise) {
      entry.disposeConnPromise = (async () => {
        const conn = await connectSandbox(workspaceId, providerId, sandboxId);
        const unsubscribeEvent = conn.on("processesUpdated", () => {
          const current = sandboxProcessSubscriptions.get(key);
          if (!current) {
            return;
          }
          for (const currentListener of [...current.listeners]) {
            currentListener();
          }
        });
        const unsubscribeError = conn.onError(() => {});
        return async () => {
          unsubscribeEvent();
          unsubscribeError();
          await conn.dispose();
        };
      })().catch(() => null);
    }

    return () => {
      const current = sandboxProcessSubscriptions.get(key);
      if (!current) {
        return;
      }
      current.listeners.delete(listener);
      if (current.listeners.size > 0) {
        return;
      }

      sandboxProcessSubscriptions.delete(key);
      void current.disposeConnPromise?.then(async (disposeConn) => {
        await disposeConn?.();
      });
    };
  };

  const subscribeApp = (listener: () => void): (() => void) => {
    appSubscriptions.listeners.add(listener);

    if (!appSubscriptions.disposeConnPromise) {
      appSubscriptions.disposeConnPromise = (async () => {
        const handle = await appWorkspace();
        const conn = (handle as any).connect();
        const unsubscribeEvent = conn.on("appUpdated", () => {
          for (const currentListener of [...appSubscriptions.listeners]) {
            currentListener();
          }
        });
        const unsubscribeError = conn.onError(() => {});
        return async () => {
          unsubscribeEvent();
          unsubscribeError();
          await conn.dispose();
        };
      })().catch(() => null);
    }

    return () => {
      appSubscriptions.listeners.delete(listener);
      if (appSubscriptions.listeners.size > 0) {
        return;
      }

      void appSubscriptions.disposeConnPromise?.then(async (disposeConn) => {
        await disposeConn?.();
      });
      appSubscriptions.disposeConnPromise = null;
    };
  };

  return {
    async getAppSnapshot(): Promise<FoundryAppSnapshot> {
      const sessionId = await getSessionId();
      if (!sessionId) {
        return signedOutAppSnapshot();
      }
      return await (await appWorkspace()).getAppSnapshot({ sessionId });
    },

    async connectWorkspace(workspaceId: string): Promise<ActorConn> {
      return await connectWorkspace(workspaceId);
    },

    async connectTask(workspaceId: string, repoId: string, taskIdValue: string): Promise<ActorConn> {
      return await connectTask(workspaceId, repoId, taskIdValue);
    },

    async connectSandbox(workspaceId: string, providerId: ProviderId, sandboxId: string): Promise<ActorConn> {
      return await connectSandbox(workspaceId, providerId, sandboxId);
    },

    subscribeApp(listener: () => void): () => void {
      return subscribeApp(listener);
    },

    async signInWithGithub(): Promise<void> {
      const callbackURL = typeof window !== "undefined" ? `${window.location.origin}/organizations` : `${appApiEndpoint.replace(/\/$/, "")}/organizations`;
      const response = await appRequest<{ url: string; redirect?: boolean }>("/auth/sign-in/social", {
        method: "POST",
        body: JSON.stringify({
          provider: "github",
          callbackURL,
          disableRedirect: true,
        }),
      });
      if (typeof window !== "undefined") {
        window.location.assign(response.url);
      }
    },

    async signOutApp(): Promise<FoundryAppSnapshot> {
      return await appRequest<FoundryAppSnapshot>("/app/sign-out", { method: "POST" });
    },

    async skipAppStarterRepo(): Promise<FoundryAppSnapshot> {
      const sessionId = await getSessionId();
      if (!sessionId) {
        throw new Error("No active auth session");
      }
      return await (await appWorkspace()).skipAppStarterRepo({ sessionId });
    },

    async starAppStarterRepo(organizationId: string): Promise<FoundryAppSnapshot> {
      const sessionId = await getSessionId();
      if (!sessionId) {
        throw new Error("No active auth session");
      }
      return await (await appWorkspace()).starAppStarterRepo({ sessionId, organizationId });
    },

    async selectAppOrganization(organizationId: string): Promise<FoundryAppSnapshot> {
      const sessionId = await getSessionId();
      if (!sessionId) {
        throw new Error("No active auth session");
      }
      return await (await appWorkspace()).selectAppOrganization({ sessionId, organizationId });
    },

    async updateAppOrganizationProfile(input: UpdateFoundryOrganizationProfileInput): Promise<FoundryAppSnapshot> {
      const sessionId = await getSessionId();
      if (!sessionId) {
        throw new Error("No active auth session");
      }
      return await (await appWorkspace()).updateAppOrganizationProfile({
        sessionId,
        organizationId: input.organizationId,
        displayName: input.displayName,
        slug: input.slug,
        primaryDomain: input.primaryDomain,
      });
    },

    async triggerAppRepoImport(organizationId: string): Promise<FoundryAppSnapshot> {
      const sessionId = await getSessionId();
      if (!sessionId) {
        throw new Error("No active auth session");
      }
      return await (await appWorkspace()).triggerAppRepoImport({ sessionId, organizationId });
    },

    async reconnectAppGithub(organizationId: string): Promise<void> {
      const sessionId = await getSessionId();
      if (!sessionId) {
        throw new Error("No active auth session");
      }
      const response = await (await appWorkspace()).beginAppGithubInstall({ sessionId, organizationId });
      if (typeof window !== "undefined") {
        window.location.assign(response.url);
      }
    },

    async completeAppHostedCheckout(organizationId: string, planId: FoundryBillingPlanId): Promise<void> {
      const sessionId = await getSessionId();
      if (!sessionId) {
        throw new Error("No active auth session");
      }
      const response = await (await appWorkspace()).createAppCheckoutSession({ sessionId, organizationId, planId });
      if (typeof window !== "undefined") {
        window.location.assign(response.url);
      }
    },

    async openAppBillingPortal(organizationId: string): Promise<void> {
      const sessionId = await getSessionId();
      if (!sessionId) {
        throw new Error("No active auth session");
      }
      const response = await (await appWorkspace()).createAppBillingPortalSession({ sessionId, organizationId });
      if (typeof window !== "undefined") {
        window.location.assign(response.url);
      }
    },

    async cancelAppScheduledRenewal(organizationId: string): Promise<FoundryAppSnapshot> {
      const sessionId = await getSessionId();
      if (!sessionId) {
        throw new Error("No active auth session");
      }
      return await (await appWorkspace()).cancelAppScheduledRenewal({ sessionId, organizationId });
    },

    async resumeAppSubscription(organizationId: string): Promise<FoundryAppSnapshot> {
      const sessionId = await getSessionId();
      if (!sessionId) {
        throw new Error("No active auth session");
      }
      return await (await appWorkspace()).resumeAppSubscription({ sessionId, organizationId });
    },

    async recordAppSeatUsage(workspaceId: string): Promise<FoundryAppSnapshot> {
      const sessionId = await getSessionId();
      if (!sessionId) {
        throw new Error("No active auth session");
      }
      return await (await appWorkspace()).recordAppSeatUsage({ sessionId, workspaceId });
    },

    async addRepo(workspaceId: string, remoteUrl: string): Promise<RepoRecord> {
      return (await workspace(workspaceId)).addRepo({ workspaceId, remoteUrl });
    },

    async listRepos(workspaceId: string): Promise<RepoRecord[]> {
      return (await workspace(workspaceId)).listRepos({ workspaceId });
    },

    async createTask(input: CreateTaskInput): Promise<TaskRecord> {
      return (await workspace(input.workspaceId)).createTask(input);
    },

    async starSandboxAgentRepo(workspaceId: string): Promise<StarSandboxAgentRepoResult> {
      return (await workspace(workspaceId)).starSandboxAgentRepo({ workspaceId });
    },

    async listTasks(workspaceId: string, repoId?: string): Promise<TaskSummary[]> {
      return (await workspace(workspaceId)).listTasks({ workspaceId, repoId });
    },

    async getRepoOverview(workspaceId: string, repoId: string): Promise<RepoOverview> {
      return (await workspace(workspaceId)).getRepoOverview({ workspaceId, repoId });
    },

    async runRepoStackAction(input: RepoStackActionInput): Promise<RepoStackActionResult> {
      return (await workspace(input.workspaceId)).runRepoStackAction(input);
    },

    async getTask(workspaceId: string, taskId: string): Promise<TaskRecord> {
      return (await workspace(workspaceId)).getTask({
        workspaceId,
        taskId,
      });
    },

    async listHistory(input: HistoryQueryInput): Promise<HistoryEvent[]> {
      return (await workspace(input.workspaceId)).history(input);
    },

    async switchTask(workspaceId: string, taskId: string): Promise<SwitchResult> {
      return (await workspace(workspaceId)).switchTask(taskId);
    },

    async attachTask(workspaceId: string, taskId: string): Promise<{ target: string; sessionId: string | null }> {
      return (await workspace(workspaceId)).attachTask({
        workspaceId,
        taskId,
        reason: "cli.attach",
      });
    },

    async runAction(workspaceId: string, taskId: string, action: TaskAction): Promise<void> {
      if (action === "push") {
        await (await workspace(workspaceId)).pushTask({
          workspaceId,
          taskId,
          reason: "cli.push",
        });
        return;
      }
      if (action === "sync") {
        await (await workspace(workspaceId)).syncTask({
          workspaceId,
          taskId,
          reason: "cli.sync",
        });
        return;
      }
      if (action === "merge") {
        await (await workspace(workspaceId)).mergeTask({
          workspaceId,
          taskId,
          reason: "cli.merge",
        });
        return;
      }
      if (action === "archive") {
        await (await workspace(workspaceId)).archiveTask({
          workspaceId,
          taskId,
          reason: "cli.archive",
        });
        return;
      }
      await (await workspace(workspaceId)).killTask({
        workspaceId,
        taskId,
        reason: "cli.kill",
      });
    },

    async createSandboxSession(input: {
      workspaceId: string;
      providerId: ProviderId;
      sandboxId: string;
      prompt: string;
      cwd?: string;
      agent?: AgentType | "opencode";
    }): Promise<{ id: string; status: "running" | "idle" | "error" }> {
      const created = await withSandboxHandle(input.workspaceId, input.providerId, input.sandboxId, async (handle) =>
        handle.createSession({
          agent: input.agent ?? "claude",
          sessionInit: {
            cwd: input.cwd,
          },
        }),
      );
      if (input.prompt.trim().length > 0) {
        await withSandboxHandle(input.workspaceId, input.providerId, input.sandboxId, async (handle) =>
          handle.rawSendSessionMethod(created.id, "session/prompt", {
            prompt: [{ type: "text", text: input.prompt }],
          }),
        );
      }
      return {
        id: created.id,
        status: "idle",
      };
    },

    async listSandboxSessions(
      workspaceId: string,
      providerId: ProviderId,
      sandboxId: string,
      input?: { cursor?: string; limit?: number },
    ): Promise<{ items: SandboxSessionRecord[]; nextCursor?: string }> {
      return await withSandboxHandle(workspaceId, providerId, sandboxId, async (handle) => handle.listSessions(input ?? {}));
    },

    async listSandboxSessionEvents(
      workspaceId: string,
      providerId: ProviderId,
      sandboxId: string,
      input: { sessionId: string; cursor?: string; limit?: number },
    ): Promise<{ items: SandboxSessionEventRecord[]; nextCursor?: string }> {
      return await withSandboxHandle(workspaceId, providerId, sandboxId, async (handle) => handle.getEvents(input));
    },

    async createSandboxProcess(input: {
      workspaceId: string;
      providerId: ProviderId;
      sandboxId: string;
      request: ProcessCreateRequest;
    }): Promise<SandboxProcessRecord> {
      return await withSandboxHandle(input.workspaceId, input.providerId, input.sandboxId, async (handle) => handle.createProcess(input.request));
    },

    async listSandboxProcesses(workspaceId: string, providerId: ProviderId, sandboxId: string): Promise<{ processes: SandboxProcessRecord[] }> {
      return await withSandboxHandle(workspaceId, providerId, sandboxId, async (handle) => handle.listProcesses());
    },

    async getSandboxProcessLogs(
      workspaceId: string,
      providerId: ProviderId,
      sandboxId: string,
      processId: string,
      query?: ProcessLogFollowQuery,
    ): Promise<ProcessLogsResponse> {
      return await withSandboxHandle(workspaceId, providerId, sandboxId, async (handle) => handle.getProcessLogs(processId, query));
    },

    async stopSandboxProcess(
      workspaceId: string,
      providerId: ProviderId,
      sandboxId: string,
      processId: string,
      query?: ProcessSignalQuery,
    ): Promise<SandboxProcessRecord> {
      return await withSandboxHandle(workspaceId, providerId, sandboxId, async (handle) => handle.stopProcess(processId, query));
    },

    async killSandboxProcess(
      workspaceId: string,
      providerId: ProviderId,
      sandboxId: string,
      processId: string,
      query?: ProcessSignalQuery,
    ): Promise<SandboxProcessRecord> {
      return await withSandboxHandle(workspaceId, providerId, sandboxId, async (handle) => handle.killProcess(processId, query));
    },

    async deleteSandboxProcess(workspaceId: string, providerId: ProviderId, sandboxId: string, processId: string): Promise<void> {
      await withSandboxHandle(workspaceId, providerId, sandboxId, async (handle) => handle.deleteProcess(processId));
    },

    subscribeSandboxProcesses(workspaceId: string, providerId: ProviderId, sandboxId: string, listener: () => void): () => void {
      return subscribeSandboxProcesses(workspaceId, providerId, sandboxId, listener);
    },

    async sendSandboxPrompt(input: {
      workspaceId: string;
      providerId: ProviderId;
      sandboxId: string;
      sessionId: string;
      prompt: string;
      notification?: boolean;
    }): Promise<void> {
      await withSandboxHandle(input.workspaceId, input.providerId, input.sandboxId, async (handle) =>
        handle.rawSendSessionMethod(input.sessionId, "session/prompt", {
          prompt: [{ type: "text", text: input.prompt }],
        }),
      );
    },

    async sandboxSessionStatus(
      workspaceId: string,
      providerId: ProviderId,
      sandboxId: string,
      sessionId: string,
    ): Promise<{ id: string; status: "running" | "idle" | "error" }> {
      return {
        id: sessionId,
        status: "idle",
      };
    },

    async sandboxProviderState(
      workspaceId: string,
      providerId: ProviderId,
      sandboxId: string,
    ): Promise<{ providerId: ProviderId; sandboxId: string; state: string; at: number }> {
      return await withSandboxHandle(workspaceId, providerId, sandboxId, async (handle) => handle.providerState());
    },

    async getSandboxAgentConnection(workspaceId: string, providerId: ProviderId, sandboxId: string): Promise<{ endpoint: string; token?: string }> {
      return await withSandboxHandle(workspaceId, providerId, sandboxId, async (handle) => handle.sandboxAgentConnection());
    },

    async getWorkspaceSummary(workspaceId: string): Promise<WorkspaceSummarySnapshot> {
      return (await workspace(workspaceId)).getWorkspaceSummary({ workspaceId });
    },

    async getTaskDetail(workspaceId: string, repoId: string, taskIdValue: string): Promise<WorkbenchTaskDetail> {
      return (await task(workspaceId, repoId, taskIdValue)).getTaskDetail();
    },

    async getSessionDetail(workspaceId: string, repoId: string, taskIdValue: string, sessionId: string): Promise<WorkbenchSessionDetail> {
      return (await task(workspaceId, repoId, taskIdValue)).getSessionDetail({ sessionId });
    },

    async getWorkbench(workspaceId: string): Promise<TaskWorkbenchSnapshot> {
      return await getWorkbenchCompat(workspaceId);
    },

    subscribeWorkbench(workspaceId: string, listener: () => void): () => void {
      return subscribeWorkbench(workspaceId, listener);
    },

    async createWorkbenchTask(workspaceId: string, input: TaskWorkbenchCreateTaskInput): Promise<TaskWorkbenchCreateTaskResponse> {
      return (await workspace(workspaceId)).createWorkbenchTask(input);
    },

    async markWorkbenchUnread(workspaceId: string, input: TaskWorkbenchSelectInput): Promise<void> {
      await (await workspace(workspaceId)).markWorkbenchUnread(input);
    },

    async renameWorkbenchTask(workspaceId: string, input: TaskWorkbenchRenameInput): Promise<void> {
      await (await workspace(workspaceId)).renameWorkbenchTask(input);
    },

    async renameWorkbenchBranch(workspaceId: string, input: TaskWorkbenchRenameInput): Promise<void> {
      await (await workspace(workspaceId)).renameWorkbenchBranch(input);
    },

    async createWorkbenchSession(workspaceId: string, input: TaskWorkbenchSelectInput & { model?: string }): Promise<{ tabId: string }> {
      return await (await workspace(workspaceId)).createWorkbenchSession(input);
    },

    async renameWorkbenchSession(workspaceId: string, input: TaskWorkbenchRenameSessionInput): Promise<void> {
      await (await workspace(workspaceId)).renameWorkbenchSession(input);
    },

    async setWorkbenchSessionUnread(workspaceId: string, input: TaskWorkbenchSetSessionUnreadInput): Promise<void> {
      await (await workspace(workspaceId)).setWorkbenchSessionUnread(input);
    },

    async updateWorkbenchDraft(workspaceId: string, input: TaskWorkbenchUpdateDraftInput): Promise<void> {
      await (await workspace(workspaceId)).updateWorkbenchDraft(input);
    },

    async changeWorkbenchModel(workspaceId: string, input: TaskWorkbenchChangeModelInput): Promise<void> {
      await (await workspace(workspaceId)).changeWorkbenchModel(input);
    },

    async sendWorkbenchMessage(workspaceId: string, input: TaskWorkbenchSendMessageInput): Promise<void> {
      await (await workspace(workspaceId)).sendWorkbenchMessage(input);
    },

    async stopWorkbenchSession(workspaceId: string, input: TaskWorkbenchTabInput): Promise<void> {
      await (await workspace(workspaceId)).stopWorkbenchSession(input);
    },

    async closeWorkbenchSession(workspaceId: string, input: TaskWorkbenchTabInput): Promise<void> {
      await (await workspace(workspaceId)).closeWorkbenchSession(input);
    },

    async publishWorkbenchPr(workspaceId: string, input: TaskWorkbenchSelectInput): Promise<void> {
      await (await workspace(workspaceId)).publishWorkbenchPr(input);
    },

    async revertWorkbenchFile(workspaceId: string, input: TaskWorkbenchDiffInput): Promise<void> {
      await (await workspace(workspaceId)).revertWorkbenchFile(input);
    },

    async reloadGithubOrganization(workspaceId: string): Promise<void> {
      await (await workspace(workspaceId)).reloadGithubOrganization();
    },

    async reloadGithubPullRequests(workspaceId: string): Promise<void> {
      await (await workspace(workspaceId)).reloadGithubPullRequests();
    },

    async reloadGithubRepository(workspaceId: string, repoId: string): Promise<void> {
      await (await workspace(workspaceId)).reloadGithubRepository({ repoId });
    },

    async reloadGithubPullRequest(workspaceId: string, repoId: string, prNumber: number): Promise<void> {
      await (await workspace(workspaceId)).reloadGithubPullRequest({ repoId, prNumber });
    },

    async health(): Promise<{ ok: true }> {
      const workspaceId = options.defaultWorkspaceId;
      if (!workspaceId) {
        throw new Error("Backend client default workspace is required for health checks");
      }

      await (await workspace(workspaceId)).useWorkspace({
        workspaceId,
      });
      return { ok: true };
    },

    async useWorkspace(workspaceId: string): Promise<{ workspaceId: string }> {
      return (await workspace(workspaceId)).useWorkspace({ workspaceId });
    },
  };
}
