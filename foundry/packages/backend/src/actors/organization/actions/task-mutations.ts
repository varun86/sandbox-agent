// @ts-nocheck
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import type {
  RepoOverview,
  SandboxProviderId,
  TaskRecord,
  TaskSummary,
  WorkspacePullRequestSummary,
  WorkspaceSessionSummary,
  WorkspaceTaskSummary,
} from "@sandbox-agent/foundry-shared";
import { getActorRuntimeContext } from "../../context.js";
import { getGithubData, getOrCreateAuditLog, getOrCreateTask, getTask } from "../../handles.js";
// task actions called directly (no queue)
import { deriveFallbackTitle, resolveCreateFlowDecision } from "../../../services/create-flow.js";
// actions return directly (no queue response unwrapping)
import { isActorNotFoundError, logActorWarning, resolveErrorMessage } from "../../logging.js";
import { defaultSandboxProviderId } from "../../../sandbox-config.js";
import { taskIndex, taskSummaries } from "../db/schema.js";
import { refreshOrganizationSnapshotMutation } from "../actions.js";

interface CreateTaskCommand {
  repoId: string;
  task: string;
  sandboxProviderId: SandboxProviderId;
  explicitTitle: string | null;
  explicitBranchName: string | null;
  onBranch: string | null;
}

interface RegisterTaskBranchCommand {
  repoId: string;
  taskId: string;
  branchName: string;
  requireExistingRemote?: boolean;
}

function isStaleTaskReferenceError(error: unknown): boolean {
  const message = resolveErrorMessage(error);
  return isActorNotFoundError(error) || message.startsWith("Task not found:");
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

function taskSummaryRowFromSummary(taskSummary: WorkspaceTaskSummary) {
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
    primaryUserLogin: taskSummary.primaryUserLogin ?? null,
    primaryUserAvatarUrl: taskSummary.primaryUserAvatarUrl ?? null,
  };
}

export function taskSummaryFromRow(repoId: string, row: any): WorkspaceTaskSummary {
  return {
    id: row.taskId,
    repoId,
    title: row.title,
    status: row.status,
    repoName: row.repoName,
    updatedAtMs: row.updatedAtMs,
    branch: row.branch ?? null,
    pullRequest: parseJsonValue<WorkspacePullRequestSummary | null>(row.pullRequestJson, null),
    sessionsSummary: parseJsonValue<WorkspaceSessionSummary[]>(row.sessionsSummaryJson, []),
    primaryUserLogin: row.primaryUserLogin ?? null,
    primaryUserAvatarUrl: row.primaryUserAvatarUrl ?? null,
  };
}

export async function upsertTaskSummary(c: any, taskSummary: WorkspaceTaskSummary): Promise<void> {
  await c.db
    .insert(taskSummaries)
    .values(taskSummaryRowFromSummary(taskSummary))
    .onConflictDoUpdate({
      target: taskSummaries.taskId,
      set: taskSummaryRowFromSummary(taskSummary),
    })
    .run();
}

async function deleteStaleTaskIndexRow(c: any, taskId: string): Promise<void> {
  try {
    await c.db.delete(taskIndex).where(eq(taskIndex.taskId, taskId)).run();
  } catch {
    // Best effort cleanup only.
  }
}

