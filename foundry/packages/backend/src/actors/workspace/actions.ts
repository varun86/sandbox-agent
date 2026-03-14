// @ts-nocheck
import { setTimeout as delay } from "node:timers/promises";
import { desc, eq } from "drizzle-orm";
import { Loop } from "rivetkit/workflow";
import type {
  AddRepoInput,
  CreateTaskInput,
  HistoryEvent,
  HistoryQueryInput,
  ListTasksInput,
  ProviderId,
  RepoOverview,
  RepoRecord,
  RepoStackActionInput,
  RepoStackActionResult,
  StarSandboxAgentRepoInput,
  StarSandboxAgentRepoResult,
  SwitchResult,
  TaskRecord,
  TaskSummary,
  TaskWorkbenchChangeModelInput,
  TaskWorkbenchCreateTaskInput,
  TaskWorkbenchDiffInput,
  TaskWorkbenchRenameInput,
  TaskWorkbenchRenameSessionInput,
  TaskWorkbenchSelectInput,
  TaskWorkbenchSetSessionUnreadInput,
  TaskWorkbenchSendMessageInput,
  TaskWorkbenchTabInput,
  TaskWorkbenchUpdateDraftInput,
  WorkbenchOpenPrSummary,
  WorkbenchRepoSummary,
  WorkbenchSessionSummary,
  WorkbenchTaskSummary,
  WorkspaceEvent,
  WorkspaceSummarySnapshot,
  WorkspaceUseInput,
} from "@sandbox-agent/foundry-shared";
import { getActorRuntimeContext } from "../context.js";
import { getGithubData, getOrCreateGithubData, getTask, getOrCreateHistory, getOrCreateProject, selfWorkspace } from "../handles.js";
import { logActorWarning, resolveErrorMessage } from "../logging.js";
import { availableSandboxProviderIds, defaultSandboxProviderId } from "../../sandbox-config.js";
import { normalizeRemoteUrl, repoIdFromRemote } from "../../services/repo.js";
import { resolveWorkspaceGithubAuth } from "../../services/github-auth.js";
import { organizationProfile, taskLookup, repos, providerProfiles, taskSummaries } from "./db/schema.js";
import { agentTypeForModel } from "../task/workbench.js";
import { expectQueueResponse } from "../../services/queue.js";
import { workspaceAppActions } from "./app-shell.js";

interface WorkspaceState {
  workspaceId: string;
}

interface RefreshProviderProfilesCommand {
  providerId?: ProviderId;
}

interface GetTaskInput {
  workspaceId: string;
  taskId: string;
}

interface TaskProxyActionInput extends GetTaskInput {
  reason?: string;
}

interface RepoOverviewInput {
  workspaceId: string;
  repoId: string;
}

const WORKSPACE_QUEUE_NAMES = [
  "workspace.command.addRepo",
  "workspace.command.createTask",
  "workspace.command.refreshProviderProfiles",
  "workspace.command.syncGithubOrganizationRepos",
  "workspace.command.syncGithubSession",
] as const;
const SANDBOX_AGENT_REPO = "rivet-dev/sandbox-agent";

type WorkspaceQueueName = (typeof WORKSPACE_QUEUE_NAMES)[number];

export { WORKSPACE_QUEUE_NAMES };

export function workspaceWorkflowQueueName(name: WorkspaceQueueName): WorkspaceQueueName {
  return name;
}

const ORGANIZATION_PROFILE_ROW_ID = "profile";

function assertWorkspace(c: { state: WorkspaceState }, workspaceId: string): void {
  if (workspaceId !== c.state.workspaceId) {
    throw new Error(`Workspace actor mismatch: actor=${c.state.workspaceId} command=${workspaceId}`);
  }
}

async function resolveRepoId(c: any, taskId: string): Promise<string> {
  const row = await c.db.select({ repoId: taskLookup.repoId }).from(taskLookup).where(eq(taskLookup.taskId, taskId)).get();

  if (!row) {
    throw new Error(`Unknown task: ${taskId} (not in lookup)`);
  }

  return row.repoId;
}

async function upsertTaskLookupRow(c: any, taskId: string, repoId: string): Promise<void> {
  await c.db
    .insert(taskLookup)
    .values({
      taskId,
      repoId,
    })
    .onConflictDoUpdate({
      target: taskLookup.taskId,
      set: { repoId },
    })
    .run();
}

function parseJsonValue<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

async function collectAllTaskSummaries(c: any): Promise<TaskSummary[]> {
  const repoRows = await c.db.select({ repoId: repos.repoId, remoteUrl: repos.remoteUrl }).from(repos).orderBy(desc(repos.updatedAt)).all();

  const all: TaskSummary[] = [];
  for (const row of repoRows) {
    try {
      const project = await getOrCreateProject(c, c.state.workspaceId, row.repoId, row.remoteUrl);
      const snapshot = await project.listTaskSummaries({ includeArchived: true });
      all.push(...snapshot);
    } catch (error) {
      logActorWarning("workspace", "failed collecting tasks for repo", {
        workspaceId: c.state.workspaceId,
        repoId: row.repoId,
        error: resolveErrorMessage(error),
      });
    }
  }

  all.sort((a, b) => b.updatedAt - a.updatedAt);
  return all;
}

function repoLabelFromRemote(remoteUrl: string): string {
  try {
    const url = new URL(remoteUrl.startsWith("http") ? remoteUrl : `https://${remoteUrl}`);
    const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0]}/${(parts[1] ?? "").replace(/\.git$/, "")}`;
    }
  } catch {
    // ignore
  }

  return remoteUrl;
}

function buildRepoSummary(repoRow: { repoId: string; remoteUrl: string; updatedAt: number }, taskRows: WorkbenchTaskSummary[]): WorkbenchRepoSummary {
  const repoTasks = taskRows.filter((task) => task.repoId === repoRow.repoId);
  const latestActivityMs = repoTasks.reduce((latest, task) => Math.max(latest, task.updatedAtMs), repoRow.updatedAt);

  return {
    id: repoRow.repoId,
    label: repoLabelFromRemote(repoRow.remoteUrl),
    taskCount: repoTasks.length,
    latestActivityMs,
  };
}

function taskSummaryRowFromSummary(taskSummary: WorkbenchTaskSummary) {
  return {
    taskId: taskSummary.id,
    repoId: taskSummary.repoId,
    title: taskSummary.title,
    status: taskSummary.status,
    repoName: taskSummary.repoName,
    updatedAtMs: taskSummary.updatedAtMs,
    branch: taskSummary.branch,
    pullRequestJson: JSON.stringify(taskSummary.pullRequest),
    sessionsSummaryJson: JSON.stringify(taskSummary.sessionsSummary),
  };
}

function taskSummaryFromRow(row: any): WorkbenchTaskSummary {
  return {
    id: row.taskId,
    repoId: row.repoId,
    title: row.title,
    status: row.status,
    repoName: row.repoName,
    updatedAtMs: row.updatedAtMs,
    branch: row.branch ?? null,
    pullRequest: parseJsonValue(row.pullRequestJson, null),
    sessionsSummary: parseJsonValue<WorkbenchSessionSummary[]>(row.sessionsSummaryJson, []),
  };
}

async function listOpenPullRequestsSnapshot(c: any, taskRows: WorkbenchTaskSummary[]): Promise<WorkbenchOpenPrSummary[]> {
  const githubData = getGithubData(c, c.state.workspaceId);
  const openPullRequests = await githubData.listOpenPullRequests({}).catch(() => []);
  const claimedBranches = new Set(taskRows.filter((task) => task.branch).map((task) => `${task.repoId}:${task.branch}`));

  return openPullRequests.filter((pullRequest: WorkbenchOpenPrSummary) => !claimedBranches.has(`${pullRequest.repoId}:${pullRequest.headRefName}`));
}

async function reconcileWorkbenchProjection(c: any): Promise<WorkspaceSummarySnapshot> {
  const repoRows = await c.db
    .select({ repoId: repos.repoId, remoteUrl: repos.remoteUrl, updatedAt: repos.updatedAt })
    .from(repos)
    .orderBy(desc(repos.updatedAt))
    .all();

  const taskRows: WorkbenchTaskSummary[] = [];
  for (const row of repoRows) {
    try {
      const project = await getOrCreateProject(c, c.state.workspaceId, row.repoId, row.remoteUrl);
      const summaries = await project.listTaskSummaries({ includeArchived: true });
      for (const summary of summaries) {
        try {
          await upsertTaskLookupRow(c, summary.taskId, row.repoId);
          const task = getTask(c, c.state.workspaceId, row.repoId, summary.taskId);
          const taskSummary = await task.getTaskSummary({});
          taskRows.push(taskSummary);
          await c.db
            .insert(taskSummaries)
            .values(taskSummaryRowFromSummary(taskSummary))
            .onConflictDoUpdate({
              target: taskSummaries.taskId,
              set: taskSummaryRowFromSummary(taskSummary),
            })
            .run();
        } catch (error) {
          logActorWarning("workspace", "failed collecting task summary during reconciliation", {
            workspaceId: c.state.workspaceId,
            repoId: row.repoId,
            taskId: summary.taskId,
            error: resolveErrorMessage(error),
          });
        }
      }
    } catch (error) {
      logActorWarning("workspace", "failed collecting repo during workbench reconciliation", {
        workspaceId: c.state.workspaceId,
        repoId: row.repoId,
        error: resolveErrorMessage(error),
      });
    }
  }

  taskRows.sort((left, right) => right.updatedAtMs - left.updatedAtMs);
  return {
    workspaceId: c.state.workspaceId,
    repos: repoRows.map((row) => buildRepoSummary(row, taskRows)).sort((left, right) => right.latestActivityMs - left.latestActivityMs),
    taskSummaries: taskRows,
    openPullRequests: await listOpenPullRequestsSnapshot(c, taskRows),
  };
}

async function requireWorkbenchTask(c: any, taskId: string) {
  const repoId = await resolveRepoId(c, taskId);
  return getTask(c, c.state.workspaceId, repoId, taskId);
}

async function waitForWorkbenchTaskReady(task: any, timeoutMs = 5 * 60_000): Promise<any> {
  const startedAt = Date.now();

  for (;;) {
    const record = await task.get();
    if (record?.branchName && record?.title) {
      return record;
    }
    if (record?.status === "error") {
      throw new Error("task initialization failed before the workbench session was ready");
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("timed out waiting for task initialization");
    }
    await delay(1_000);
  }
}

/**
 * Reads the workspace sidebar snapshot from the workspace actor's local SQLite
 * plus the org-scoped GitHub actor for open PRs. Task actors still push
 * summary updates into `task_summaries`, so the hot read path stays bounded.
 */
async function getWorkspaceSummarySnapshot(c: any): Promise<WorkspaceSummarySnapshot> {
  const repoRows = await c.db
    .select({
      repoId: repos.repoId,
      remoteUrl: repos.remoteUrl,
      updatedAt: repos.updatedAt,
    })
    .from(repos)
    .orderBy(desc(repos.updatedAt))
    .all();
  const taskRows = await c.db.select().from(taskSummaries).orderBy(desc(taskSummaries.updatedAtMs)).all();
  const summaries = taskRows.map(taskSummaryFromRow);

  return {
    workspaceId: c.state.workspaceId,
    repos: repoRows.map((row) => buildRepoSummary(row, summaries)).sort((left, right) => right.latestActivityMs - left.latestActivityMs),
    taskSummaries: summaries,
    openPullRequests: await listOpenPullRequestsSnapshot(c, summaries),
  };
}

async function broadcastRepoSummary(
  c: any,
  type: "repoAdded" | "repoUpdated",
  repoRow: { repoId: string; remoteUrl: string; updatedAt: number },
): Promise<void> {
  const matchingTaskRows = await c.db.select().from(taskSummaries).where(eq(taskSummaries.repoId, repoRow.repoId)).all();
  const repo = buildRepoSummary(repoRow, matchingTaskRows.map(taskSummaryFromRow));
  c.broadcast("workspaceUpdated", { type, repo } satisfies WorkspaceEvent);
}

async function addRepoMutation(c: any, input: AddRepoInput): Promise<RepoRecord> {
  assertWorkspace(c, input.workspaceId);

  const remoteUrl = normalizeRemoteUrl(input.remoteUrl);
  if (!remoteUrl) {
    throw new Error("remoteUrl is required");
  }

  const { driver } = getActorRuntimeContext();
  const auth = await resolveWorkspaceGithubAuth(c, c.state.workspaceId);
  await driver.git.validateRemote(remoteUrl, { githubToken: auth?.githubToken ?? null });

  const repoId = repoIdFromRemote(remoteUrl);
  const now = Date.now();
  const existing = await c.db.select({ repoId: repos.repoId }).from(repos).where(eq(repos.repoId, repoId)).get();

  await c.db
    .insert(repos)
    .values({
      repoId,
      remoteUrl,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: repos.repoId,
      set: {
        remoteUrl,
        updatedAt: now,
      },
    })
    .run();

  await broadcastRepoSummary(c, existing ? "repoUpdated" : "repoAdded", {
    repoId,
    remoteUrl,
    updatedAt: now,
  });
  return {
    workspaceId: c.state.workspaceId,
    repoId,
    remoteUrl,
    createdAt: now,
    updatedAt: now,
  };
}

async function createTaskMutation(c: any, input: CreateTaskInput): Promise<TaskRecord> {
  assertWorkspace(c, input.workspaceId);

  const { config } = getActorRuntimeContext();
  const providerId = input.providerId ?? defaultSandboxProviderId(config);

  const repoId = input.repoId;
  const repoRow = await c.db.select({ remoteUrl: repos.remoteUrl }).from(repos).where(eq(repos.repoId, repoId)).get();
  if (!repoRow) {
    throw new Error(`Unknown repo: ${repoId}`);
  }
  const remoteUrl = repoRow.remoteUrl;

  await c.db
    .insert(providerProfiles)
    .values({
      providerId,
      profileJson: JSON.stringify({ providerId }),
      updatedAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: providerProfiles.providerId,
      set: {
        profileJson: JSON.stringify({ providerId }),
        updatedAt: Date.now(),
      },
    })
    .run();

  const project = await getOrCreateProject(c, c.state.workspaceId, repoId, remoteUrl);

  const created = await project.createTask({
    task: input.task,
    providerId,
    agentType: input.agentType ?? null,
    explicitTitle: input.explicitTitle ?? null,
    explicitBranchName: input.explicitBranchName ?? null,
    onBranch: input.onBranch ?? null,
  });

  await c.db
    .insert(taskLookup)
    .values({
      taskId: created.taskId,
      repoId,
    })
    .onConflictDoUpdate({
      target: taskLookup.taskId,
      set: { repoId },
    })
    .run();

  try {
    const task = getTask(c, c.state.workspaceId, repoId, created.taskId);
    await workspaceActions.applyTaskSummaryUpdate(c, {
      taskSummary: await task.getTaskSummary({}),
    });
  } catch (error) {
    logActorWarning("workspace", "failed seeding task summary after task creation", {
      workspaceId: c.state.workspaceId,
      repoId,
      taskId: created.taskId,
      error: resolveErrorMessage(error),
    });
  }

  return created;
}

async function refreshProviderProfilesMutation(c: any, command?: RefreshProviderProfilesCommand): Promise<void> {
  const body = command ?? {};
  const { config } = getActorRuntimeContext();
  const providerIds: ProviderId[] = body.providerId ? [body.providerId] : availableSandboxProviderIds(config);

  for (const providerId of providerIds) {
    await c.db
      .insert(providerProfiles)
      .values({
        providerId,
        profileJson: JSON.stringify({ providerId }),
        updatedAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: providerProfiles.providerId,
        set: {
          profileJson: JSON.stringify({ providerId }),
          updatedAt: Date.now(),
        },
      })
      .run();
  }
}

export async function runWorkspaceWorkflow(ctx: any): Promise<void> {
  await ctx.loop("workspace-command-loop", async (loopCtx: any) => {
    const msg = await loopCtx.queue.next("next-workspace-command", {
      names: [...WORKSPACE_QUEUE_NAMES],
      completable: true,
    });
    if (!msg) {
      return Loop.continue(undefined);
    }

    try {
      if (msg.name === "workspace.command.addRepo") {
        const result = await loopCtx.step({
          name: "workspace-add-repo",
          timeout: 60_000,
          run: async () => addRepoMutation(loopCtx, msg.body as AddRepoInput),
        });
        await msg.complete(result);
        return Loop.continue(undefined);
      }

      if (msg.name === "workspace.command.createTask") {
        const result = await loopCtx.step({
          name: "workspace-create-task",
          timeout: 5 * 60_000,
          run: async () => createTaskMutation(loopCtx, msg.body as CreateTaskInput),
        });
        await msg.complete(result);
        return Loop.continue(undefined);
      }

      if (msg.name === "workspace.command.refreshProviderProfiles") {
        await loopCtx.step("workspace-refresh-provider-profiles", async () =>
          refreshProviderProfilesMutation(loopCtx, msg.body as RefreshProviderProfilesCommand),
        );
        await msg.complete({ ok: true });
        return Loop.continue(undefined);
      }

      if (msg.name === "workspace.command.syncGithubSession") {
        await loopCtx.step({
          name: "workspace-sync-github-session",
          timeout: 60_000,
          run: async () => {
            const { syncGithubOrganizations } = await import("./app-shell.js");
            await syncGithubOrganizations(loopCtx, msg.body as { sessionId: string; accessToken: string });
          },
        });
        await msg.complete({ ok: true });
        return Loop.continue(undefined);
      }

      if (msg.name === "workspace.command.syncGithubOrganizationRepos") {
        await loopCtx.step({
          name: "workspace-sync-github-organization-repos",
          timeout: 60_000,
          run: async () => {
            const { syncGithubOrganizationRepos } = await import("./app-shell.js");
            await syncGithubOrganizationRepos(loopCtx, msg.body as { sessionId: string; organizationId: string });
          },
        });
        await msg.complete({ ok: true });
        return Loop.continue(undefined);
      }
    } catch (error) {
      const message = resolveErrorMessage(error);
      logActorWarning("workspace", "workspace workflow command failed", {
        workspaceId: loopCtx.state.workspaceId,
        queueName: msg.name,
        error: message,
      });
      await msg.complete({ error: message }).catch((completeError: unknown) => {
        logActorWarning("workspace", "workspace workflow failed completing error response", {
          workspaceId: loopCtx.state.workspaceId,
          queueName: msg.name,
          error: resolveErrorMessage(completeError),
        });
      });
    }

    return Loop.continue(undefined);
  });
}

export const workspaceActions = {
  ...workspaceAppActions,
  async useWorkspace(c: any, input: WorkspaceUseInput): Promise<{ workspaceId: string }> {
    assertWorkspace(c, input.workspaceId);
    return { workspaceId: c.state.workspaceId };
  },

  async addRepo(c: any, input: AddRepoInput): Promise<RepoRecord> {
    const self = selfWorkspace(c);
    return expectQueueResponse<RepoRecord>(
      await self.send(workspaceWorkflowQueueName("workspace.command.addRepo"), input, {
        wait: true,
        timeout: 60_000,
      }),
    );
  },

  async listRepos(c: any, input: WorkspaceUseInput): Promise<RepoRecord[]> {
    assertWorkspace(c, input.workspaceId);

    const rows = await c.db
      .select({
        repoId: repos.repoId,
        remoteUrl: repos.remoteUrl,
        createdAt: repos.createdAt,
        updatedAt: repos.updatedAt,
      })
      .from(repos)
      .orderBy(desc(repos.updatedAt))
      .all();

    return rows.map((row) => ({
      workspaceId: c.state.workspaceId,
      repoId: row.repoId,
      remoteUrl: row.remoteUrl,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  },

  async createTask(c: any, input: CreateTaskInput): Promise<TaskRecord> {
    const self = selfWorkspace(c);
    return expectQueueResponse<TaskRecord>(
      await self.send(workspaceWorkflowQueueName("workspace.command.createTask"), input, {
        wait: true,
        timeout: 5 * 60_000,
      }),
    );
  },

  async starSandboxAgentRepo(c: any, input: StarSandboxAgentRepoInput): Promise<StarSandboxAgentRepoResult> {
    assertWorkspace(c, input.workspaceId);
    const { driver } = getActorRuntimeContext();
    await driver.github.starRepository(SANDBOX_AGENT_REPO);
    return {
      repo: SANDBOX_AGENT_REPO,
      starredAt: Date.now(),
    };
  },

  /**
   * Called by task actors when their summary-level state changes.
   * This is the write path for the local materialized projection; clients read
   * the projection via `getWorkspaceSummary`, but only task actors should push
   * rows into it.
   */
  async applyTaskSummaryUpdate(c: any, input: { taskSummary: WorkbenchTaskSummary }): Promise<void> {
    await c.db
      .insert(taskSummaries)
      .values(taskSummaryRowFromSummary(input.taskSummary))
      .onConflictDoUpdate({
        target: taskSummaries.taskId,
        set: taskSummaryRowFromSummary(input.taskSummary),
      })
      .run();
    c.broadcast("workspaceUpdated", { type: "taskSummaryUpdated", taskSummary: input.taskSummary } satisfies WorkspaceEvent);
  },

  async removeTaskSummary(c: any, input: { taskId: string }): Promise<void> {
    await c.db.delete(taskSummaries).where(eq(taskSummaries.taskId, input.taskId)).run();
    c.broadcast("workspaceUpdated", { type: "taskRemoved", taskId: input.taskId } satisfies WorkspaceEvent);
  },

  async findTaskForGithubBranch(c: any, input: { repoId: string; branchName: string }): Promise<{ taskId: string | null }> {
    const summaries = await c.db.select().from(taskSummaries).where(eq(taskSummaries.repoId, input.repoId)).all();
    const existing = summaries.find((summary) => summary.branch === input.branchName);
    return { taskId: existing?.taskId ?? null };
  },

  async refreshTaskSummaryForGithubBranch(c: any, input: { repoId: string; branchName: string }): Promise<void> {
    const summaries = await c.db.select().from(taskSummaries).where(eq(taskSummaries.repoId, input.repoId)).all();
    const matches = summaries.filter((summary) => summary.branch === input.branchName);

    for (const summary of matches) {
      try {
        const task = getTask(c, c.state.workspaceId, input.repoId, summary.taskId);
        await workspaceActions.applyTaskSummaryUpdate(c, {
          taskSummary: await task.getTaskSummary({}),
        });
      } catch (error) {
        logActorWarning("workspace", "failed refreshing task summary for GitHub branch", {
          workspaceId: c.state.workspaceId,
          repoId: input.repoId,
          branchName: input.branchName,
          taskId: summary.taskId,
          error: resolveErrorMessage(error),
        });
      }
    }
  },

  async applyOpenPullRequestUpdate(c: any, input: { pullRequest: WorkbenchOpenPrSummary }): Promise<void> {
    const summaries = await c.db.select().from(taskSummaries).where(eq(taskSummaries.repoId, input.pullRequest.repoId)).all();
    if (summaries.some((summary) => summary.branch === input.pullRequest.headRefName)) {
      return;
    }
    c.broadcast("workspaceUpdated", { type: "pullRequestUpdated", pullRequest: input.pullRequest } satisfies WorkspaceEvent);
  },

  async removeOpenPullRequest(c: any, input: { prId: string }): Promise<void> {
    c.broadcast("workspaceUpdated", { type: "pullRequestRemoved", prId: input.prId } satisfies WorkspaceEvent);
  },

  async applyGithubRepositoryProjection(c: any, input: { repoId: string; remoteUrl: string }): Promise<void> {
    const now = Date.now();
    const existing = await c.db.select({ repoId: repos.repoId }).from(repos).where(eq(repos.repoId, input.repoId)).get();
    await c.db
      .insert(repos)
      .values({
        repoId: input.repoId,
        remoteUrl: input.remoteUrl,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: repos.repoId,
        set: {
          remoteUrl: input.remoteUrl,
          updatedAt: now,
        },
      })
      .run();
    await broadcastRepoSummary(c, existing ? "repoUpdated" : "repoAdded", {
      repoId: input.repoId,
      remoteUrl: input.remoteUrl,
      updatedAt: now,
    });
  },

  async applyGithubDataProjection(
    c: any,
    input: {
      connectedAccount: string;
      installationStatus: string;
      installationId: number | null;
      syncStatus: string;
      lastSyncLabel: string;
      lastSyncAt: number | null;
      repositories: Array<{ fullName: string; cloneUrl: string; private: boolean }>;
    },
  ): Promise<void> {
    const existingRepos = await c.db.select({ repoId: repos.repoId, remoteUrl: repos.remoteUrl, updatedAt: repos.updatedAt }).from(repos).all();
    const existingById = new Map(existingRepos.map((repo) => [repo.repoId, repo]));
    const nextRepoIds = new Set<string>();
    const now = Date.now();

    for (const repository of input.repositories) {
      const repoId = repoIdFromRemote(repository.cloneUrl);
      nextRepoIds.add(repoId);
      await c.db
        .insert(repos)
        .values({
          repoId,
          remoteUrl: repository.cloneUrl,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: repos.repoId,
          set: {
            remoteUrl: repository.cloneUrl,
            updatedAt: now,
          },
        })
        .run();
      await broadcastRepoSummary(c, existingById.has(repoId) ? "repoUpdated" : "repoAdded", {
        repoId,
        remoteUrl: repository.cloneUrl,
        updatedAt: now,
      });
    }

    for (const repo of existingRepos) {
      if (nextRepoIds.has(repo.repoId)) {
        continue;
      }
      await c.db.delete(repos).where(eq(repos.repoId, repo.repoId)).run();
      c.broadcast("workspaceUpdated", { type: "repoRemoved", repoId: repo.repoId } satisfies WorkspaceEvent);
    }

    const profile = await c.db
      .select({ id: organizationProfile.id })
      .from(organizationProfile)
      .where(eq(organizationProfile.id, ORGANIZATION_PROFILE_ROW_ID))
      .get();
    if (profile) {
      await c.db
        .update(organizationProfile)
        .set({
          githubConnectedAccount: input.connectedAccount,
          githubInstallationStatus: input.installationStatus,
          githubSyncStatus: input.syncStatus,
          githubInstallationId: input.installationId,
          githubLastSyncLabel: input.lastSyncLabel,
          githubLastSyncAt: input.lastSyncAt,
          updatedAt: now,
        })
        .where(eq(organizationProfile.id, ORGANIZATION_PROFILE_ROW_ID))
        .run();
    }
  },

  async recordGithubWebhookReceipt(
    c: any,
    input: {
      workspaceId: string;
      event: string;
      action?: string | null;
      receivedAt?: number;
    },
  ): Promise<void> {
    assertWorkspace(c, input.workspaceId);

    const profile = await c.db
      .select({ id: organizationProfile.id })
      .from(organizationProfile)
      .where(eq(organizationProfile.id, ORGANIZATION_PROFILE_ROW_ID))
      .get();
    if (!profile) {
      return;
    }

    await c.db
      .update(organizationProfile)
      .set({
        githubLastWebhookAt: input.receivedAt ?? Date.now(),
        githubLastWebhookEvent: input.action ? `${input.event}.${input.action}` : input.event,
      })
      .where(eq(organizationProfile.id, ORGANIZATION_PROFILE_ROW_ID))
      .run();
  },

  async getWorkspaceSummary(c: any, input: WorkspaceUseInput): Promise<WorkspaceSummarySnapshot> {
    assertWorkspace(c, input.workspaceId);
    return await getWorkspaceSummarySnapshot(c);
  },

  async reconcileWorkbenchState(c: any, input: WorkspaceUseInput): Promise<WorkspaceSummarySnapshot> {
    assertWorkspace(c, input.workspaceId);
    return await reconcileWorkbenchProjection(c);
  },

  async createWorkbenchTask(c: any, input: TaskWorkbenchCreateTaskInput): Promise<{ taskId: string; tabId?: string }> {
    const created = await workspaceActions.createTask(c, {
      workspaceId: c.state.workspaceId,
      repoId: input.repoId,
      task: input.task,
      ...(input.title ? { explicitTitle: input.title } : {}),
      ...(input.onBranch ? { onBranch: input.onBranch } : input.branch ? { explicitBranchName: input.branch } : {}),
      ...(input.model ? { agentType: agentTypeForModel(input.model) } : {}),
    });
    const task = await requireWorkbenchTask(c, created.taskId);
    await waitForWorkbenchTaskReady(task);
    const session = await task.createWorkbenchSession({
      taskId: created.taskId,
      ...(input.model ? { model: input.model } : {}),
    });
    await task.sendWorkbenchMessage({
      taskId: created.taskId,
      tabId: session.tabId,
      text: input.task,
      attachments: [],
      waitForCompletion: true,
    });
    await task.getSessionDetail({
      sessionId: session.tabId,
    });
    return {
      taskId: created.taskId,
      tabId: session.tabId,
    };
  },

  async markWorkbenchUnread(c: any, input: TaskWorkbenchSelectInput): Promise<void> {
    const task = await requireWorkbenchTask(c, input.taskId);
    await task.markWorkbenchUnread({});
  },

  async renameWorkbenchTask(c: any, input: TaskWorkbenchRenameInput): Promise<void> {
    const task = await requireWorkbenchTask(c, input.taskId);
    await task.renameWorkbenchTask(input);
  },

  async renameWorkbenchBranch(c: any, input: TaskWorkbenchRenameInput): Promise<void> {
    const task = await requireWorkbenchTask(c, input.taskId);
    await task.renameWorkbenchBranch(input);
  },

  async createWorkbenchSession(c: any, input: TaskWorkbenchSelectInput & { model?: string }): Promise<{ tabId: string }> {
    const task = await requireWorkbenchTask(c, input.taskId);
    return await task.createWorkbenchSession({ ...(input.model ? { model: input.model } : {}) });
  },

  async renameWorkbenchSession(c: any, input: TaskWorkbenchRenameSessionInput): Promise<void> {
    const task = await requireWorkbenchTask(c, input.taskId);
    await task.renameWorkbenchSession(input);
  },

  async setWorkbenchSessionUnread(c: any, input: TaskWorkbenchSetSessionUnreadInput): Promise<void> {
    const task = await requireWorkbenchTask(c, input.taskId);
    await task.setWorkbenchSessionUnread(input);
  },

  async updateWorkbenchDraft(c: any, input: TaskWorkbenchUpdateDraftInput): Promise<void> {
    const task = await requireWorkbenchTask(c, input.taskId);
    await task.updateWorkbenchDraft(input);
  },

  async changeWorkbenchModel(c: any, input: TaskWorkbenchChangeModelInput): Promise<void> {
    const task = await requireWorkbenchTask(c, input.taskId);
    await task.changeWorkbenchModel(input);
  },

  async sendWorkbenchMessage(c: any, input: TaskWorkbenchSendMessageInput): Promise<void> {
    const task = await requireWorkbenchTask(c, input.taskId);
    await task.sendWorkbenchMessage(input);
  },

  async stopWorkbenchSession(c: any, input: TaskWorkbenchTabInput): Promise<void> {
    const task = await requireWorkbenchTask(c, input.taskId);
    await task.stopWorkbenchSession(input);
  },

  async closeWorkbenchSession(c: any, input: TaskWorkbenchTabInput): Promise<void> {
    const task = await requireWorkbenchTask(c, input.taskId);
    await task.closeWorkbenchSession(input);
  },

  async publishWorkbenchPr(c: any, input: TaskWorkbenchSelectInput): Promise<void> {
    const task = await requireWorkbenchTask(c, input.taskId);
    await task.publishWorkbenchPr({});
  },

  async revertWorkbenchFile(c: any, input: TaskWorkbenchDiffInput): Promise<void> {
    const task = await requireWorkbenchTask(c, input.taskId);
    await task.revertWorkbenchFile(input);
  },

  async reloadGithubOrganization(c: any): Promise<void> {
    await getOrCreateGithubData(c, c.state.workspaceId).reloadOrganization({});
  },

  async reloadGithubPullRequests(c: any): Promise<void> {
    await getOrCreateGithubData(c, c.state.workspaceId).reloadAllPullRequests({});
  },

  async reloadGithubRepository(c: any, input: { repoId: string }): Promise<void> {
    await getOrCreateGithubData(c, c.state.workspaceId).reloadRepository(input);
  },

  async reloadGithubPullRequest(c: any, input: { repoId: string; prNumber: number }): Promise<void> {
    await getOrCreateGithubData(c, c.state.workspaceId).reloadPullRequest(input);
  },

  async listTasks(c: any, input: ListTasksInput): Promise<TaskSummary[]> {
    assertWorkspace(c, input.workspaceId);

    if (input.repoId) {
      const repoRow = await c.db.select({ remoteUrl: repos.remoteUrl }).from(repos).where(eq(repos.repoId, input.repoId)).get();
      if (!repoRow) {
        throw new Error(`Unknown repo: ${input.repoId}`);
      }

      const project = await getOrCreateProject(c, c.state.workspaceId, input.repoId, repoRow.remoteUrl);
      return await project.listTaskSummaries({ includeArchived: true });
    }

    return await collectAllTaskSummaries(c);
  },

  async getRepoOverview(c: any, input: RepoOverviewInput): Promise<RepoOverview> {
    assertWorkspace(c, input.workspaceId);

    const repoRow = await c.db.select({ remoteUrl: repos.remoteUrl }).from(repos).where(eq(repos.repoId, input.repoId)).get();
    if (!repoRow) {
      throw new Error(`Unknown repo: ${input.repoId}`);
    }

    const project = await getOrCreateProject(c, c.state.workspaceId, input.repoId, repoRow.remoteUrl);
    await project.ensure({ remoteUrl: repoRow.remoteUrl });
    return await project.getRepoOverview({});
  },

  async runRepoStackAction(c: any, input: RepoStackActionInput): Promise<RepoStackActionResult> {
    assertWorkspace(c, input.workspaceId);

    const repoRow = await c.db.select({ remoteUrl: repos.remoteUrl }).from(repos).where(eq(repos.repoId, input.repoId)).get();
    if (!repoRow) {
      throw new Error(`Unknown repo: ${input.repoId}`);
    }

    const project = await getOrCreateProject(c, c.state.workspaceId, input.repoId, repoRow.remoteUrl);
    await project.ensure({ remoteUrl: repoRow.remoteUrl });
    return await project.runRepoStackAction({
      action: input.action,
      branchName: input.branchName,
      parentBranch: input.parentBranch,
    });
  },

  async switchTask(c: any, taskId: string): Promise<SwitchResult> {
    const repoId = await resolveRepoId(c, taskId);
    const h = getTask(c, c.state.workspaceId, repoId, taskId);
    const record = await h.get();
    const switched = await h.switch();

    return {
      workspaceId: c.state.workspaceId,
      taskId,
      providerId: record.providerId,
      switchTarget: switched.switchTarget,
    };
  },

  async refreshProviderProfiles(c: any, command?: RefreshProviderProfilesCommand): Promise<void> {
    const self = selfWorkspace(c);
    await self.send(workspaceWorkflowQueueName("workspace.command.refreshProviderProfiles"), command ?? {}, {
      wait: true,
      timeout: 60_000,
    });
  },

  async history(c: any, input: HistoryQueryInput): Promise<HistoryEvent[]> {
    assertWorkspace(c, input.workspaceId);

    const limit = input.limit ?? 20;
    const repoRows = await c.db.select({ repoId: repos.repoId }).from(repos).all();

    const allEvents: HistoryEvent[] = [];

    for (const row of repoRows) {
      try {
        const hist = await getOrCreateHistory(c, c.state.workspaceId, row.repoId);
        const items = await hist.list({
          branch: input.branch,
          taskId: input.taskId,
          limit,
        });
        allEvents.push(...items);
      } catch (error) {
        logActorWarning("workspace", "history lookup failed for repo", {
          workspaceId: c.state.workspaceId,
          repoId: row.repoId,
          error: resolveErrorMessage(error),
        });
      }
    }

    allEvents.sort((a, b) => b.createdAt - a.createdAt);
    return allEvents.slice(0, limit);
  },

  async getTask(c: any, input: GetTaskInput): Promise<TaskRecord> {
    assertWorkspace(c, input.workspaceId);

    const repoId = await resolveRepoId(c, input.taskId);

    const repoRow = await c.db.select({ remoteUrl: repos.remoteUrl }).from(repos).where(eq(repos.repoId, repoId)).get();
    if (!repoRow) {
      throw new Error(`Unknown repo: ${repoId}`);
    }

    const project = await getOrCreateProject(c, c.state.workspaceId, repoId, repoRow.remoteUrl);
    return await project.getTaskEnriched({ taskId: input.taskId });
  },

  async attachTask(c: any, input: TaskProxyActionInput): Promise<{ target: string; sessionId: string | null }> {
    assertWorkspace(c, input.workspaceId);
    const repoId = await resolveRepoId(c, input.taskId);
    const h = getTask(c, c.state.workspaceId, repoId, input.taskId);
    return await h.attach({ reason: input.reason });
  },

  async pushTask(c: any, input: TaskProxyActionInput): Promise<void> {
    assertWorkspace(c, input.workspaceId);
    const repoId = await resolveRepoId(c, input.taskId);
    const h = getTask(c, c.state.workspaceId, repoId, input.taskId);
    await h.push({ reason: input.reason });
  },

  async syncTask(c: any, input: TaskProxyActionInput): Promise<void> {
    assertWorkspace(c, input.workspaceId);
    const repoId = await resolveRepoId(c, input.taskId);
    const h = getTask(c, c.state.workspaceId, repoId, input.taskId);
    await h.sync({ reason: input.reason });
  },

  async mergeTask(c: any, input: TaskProxyActionInput): Promise<void> {
    assertWorkspace(c, input.workspaceId);
    const repoId = await resolveRepoId(c, input.taskId);
    const h = getTask(c, c.state.workspaceId, repoId, input.taskId);
    await h.merge({ reason: input.reason });
  },

  async archiveTask(c: any, input: TaskProxyActionInput): Promise<void> {
    assertWorkspace(c, input.workspaceId);
    const repoId = await resolveRepoId(c, input.taskId);
    const h = getTask(c, c.state.workspaceId, repoId, input.taskId);
    await h.archive({ reason: input.reason });
  },

  async killTask(c: any, input: TaskProxyActionInput): Promise<void> {
    assertWorkspace(c, input.workspaceId);
    const repoId = await resolveRepoId(c, input.taskId);
    const h = getTask(c, c.state.workspaceId, repoId, input.taskId);
    await h.kill({ reason: input.reason });
  },
};