async function listKnownTaskBranches(c: any, repoId: string): Promise<string[]> {
  const rows = await c.db
    .select({ branchName: taskIndex.branchName })
    .from(taskIndex)
    .where(and(eq(taskIndex.repoId, repoId), isNotNull(taskIndex.branchName)))
    .all();
  return rows.map((row) => row.branchName).filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

async function resolveGitHubRepository(c: any, repoId: string) {
  const githubData = getGithubData(c, c.state.organizationId);
  return await githubData.getRepository({ repoId }).catch(() => null);
}

async function listGitHubBranches(c: any, repoId: string): Promise<Array<{ branchName: string; commitSha: string }>> {
  const githubData = getGithubData(c, c.state.organizationId);
  return await githubData.listBranchesForRepository({ repoId }).catch(() => []);
}

async function resolveRepositoryRemoteUrl(c: any, repoId: string): Promise<string> {
  const repository = await resolveGitHubRepository(c, repoId);
  const remoteUrl = repository?.cloneUrl?.trim();
  if (!remoteUrl) {
    throw new Error(`Missing remote URL for repo ${repoId}`);
  }
  return remoteUrl;
}

/**
 * The ONLY backend code path that creates a task actor via getOrCreateTask.
 * Called when a user explicitly creates a new task (not during sync/webhooks).
 *
 * All other code must use getTask (handles.ts) which calls .get() and will
 * error if the actor doesn't exist. Virtual tasks created during PR sync
 * are materialized lazily by the client's getOrCreate in backend-client.ts.
 *
 * NEVER call this from a sync loop or webhook handler.
 */
export async function createTaskMutation(c: any, cmd: CreateTaskCommand): Promise<TaskRecord> {
  const organizationId = c.state.organizationId;
  const repoId = cmd.repoId;
  await resolveRepositoryRemoteUrl(c, repoId);
  const onBranch = cmd.onBranch?.trim() || null;
  const taskId = randomUUID();
  let initialBranchName: string | null = null;
  let initialTitle: string | null = null;

  if (onBranch) {
    initialBranchName = onBranch;
    initialTitle = deriveFallbackTitle(cmd.task, cmd.explicitTitle ?? undefined);

    await registerTaskBranchMutation(c, {
      repoId,
      taskId,
      branchName: onBranch,
      requireExistingRemote: true,
    });
  } else {
    const reservedBranches = await listKnownTaskBranches(c, repoId);
    const resolved = resolveCreateFlowDecision({
      task: cmd.task,
      explicitTitle: cmd.explicitTitle ?? undefined,
      explicitBranchName: cmd.explicitBranchName ?? undefined,
      localBranches: [],
      taskBranches: reservedBranches,
    });

    initialBranchName = resolved.branchName;
    initialTitle = resolved.title;

    const now = Date.now();
    await c.db
      .insert(taskIndex)
      .values({
        taskId,
        repoId,
        branchName: resolved.branchName,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();
  }

  let taskHandle: Awaited<ReturnType<typeof getOrCreateTask>>;
  try {
    taskHandle = await getOrCreateTask(c, organizationId, repoId, taskId, {
      organizationId,
      repoId,
      taskId,
    });
  } catch (error) {
    if (initialBranchName) {
      await deleteStaleTaskIndexRow(c, taskId);
    }
    throw error;
  }

  const created = await taskHandle.initialize({
    sandboxProviderId: cmd.sandboxProviderId,
    branchName: initialBranchName,
    title: initialTitle,
    task: cmd.task,
  });

  try {
    await upsertTaskSummary(c, await taskHandle.getTaskSummary({}));
    await refreshOrganizationSnapshotMutation(c);
  } catch (error) {
    logActorWarning("organization", "failed seeding task summary after task creation", {
      organizationId,
      repoId,
      taskId,
      error: resolveErrorMessage(error),
    });
  }

  const auditLog = await getOrCreateAuditLog(c, organizationId);
  void auditLog.append({
    kind: "task.created",
    repoId,
    taskId,
    payload: {
      repoId,
      sandboxProviderId: cmd.sandboxProviderId,
    },
  });

  try {
    const taskSummary = await taskHandle.getTaskSummary({});
    await upsertTaskSummary(c, taskSummary);
  } catch (error) {
    logActorWarning("organization", "failed seeding organization task projection", {
      organizationId,
      repoId,
      taskId,
      error: resolveErrorMessage(error),
    });
  }

  return created;
}

export async function registerTaskBranchMutation(c: any, cmd: RegisterTaskBranchCommand): Promise<{ branchName: string; headSha: string }> {
  const branchName = cmd.branchName.trim();
  if (!branchName) {
    throw new Error("branchName is required");
  }

  const existingOwner = await c.db
    .select({ taskId: taskIndex.taskId })
    .from(taskIndex)
    .where(and(eq(taskIndex.branchName, branchName), eq(taskIndex.repoId, cmd.repoId), ne(taskIndex.taskId, cmd.taskId)))
    .get();

  if (existingOwner) {
    let ownerMissing = false;
    try {
      await getTask(c, c.state.organizationId, cmd.repoId, existingOwner.taskId).get();
    } catch (error) {
      if (isStaleTaskReferenceError(error)) {
        ownerMissing = true;
        await deleteStaleTaskIndexRow(c, existingOwner.taskId);
      } else {
        throw error;
      }
    }
    if (!ownerMissing) {
      throw new Error(`branch is already assigned to a different task: ${branchName}`);
    }
  }

  const branches = await listGitHubBranches(c, cmd.repoId);
  const branchMatch = branches.find((branch) => branch.branchName === branchName) ?? null;
  if (cmd.requireExistingRemote && !branchMatch) {
    throw new Error(`Remote branch not found: ${branchName}`);
  }

  const repository = await resolveGitHubRepository(c, cmd.repoId);
  const defaultBranch = repository?.defaultBranch ?? "main";
  const headSha = branchMatch?.commitSha ?? branches.find((branch) => branch.branchName === defaultBranch)?.commitSha ?? "";

  const now = Date.now();
  await c.db
    .insert(taskIndex)
    .values({
      taskId: cmd.taskId,
      repoId: cmd.repoId,
      branchName,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: taskIndex.taskId,
      set: {
        branchName,
        updatedAt: now,
      },
    })
    .run();

  return { branchName, headSha };
}

export async function applyTaskSummaryUpdateMutation(c: any, input: { taskSummary: WorkspaceTaskSummary }): Promise<void> {
  await upsertTaskSummary(c, input.taskSummary);
  await refreshOrganizationSnapshotMutation(c);
}

export async function removeTaskSummaryMutation(c: any, input: { taskId: string }): Promise<void> {
  await c.db.delete(taskSummaries).where(eq(taskSummaries.taskId, input.taskId)).run();
  await refreshOrganizationSnapshotMutation(c);
}

/**
 * Called for every changed PR during sync and on webhook PR events.
 * Runs in a bulk loop — MUST NOT create task actors or make cross-actor calls
 * to task actors. Only writes to the org's local taskIndex/taskSummaries tables.
 * Task actors are created lazily when the user views the task.
 */
export async function refreshTaskSummaryForBranchMutation(
  c: any,
  input: { repoId: string; branchName: string; pullRequest?: WorkspacePullRequestSummary | null; repoName?: string },
): Promise<void> {
  const pullRequest = input.pullRequest ?? null;
  let rows = await c.db
    .select({ taskId: taskSummaries.taskId })
    .from(taskSummaries)
    .where(and(eq(taskSummaries.branch, input.branchName), eq(taskSummaries.repoId, input.repoId)))
    .all();

  if (rows.length === 0 && pullRequest) {
    // Create a virtual task entry in the org's local tables only.
    // No task actor is spawned — it will be created lazily when the user
    // clicks on the task in the sidebar (the "materialize" path).
    const taskId = randomUUID();
    const now = Date.now();
    const title = pullRequest.title?.trim() || input.branchName;
    const repoName = input.repoName ?? `${c.state.organizationId}/${input.repoId}`;

    await c.db
      .insert(taskIndex)
      .values({ taskId, repoId: input.repoId, branchName: input.branchName, createdAt: now, updatedAt: now })
      .onConflictDoNothing()
      .run();

    await c.db
      .insert(taskSummaries)
      .values({
        taskId,
        repoId: input.repoId,
        title,
        status: "init_complete",
        repoName,
        updatedAtMs: pullRequest.updatedAtMs ?? now,
        branch: input.branchName,
        pullRequestJson: JSON.stringify(pullRequest),
        sessionsSummaryJson: "[]",
      })
      .onConflictDoNothing()
      .run();

    rows = [{ taskId }];
  } else {
    // Update PR data on existing task summaries locally.
    // If a real task actor exists, also notify it.
    for (const row of rows) {
      // Update the local summary with the new PR data
      await c.db
        .update(taskSummaries)
        .set({
          pullRequestJson: pullRequest ? JSON.stringify(pullRequest) : null,
          updatedAtMs: pullRequest?.updatedAtMs ?? Date.now(),
        })
        .where(eq(taskSummaries.taskId, row.taskId))
        .run();

      // Best-effort notify the task actor if it exists (fire-and-forget)
      try {
        const task = getTask(c, c.state.organizationId, input.repoId, row.taskId);
        void task.pullRequestSync({ pullRequest }).catch(() => {});
      } catch {
        // Task actor doesn't exist yet — that's fine, it's virtual
      }
    }
  }

  await refreshOrganizationSnapshotMutation(c);
}

export function sortOverviewBranches(
  branches: Array<{
    branchName: string;
    commitSha: string;
    taskId: string | null;
    taskTitle: string | null;
    taskStatus: TaskRecord["status"] | null;
    pullRequest: WorkspacePullRequestSummary | null;
    ciStatus: string | null;
    updatedAt: number;
  }>,
  defaultBranch: string | null,
) {
  return [...branches].sort((left, right) => {
    if (defaultBranch) {
      if (left.branchName === defaultBranch && right.branchName !== defaultBranch) return -1;
      if (right.branchName === defaultBranch && left.branchName !== defaultBranch) return 1;
    }
    if (Boolean(left.taskId) !== Boolean(right.taskId)) {
      return left.taskId ? -1 : 1;
    }
    if (left.updatedAt !== right.updatedAt) {
      return right.updatedAt - left.updatedAt;
    }
    return left.branchName.localeCompare(right.branchName);
  });
}

export async function listTaskSummariesForRepo(c: any, repoId: string, includeArchived = false): Promise<TaskSummary[]> {
  const rows = await c.db.select().from(taskSummaries).where(eq(taskSummaries.repoId, repoId)).orderBy(desc(taskSummaries.updatedAtMs)).all();
  return rows
    .map((row) => ({
      organizationId: c.state.organizationId,
      repoId,
      taskId: row.taskId,
      branchName: row.branch ?? null,
      title: row.title,
      status: row.status,
      updatedAt: row.updatedAtMs,
      pullRequest: parseJsonValue<WorkspacePullRequestSummary | null>(row.pullRequestJson, null),
    }))
    .filter((row) => includeArchived || row.status !== "archived");
}

export async function listAllTaskSummaries(c: any, includeArchived = false): Promise<TaskSummary[]> {
  const rows = await c.db.select().from(taskSummaries).orderBy(desc(taskSummaries.updatedAtMs)).all();
  return rows
    .map((row) => ({
      organizationId: c.state.organizationId,
      repoId: row.repoId,
      taskId: row.taskId,
      branchName: row.branch ?? null,
      title: row.title,
      status: row.status,
      updatedAt: row.updatedAtMs,
      pullRequest: parseJsonValue<WorkspacePullRequestSummary | null>(row.pullRequestJson, null),
    }))
    .filter((row) => includeArchived || row.status !== "archived");
}

export async function listWorkspaceTaskSummaries(c: any): Promise<WorkspaceTaskSummary[]> {
  const rows = await c.db.select().from(taskSummaries).orderBy(desc(taskSummaries.updatedAtMs)).all();
  return rows.map((row) => taskSummaryFromRow(row.repoId, row));
}

export async function getRepoOverviewFromOrg(c: any, repoId: string): Promise<RepoOverview> {
  const now = Date.now();
  const repository = await resolveGitHubRepository(c, repoId);
  const remoteUrl = await resolveRepositoryRemoteUrl(c, repoId);
  const githubBranches = await listGitHubBranches(c, repoId).catch(() => []);
  const taskRows = await c.db.select().from(taskSummaries).where(eq(taskSummaries.repoId, repoId)).all();

  const taskMetaByBranch = new Map<
    string,
    { taskId: string; title: string | null; status: TaskRecord["status"] | null; updatedAt: number; pullRequest: WorkspacePullRequestSummary | null }
  >();
  for (const row of taskRows) {
    if (!row.branch) {
      continue;
    }
    taskMetaByBranch.set(row.branch, {
      taskId: row.taskId,
      title: row.title ?? null,
      status: row.status,
      updatedAt: row.updatedAtMs,
      pullRequest: parseJsonValue<WorkspacePullRequestSummary | null>(row.pullRequestJson, null),
    });
  }

  const branchMap = new Map<string, { branchName: string; commitSha: string }>();
  for (const branch of githubBranches) {
    branchMap.set(branch.branchName, branch);
  }
  for (const branchName of taskMetaByBranch.keys()) {
    if (!branchMap.has(branchName)) {
      branchMap.set(branchName, { branchName, commitSha: "" });
    }
  }
  if (repository?.defaultBranch && !branchMap.has(repository.defaultBranch)) {
    branchMap.set(repository.defaultBranch, { branchName: repository.defaultBranch, commitSha: "" });
  }

  const branches = sortOverviewBranches(
    [...branchMap.values()].map((branch) => {
      const taskMeta = taskMetaByBranch.get(branch.branchName);
      const pr = taskMeta?.pullRequest ?? null;
      return {
        branchName: branch.branchName,
        commitSha: branch.commitSha,
        taskId: taskMeta?.taskId ?? null,
        taskTitle: taskMeta?.title ?? null,
        taskStatus: taskMeta?.status ?? null,
        pullRequest: pr,
        ciStatus: null,
        updatedAt: Math.max(taskMeta?.updatedAt ?? 0, pr?.updatedAtMs ?? 0, now),
      };
    }),
    repository?.defaultBranch ?? null,
  );

  return {
    organizationId: c.state.organizationId,
    repoId,
    remoteUrl,
    baseRef: repository?.defaultBranch ?? null,
    fetchedAt: now,
    branches,
  };
}

export async function getRepositoryMetadataFromOrg(
  c: any,
  repoId: string,
): Promise<{ defaultBranch: string | null; fullName: string | null; remoteUrl: string }> {
  const repository = await resolveGitHubRepository(c, repoId);
  const remoteUrl = await resolveRepositoryRemoteUrl(c, repoId);
  return {
    defaultBranch: repository?.defaultBranch ?? null,
    fullName: repository?.fullName ?? null,
    remoteUrl,
  };
}

export async function findTaskForBranch(c: any, repoId: string, branchName: string): Promise<{ taskId: string | null }> {
  const row = await c.db
    .select({ taskId: taskSummaries.taskId })
    .from(taskSummaries)
    .where(and(eq(taskSummaries.branch, branchName), eq(taskSummaries.repoId, repoId)))
    .get();
  return { taskId: row?.taskId ?? null };
}
