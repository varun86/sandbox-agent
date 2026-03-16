// @ts-nocheck
import { eq, inArray } from "drizzle-orm";
import { actor } from "rivetkit";
import type { FoundryOrganization } from "@sandbox-agent/foundry-shared";
import { getActorRuntimeContext } from "../context.js";
import { getOrCreateOrganization, getTask } from "../handles.js";
import { repoIdFromRemote } from "../../services/repo.js";
import { resolveOrganizationGithubAuth } from "../../services/github-auth.js";
// actions called directly (no queue)
import { githubDataDb } from "./db/db.js";
import { githubBranches, githubMembers, githubMeta, githubPullRequests, githubRepositories } from "./db/schema.js";
// workflow.ts is no longer used — commands are actions now

const META_ROW_ID = 1;
const SYNC_REPOSITORY_BATCH_SIZE = 10;

type GithubSyncPhase = "discovering_repositories" | "syncing_repositories" | "syncing_branches" | "syncing_members" | "syncing_pull_requests";

interface GithubDataInput {
  organizationId: string;
}

interface GithubMemberRecord {
  id: string;
  login: string;
  name: string;
  email?: string | null;
  role?: string | null;
  state?: string | null;
}

interface GithubRepositoryRecord {
  fullName: string;
  cloneUrl: string;
  private: boolean;
  defaultBranch: string;
}

interface GithubBranchRecord {
  repoId: string;
  branchName: string;
  commitSha: string;
}

interface GithubPullRequestRecord {
  repoId: string;
  repoFullName: string;
  number: number;
  title: string;
  body: string | null;
  state: string;
  url: string;
  headRefName: string;
  baseRefName: string;
  authorLogin: string | null;
  isDraft: boolean;
  updatedAt: number;
}

interface FullSyncInput {
  connectedAccount?: string | null;
  installationStatus?: FoundryOrganization["github"]["installationStatus"];
  installationId?: number | null;
  githubLogin?: string | null;
  kind?: FoundryOrganization["kind"] | null;
  accessToken?: string | null;
  label?: string | null;
}

interface ClearStateInput {
  connectedAccount: string;
  installationStatus: FoundryOrganization["github"]["installationStatus"];
  installationId: number | null;
  label: string;
}

// sendOrganizationCommand removed — org actions called directly

interface PullRequestWebhookInput {
  connectedAccount: string;
  installationStatus: FoundryOrganization["github"]["installationStatus"];
  installationId: number | null;
  repository: {
    fullName: string;
    cloneUrl: string;
    private: boolean;
  };
  pullRequest: {
    number: number;
    title: string;
    body: string | null;
    state: string;
    url: string;
    headRefName: string;
    baseRefName: string;
    authorLogin: string | null;
    isDraft: boolean;
    merged?: boolean;
  };
}

interface GithubMetaState {
  connectedAccount: string;
  installationStatus: FoundryOrganization["github"]["installationStatus"];
  syncStatus: FoundryOrganization["github"]["syncStatus"];
  installationId: number | null;
  lastSyncLabel: string;
  lastSyncAt: number | null;
  syncGeneration: number;
  syncPhase: GithubSyncPhase | null;
  processedRepositoryCount: number;
  totalRepositoryCount: number;
}

function normalizePrStatus(input: { state: string; isDraft?: boolean; merged?: boolean }): "OPEN" | "DRAFT" | "CLOSED" | "MERGED" {
  const state = input.state.trim().toUpperCase();
  if (input.merged || state === "MERGED") return "MERGED";
  if (state === "CLOSED") return "CLOSED";
  return input.isDraft ? "DRAFT" : "OPEN";
}

function pullRequestSummaryFromRow(row: any) {
  return {
    prId: row.prId,
    repoId: row.repoId,
    repoFullName: row.repoFullName,
    number: row.number,
    status: Boolean(row.isDraft) ? "draft" : "ready",
    title: row.title,
    state: row.state,
    url: row.url,
    headRefName: row.headRefName,
    baseRefName: row.baseRefName,
    authorLogin: row.authorLogin ?? null,
    isDraft: Boolean(row.isDraft),
    updatedAtMs: row.updatedAt,
  };
}

function chunkItems<T>(items: T[], size: number): T[][] {
  if (items.length === 0) {
    return [];
  }
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export async function readMeta(c: any): Promise<GithubMetaState> {
  const row = await c.db.select().from(githubMeta).where(eq(githubMeta.id, META_ROW_ID)).get();
  return {
    connectedAccount: row?.connectedAccount ?? "",
    installationStatus: (row?.installationStatus ?? "install_required") as FoundryOrganization["github"]["installationStatus"],
    syncStatus: (row?.syncStatus ?? "pending") as FoundryOrganization["github"]["syncStatus"],
    installationId: row?.installationId ?? null,
    lastSyncLabel: row?.lastSyncLabel ?? "Waiting for first import",
    lastSyncAt: row?.lastSyncAt ?? null,
    syncGeneration: row?.syncGeneration ?? 0,
    syncPhase: (row?.syncPhase ?? null) as GithubSyncPhase | null,
    processedRepositoryCount: row?.processedRepositoryCount ?? 0,
    totalRepositoryCount: row?.totalRepositoryCount ?? 0,
  };
}

async function writeMeta(c: any, patch: Partial<GithubMetaState>) {
  const current = await readMeta(c);
  const next = {
    ...current,
    ...patch,
  };
  await c.db
    .insert(githubMeta)
    .values({
      id: META_ROW_ID,
      connectedAccount: next.connectedAccount,
      installationStatus: next.installationStatus,
      syncStatus: next.syncStatus,
      installationId: next.installationId,
      lastSyncLabel: next.lastSyncLabel,
      lastSyncAt: next.lastSyncAt,
      syncGeneration: next.syncGeneration,
      syncPhase: next.syncPhase,
      processedRepositoryCount: next.processedRepositoryCount,
      totalRepositoryCount: next.totalRepositoryCount,
      updatedAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: githubMeta.id,
      set: {
        connectedAccount: next.connectedAccount,
        installationStatus: next.installationStatus,
        syncStatus: next.syncStatus,
        installationId: next.installationId,
        lastSyncLabel: next.lastSyncLabel,
        lastSyncAt: next.lastSyncAt,
        syncGeneration: next.syncGeneration,
        syncPhase: next.syncPhase,
        processedRepositoryCount: next.processedRepositoryCount,
        totalRepositoryCount: next.totalRepositoryCount,
        updatedAt: Date.now(),
      },
    })
    .run();
  return next;
}

async function publishSyncProgress(c: any, patch: Partial<GithubMetaState>): Promise<GithubMetaState> {
  const meta = await writeMeta(c, patch);
  const organization = await getOrCreateOrganization(c, c.state.organizationId);
  await organization.commandApplyGithubSyncProgress({
    connectedAccount: meta.connectedAccount,
    installationStatus: meta.installationStatus,
    installationId: meta.installationId,
    syncStatus: meta.syncStatus,
    lastSyncLabel: meta.lastSyncLabel,
    lastSyncAt: meta.lastSyncAt,
    syncGeneration: meta.syncGeneration,
    syncPhase: meta.syncPhase,
    processedRepositoryCount: meta.processedRepositoryCount,
    totalRepositoryCount: meta.totalRepositoryCount,
  });
  return meta;
}

async function getOrganizationContext(c: any, overrides?: FullSyncInput) {
  // Try to read the org profile for fallback values, but don't require it.
  // Webhook-triggered syncs can arrive before the user signs in and creates the
  // org profile row. The webhook callers already pass the necessary overrides
  // (connectedAccount, installationId, githubLogin, kind), so we can proceed
  // without the profile as long as overrides cover the required fields.
  const organizationHandle = await getOrCreateOrganization(c, c.state.organizationId);
  const organizationState = await organizationHandle.getOrganizationShellStateIfInitialized({});

  // If the org profile doesn't exist and overrides don't provide enough context, fail.
  if (!organizationState && !overrides?.connectedAccount) {
    throw new Error(`Organization ${c.state.organizationId} is not initialized and no override context was provided`);
  }

  const auth = await resolveOrganizationGithubAuth(c, c.state.organizationId);
  return {
    kind: overrides?.kind ?? organizationState?.snapshot.kind,
    githubLogin: overrides?.githubLogin ?? organizationState?.githubLogin,
    connectedAccount: overrides?.connectedAccount ?? organizationState?.snapshot.github.connectedAccount ?? organizationState?.githubLogin,
    installationId: overrides?.installationId ?? organizationState?.githubInstallationId ?? null,
    installationStatus:
      overrides?.installationStatus ??
      organizationState?.snapshot.github.installationStatus ??
      (organizationState?.snapshot.kind === "personal" ? "connected" : "reconnect_required"),
    accessToken: overrides?.accessToken ?? auth?.githubToken ?? null,
  };
}

async function upsertRepositories(c: any, repositories: GithubRepositoryRecord[], updatedAt: number, syncGeneration: number) {
  for (const repository of repositories) {
    await c.db
      .insert(githubRepositories)
      .values({
        repoId: repoIdFromRemote(repository.cloneUrl),
        fullName: repository.fullName,
        cloneUrl: repository.cloneUrl,
        private: repository.private ? 1 : 0,
        defaultBranch: repository.defaultBranch,
        syncGeneration,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: githubRepositories.repoId,
        set: {
          fullName: repository.fullName,
          cloneUrl: repository.cloneUrl,
          private: repository.private ? 1 : 0,
          defaultBranch: repository.defaultBranch,
          syncGeneration,
          updatedAt,
        },
      })
      .run();
  }
}

async function sweepRepositories(c: any, syncGeneration: number) {
  const rows = await c.db.select({ repoId: githubRepositories.repoId, syncGeneration: githubRepositories.syncGeneration }).from(githubRepositories).all();
  for (const row of rows) {
    if (row.syncGeneration === syncGeneration) {
      continue;
    }
    await c.db.delete(githubRepositories).where(eq(githubRepositories.repoId, row.repoId)).run();
  }
}

async function upsertBranches(c: any, branches: GithubBranchRecord[], updatedAt: number, syncGeneration: number) {
  for (const branch of branches) {
    await c.db
      .insert(githubBranches)
      .values({
        branchId: `${branch.repoId}:${branch.branchName}`,
        repoId: branch.repoId,
        branchName: branch.branchName,
        commitSha: branch.commitSha,
        syncGeneration,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: githubBranches.branchId,
        set: {
          repoId: branch.repoId,
          branchName: branch.branchName,
          commitSha: branch.commitSha,
          syncGeneration,
          updatedAt,
        },
      })
      .run();
  }
}

async function sweepBranches(c: any, syncGeneration: number) {
  const rows = await c.db.select({ branchId: githubBranches.branchId, syncGeneration: githubBranches.syncGeneration }).from(githubBranches).all();
  for (const row of rows) {
    if (row.syncGeneration === syncGeneration) {
      continue;
    }
    await c.db.delete(githubBranches).where(eq(githubBranches.branchId, row.branchId)).run();
  }
}

async function upsertMembers(c: any, members: GithubMemberRecord[], updatedAt: number, syncGeneration: number) {
  for (const member of members) {
    await c.db
      .insert(githubMembers)
      .values({
        memberId: member.id,
        login: member.login,
        displayName: member.name || member.login,
        email: member.email ?? null,
        role: member.role ?? null,
        state: member.state ?? "active",
        syncGeneration,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: githubMembers.memberId,
        set: {
          login: member.login,
          displayName: member.name || member.login,
          email: member.email ?? null,
          role: member.role ?? null,
          state: member.state ?? "active",
          syncGeneration,
          updatedAt,
        },
      })
      .run();
  }
}

async function sweepMembers(c: any, syncGeneration: number) {
  const rows = await c.db.select({ memberId: githubMembers.memberId, syncGeneration: githubMembers.syncGeneration }).from(githubMembers).all();
  for (const row of rows) {
    if (row.syncGeneration === syncGeneration) {
      continue;
    }
    await c.db.delete(githubMembers).where(eq(githubMembers.memberId, row.memberId)).run();
  }
}

async function upsertPullRequests(c: any, pullRequests: GithubPullRequestRecord[], syncGeneration: number) {
  for (const pullRequest of pullRequests) {
    await c.db
      .insert(githubPullRequests)
      .values({
        prId: `${pullRequest.repoId}#${pullRequest.number}`,
        repoId: pullRequest.repoId,
        repoFullName: pullRequest.repoFullName,
        number: pullRequest.number,
        title: pullRequest.title,
        body: pullRequest.body ?? null,
        state: pullRequest.state,
        url: pullRequest.url,
        headRefName: pullRequest.headRefName,
        baseRefName: pullRequest.baseRefName,
        authorLogin: pullRequest.authorLogin ?? null,
        isDraft: pullRequest.isDraft ? 1 : 0,
        syncGeneration,
        updatedAt: pullRequest.updatedAt,
      })
      .onConflictDoUpdate({
        target: githubPullRequests.prId,
        set: {
          repoId: pullRequest.repoId,
          repoFullName: pullRequest.repoFullName,
          number: pullRequest.number,
          title: pullRequest.title,
          body: pullRequest.body ?? null,
          state: pullRequest.state,
          url: pullRequest.url,
          headRefName: pullRequest.headRefName,
          baseRefName: pullRequest.baseRefName,
          authorLogin: pullRequest.authorLogin ?? null,
          isDraft: pullRequest.isDraft ? 1 : 0,
          syncGeneration,
          updatedAt: pullRequest.updatedAt,
        },
      })
      .run();
  }
}

async function sweepPullRequests(c: any, syncGeneration: number) {
  const rows = await c.db.select({ prId: githubPullRequests.prId, syncGeneration: githubPullRequests.syncGeneration }).from(githubPullRequests).all();
  for (const row of rows) {
    if (row.syncGeneration === syncGeneration) {
      continue;
    }
    await c.db.delete(githubPullRequests).where(eq(githubPullRequests.prId, row.prId)).run();
  }
}

async function refreshTaskSummaryForBranch(c: any, repoId: string, branchName: string, pullRequest: ReturnType<typeof pullRequestSummaryFromRow> | null) {
  const repositoryRecord = await c.db.select().from(githubRepositories).where(eq(githubRepositories.repoId, repoId)).get();
  if (!repositoryRecord) {
    return;
  }
  const organization = await getOrCreateOrganization(c, c.state.organizationId);
  void organization.commandRefreshTaskSummaryForBranch({ repoId, branchName, pullRequest, repoName: repositoryRecord.fullName ?? undefined }).catch(() => {});
}

async function emitPullRequestChangeEvents(c: any, beforeRows: any[], afterRows: any[]) {
  const beforeById = new Map(beforeRows.map((row) => [row.prId, row]));
  const afterById = new Map(afterRows.map((row) => [row.prId, row]));

  for (const [prId, row] of afterById) {
    const previous = beforeById.get(prId);
    const changed =
      !previous ||
      previous.title !== row.title ||
      previous.state !== row.state ||
      previous.url !== row.url ||
      previous.headRefName !== row.headRefName ||
      previous.baseRefName !== row.baseRefName ||
      previous.authorLogin !== row.authorLogin ||
      previous.isDraft !== row.isDraft ||
      previous.updatedAt !== row.updatedAt;
    if (!changed) {
      continue;
    }
    await refreshTaskSummaryForBranch(c, row.repoId, row.headRefName, pullRequestSummaryFromRow(row));
  }

  for (const [prId, row] of beforeById) {
    if (afterById.has(prId)) {
      continue;
    }
    await refreshTaskSummaryForBranch(c, row.repoId, row.headRefName, null);
  }
}

async function autoArchiveTaskForClosedPullRequest(c: any, row: any) {
  const repositoryRecord = await c.db.select().from(githubRepositories).where(eq(githubRepositories.repoId, row.repoId)).get();
  if (!repositoryRecord) {
    return;
  }
  const organization = await getOrCreateOrganization(c, c.state.organizationId);
  const match = await organization.findTaskForBranch({
    repoId: row.repoId,
    branchName: row.headRefName,
  });
  if (!match?.taskId) {
    return;
  }
  try {
    const task = getTask(c, c.state.organizationId, row.repoId, match.taskId);
    void task.archive({ reason: `PR ${String(row.state).toLowerCase()}` }).catch(() => {});
  } catch {
    // Best-effort only. Task summary refresh will still clear the PR state.
  }
}

async function resolveRepositories(c: any, context: Awaited<ReturnType<typeof getOrganizationContext>>): Promise<GithubRepositoryRecord[]> {
  const { appShell } = getActorRuntimeContext();
  if (context.kind === "personal") {
    if (!context.accessToken) {
      return [];
    }
    return await appShell.github.listUserRepositories(context.accessToken);
  }

  if (context.installationId != null) {
    try {
      return await appShell.github.listInstallationRepositories(context.installationId);
    } catch (error) {
      if (!context.accessToken) {
        throw error;
      }
    }
  }

  if (!context.accessToken) {
    return [];
  }

  return (await appShell.github.listUserRepositories(context.accessToken)).filter((repository) => repository.fullName.startsWith(`${context.githubLogin}/`));
}

async function resolveMembers(c: any, context: Awaited<ReturnType<typeof getOrganizationContext>>): Promise<GithubMemberRecord[]> {
  const { appShell } = getActorRuntimeContext();
  if (context.kind === "personal") {
    return [];
  }
  if (context.installationId != null) {
    try {
      return await appShell.github.listInstallationMembers(context.installationId, context.githubLogin);
    } catch (error) {
      if (!context.accessToken) {
        throw error;
      }
    }
  }
  if (!context.accessToken) {
    return [];
  }
  return await appShell.github.listOrganizationMembers(context.accessToken, context.githubLogin);
}

async function listPullRequestsForRepositories(
  context: Awaited<ReturnType<typeof getOrganizationContext>>,
  repositories: GithubRepositoryRecord[],
): Promise<GithubPullRequestRecord[]> {
  const { appShell } = getActorRuntimeContext();
  if (repositories.length === 0) {
    return [];
  }

  let pullRequests: Array<{
    repoFullName: string;
    cloneUrl: string;
    number: number;
    title: string;
    body?: string | null;
    state: string;
    url: string;
    headRefName: string;
    baseRefName: string;
    authorLogin?: string | null;
    isDraft?: boolean;
    merged?: boolean;
  }> = [];

  if (context.installationId != null) {
    try {
      pullRequests = await appShell.github.listInstallationPullRequestsForRepositories(context.installationId, repositories);
    } catch (error) {
      if (!context.accessToken) {
        throw error;
      }
    }
  }

  if (pullRequests.length === 0 && context.accessToken) {
    pullRequests = await appShell.github.listPullRequestsForUserRepositories(context.accessToken, repositories);
  }

  return pullRequests.map((pullRequest) => ({
    repoId: repoIdFromRemote(pullRequest.cloneUrl),
    repoFullName: pullRequest.repoFullName,
    number: pullRequest.number,
    title: pullRequest.title,
    body: pullRequest.body ?? null,
    state: normalizePrStatus(pullRequest),
    url: pullRequest.url,
    headRefName: pullRequest.headRefName,
    baseRefName: pullRequest.baseRefName,
    authorLogin: pullRequest.authorLogin ?? null,
    isDraft: Boolean(pullRequest.isDraft),
    updatedAt: Date.now(),
  }));
}

async function listRepositoryBranchesForContext(
  context: Awaited<ReturnType<typeof getOrganizationContext>>,
  repository: GithubRepositoryRecord,
): Promise<GithubBranchRecord[]> {
  const { appShell } = getActorRuntimeContext();
  let branches: Array<{ name: string; commitSha: string }> = [];

  if (context.installationId != null) {
    try {
      branches = await appShell.github.listInstallationRepositoryBranches(context.installationId, repository.fullName);
    } catch (error) {
      if (!context.accessToken) {
        throw error;
      }
    }
  }

  if (branches.length === 0 && context.accessToken) {
    branches = await appShell.github.listUserRepositoryBranches(context.accessToken, repository.fullName);
  }

  const repoId = repoIdFromRemote(repository.cloneUrl);
  return branches.map((branch) => ({
    repoId,
    branchName: branch.name,
    commitSha: branch.commitSha,
  }));
}

async function refreshRepositoryBranches(
  c: any,
  context: Awaited<ReturnType<typeof getOrganizationContext>>,
  repository: GithubRepositoryRecord,
  updatedAt: number,
): Promise<void> {
  const currentMeta = await readMeta(c);
  const nextBranches = await listRepositoryBranchesForContext(context, repository);
  await c.db
    .delete(githubBranches)
    .where(eq(githubBranches.repoId, repoIdFromRemote(repository.cloneUrl)))
    .run();

  for (const branch of nextBranches) {
    await c.db
      .insert(githubBranches)
      .values({
        branchId: `${branch.repoId}:${branch.branchName}`,
        repoId: branch.repoId,
        branchName: branch.branchName,
        commitSha: branch.commitSha,
        syncGeneration: currentMeta.syncGeneration,
        updatedAt,
      })
      .run();
  }
}

async function readAllPullRequestRows(c: any) {
  return await c.db.select().from(githubPullRequests).all();
}

/** Config returned by fullSyncSetup, passed to subsequent sync phases. */
export interface FullSyncConfig {
  syncGeneration: number;
  startedAt: number;
  totalRepositoryCount: number;
  connectedAccount: string;
  installationStatus: string;
  installationId: number | null;
  beforePrRows: any[];
}

async function readRepositoriesFromDb(c: any): Promise<GithubRepositoryRecord[]> {
  const rows = await c.db.select().from(githubRepositories).all();
  return rows.map((r: any) => ({
    fullName: r.fullName,
    cloneUrl: r.cloneUrl,
    private: Boolean(r.private),
    defaultBranch: r.defaultBranch,
  }));
}

/**
 * Phase 1: Discover repositories and persist them.
 * Returns the config needed by all subsequent phases, or null if nothing to do.
 */
export async function fullSyncSetup(c: any, input: FullSyncInput = {}): Promise<FullSyncConfig> {
  const startedAt = Date.now();
  const beforePrRows = await readAllPullRequestRows(c);
  const currentMeta = await readMeta(c);
  const context = await getOrganizationContext(c, input);
  const syncGeneration = currentMeta.syncGeneration + 1;

  await publishSyncProgress(c, {
    connectedAccount: context.connectedAccount,
    installationStatus: context.installationStatus,
    installationId: context.installationId,
    syncStatus: "syncing",
    lastSyncLabel: input.label?.trim() || "Syncing GitHub data...",
    syncGeneration,
    syncPhase: "discovering_repositories",
    processedRepositoryCount: 0,
    totalRepositoryCount: 0,
  });

  const repositories = await resolveRepositories(c, context);
  const totalRepositoryCount = repositories.length;

  await publishSyncProgress(c, {
    connectedAccount: context.connectedAccount,
    installationStatus: context.installationStatus,
    installationId: context.installationId,
    syncStatus: "syncing",
    lastSyncLabel: totalRepositoryCount > 0 ? `Importing ${totalRepositoryCount} repositories...` : "No repositories available",
    syncGeneration,
    syncPhase: "syncing_repositories",
    processedRepositoryCount: totalRepositoryCount,
    totalRepositoryCount,
  });

  await upsertRepositories(c, repositories, startedAt, syncGeneration);

  return {
    syncGeneration,
    startedAt,
    totalRepositoryCount,
    connectedAccount: context.connectedAccount,
    installationStatus: context.installationStatus,
    installationId: context.installationId,
    beforePrRows,
  };
}

/**
 * Phase 2 (per-batch): Fetch and upsert branches for one batch of repos.
 * Returns true when all batches have been processed.
 */
export async function fullSyncBranchBatch(c: any, config: FullSyncConfig, batchIndex: number): Promise<boolean> {
  const repos = await readRepositoriesFromDb(c);
  const batches = chunkItems(repos, SYNC_REPOSITORY_BATCH_SIZE);
  if (batchIndex >= batches.length) return true;

  const batch = batches[batchIndex]!;
  const context = await getOrganizationContext(c, {
    connectedAccount: config.connectedAccount,
    installationStatus: config.installationStatus as any,
    installationId: config.installationId,
  });
  const batchBranches = (await Promise.all(batch.map((repo) => listRepositoryBranchesForContext(context, repo)))).flat();
  await upsertBranches(c, batchBranches, config.startedAt, config.syncGeneration);

  const processedCount = Math.min((batchIndex + 1) * SYNC_REPOSITORY_BATCH_SIZE, repos.length);
  await publishSyncProgress(c, {
    connectedAccount: config.connectedAccount,
    installationStatus: config.installationStatus,
    installationId: config.installationId,
    syncStatus: "syncing",
    lastSyncLabel: `Synced branches for ${processedCount} of ${repos.length} repositories`,
    syncGeneration: config.syncGeneration,
    syncPhase: "syncing_branches",
    processedRepositoryCount: processedCount,
    totalRepositoryCount: repos.length,
  });

  return false;
}

/**
 * Phase 3: Resolve, upsert, and sweep members.
 */
export async function fullSyncMembers(c: any, config: FullSyncConfig): Promise<void> {
  await publishSyncProgress(c, {
    connectedAccount: config.connectedAccount,
    installationStatus: config.installationStatus,
    installationId: config.installationId,
    syncStatus: "syncing",
    lastSyncLabel: "Syncing GitHub members...",
    syncGeneration: config.syncGeneration,
    syncPhase: "syncing_members",
    processedRepositoryCount: config.totalRepositoryCount,
    totalRepositoryCount: config.totalRepositoryCount,
  });

  const context = await getOrganizationContext(c, {
    connectedAccount: config.connectedAccount,
    installationStatus: config.installationStatus as any,
    installationId: config.installationId,
  });
  const members = await resolveMembers(c, context);
  await upsertMembers(c, members, config.startedAt, config.syncGeneration);
  await sweepMembers(c, config.syncGeneration);
}

/**
 * Phase 4 (per-batch): Fetch and upsert pull requests for one batch of repos.
 * Returns true when all batches have been processed.
 */
export async function fullSyncPullRequestBatch(c: any, config: FullSyncConfig, batchIndex: number): Promise<boolean> {
  const repos = await readRepositoriesFromDb(c);
  const batches = chunkItems(repos, SYNC_REPOSITORY_BATCH_SIZE);
  if (batchIndex >= batches.length) return true;

  const batch = batches[batchIndex]!;
  const context = await getOrganizationContext(c, {
    connectedAccount: config.connectedAccount,
    installationStatus: config.installationStatus as any,
    installationId: config.installationId,
  });
  const batchPRs = await listPullRequestsForRepositories(context, batch);
  await upsertPullRequests(c, batchPRs, config.syncGeneration);

  const processedCount = Math.min((batchIndex + 1) * SYNC_REPOSITORY_BATCH_SIZE, repos.length);
  await publishSyncProgress(c, {
    connectedAccount: config.connectedAccount,
    installationStatus: config.installationStatus,
    installationId: config.installationId,
    syncStatus: "syncing",
    lastSyncLabel: `Synced pull requests for ${processedCount} of ${repos.length} repositories`,
    syncGeneration: config.syncGeneration,
    syncPhase: "syncing_pull_requests",
    processedRepositoryCount: processedCount,
    totalRepositoryCount: repos.length,
  });

  return false;
}

/**
 * Phase 5: Sweep stale data, publish final state, emit PR change events.
 */
export async function fullSyncFinalize(c: any, config: FullSyncConfig): Promise<void> {
  await sweepBranches(c, config.syncGeneration);
  await sweepPullRequests(c, config.syncGeneration);
  await sweepRepositories(c, config.syncGeneration);

  await publishSyncProgress(c, {
    connectedAccount: config.connectedAccount,
    installationStatus: config.installationStatus,
    installationId: config.installationId,
    syncStatus: "synced",
    lastSyncLabel: config.totalRepositoryCount > 0 ? `Synced ${config.totalRepositoryCount} repositories` : "No repositories available",
    lastSyncAt: config.startedAt,
    syncGeneration: config.syncGeneration,
    syncPhase: null,
    processedRepositoryCount: config.totalRepositoryCount,
    totalRepositoryCount: config.totalRepositoryCount,
  });

  const afterRows = await readAllPullRequestRows(c);
  await emitPullRequestChangeEvents(c, config.beforePrRows, afterRows);
}

/**
 * Error handler: publish error sync state when a full sync fails.
 */
/**
 * Single-shot full sync: runs all phases (setup, branches, members, PRs, finalize)
 * using native JS loops. This must NOT use workflow primitives (step/loop/sleep)
 * because it runs inside a workflow step. See workflow.ts for context on why
 * sub-loops cause HistoryDivergedError.
 */
export async function runFullSync(c: any, input: FullSyncInput = {}): Promise<void> {
  const config = await fullSyncSetup(c, input);

  // Branches — native loop over batches
  for (let i = 0; ; i++) {
    const done = await fullSyncBranchBatch(c, config, i);
    if (done) break;
  }

  // Members
  await fullSyncMembers(c, config);

  // Pull requests — native loop over batches
  for (let i = 0; ; i++) {
    const done = await fullSyncPullRequestBatch(c, config, i);
    if (done) break;
  }

  // Finalize
  await fullSyncFinalize(c, config);
}

export async function fullSyncError(c: any, error: unknown): Promise<void> {
  const currentMeta = await readMeta(c);
  const message = error instanceof Error ? error.message : "GitHub import failed";
  await publishSyncProgress(c, {
    connectedAccount: currentMeta.connectedAccount,
    installationStatus: currentMeta.installationStatus,
    installationId: currentMeta.installationId,
    syncStatus: "error",
    lastSyncLabel: message,
    syncGeneration: currentMeta.syncGeneration,
    syncPhase: null,
    processedRepositoryCount: 0,
    totalRepositoryCount: 0,
  });
}

export const githubData = actor({
  db: githubDataDb,
  options: {
    name: "GitHub Data",
    icon: "github",
    actionTimeout: 10 * 60_000,
  },
  createState: (_c, input: GithubDataInput) => ({
    organizationId: input.organizationId,
  }),
  actions: {
    async getSummary(c) {
      const repositories = await c.db.select().from(githubRepositories).all();
      const branches = await c.db.select().from(githubBranches).all();
      const members = await c.db.select().from(githubMembers).all();
      const pullRequests = await c.db.select().from(githubPullRequests).all();
      return {
        ...(await readMeta(c)),
        repositoryCount: repositories.length,
        branchCount: branches.length,
        memberCount: members.length,
        pullRequestCount: pullRequests.length,
      };
    },

    async listRepositories(c) {
      const rows = await c.db.select().from(githubRepositories).all();
      return rows.map((row) => ({
        repoId: row.repoId,
        fullName: row.fullName,
        cloneUrl: row.cloneUrl,
        private: Boolean(row.private),
        defaultBranch: row.defaultBranch,
      }));
    },

    async getRepository(c, input: { repoId: string }) {
      const row = await c.db.select().from(githubRepositories).where(eq(githubRepositories.repoId, input.repoId)).get();
      if (!row) {
        return null;
      }
      return {
        repoId: row.repoId,
        fullName: row.fullName,
        cloneUrl: row.cloneUrl,
        private: Boolean(row.private),
        defaultBranch: row.defaultBranch,
      };
    },

    async listOpenPullRequests(c) {
      const rows = await c.db
        .select()
        .from(githubPullRequests)
        .where(inArray(githubPullRequests.state, ["OPEN", "DRAFT"]))
        .all();
      return rows.map((row) => pullRequestSummaryFromRow(row));
    },

    async listBranchesForRepository(c, input: { repoId: string }) {
      const rows = await c.db.select().from(githubBranches).where(eq(githubBranches.repoId, input.repoId)).all();
      return rows
        .map((row) => ({
          branchName: row.branchName,
          commitSha: row.commitSha,
        }))
        .sort((left, right) => left.branchName.localeCompare(right.branchName));
    },

    async syncRepos(c, body: any) {
      try {
        await runFullSync(c, body);
        return { ok: true };
      } catch (error) {
        try {
          await fullSyncError(c, error);
        } catch {
          /* best effort */
        }
        throw error;
      }
    },

    async reloadRepository(c, body: { repoId: string }) {
      return await reloadRepositoryMutation(c, body);
    },

    async clearState(c, body: any) {
      await clearStateMutation(c, body);
      return { ok: true };
    },

    async handlePullRequestWebhook(c, body: any) {
      await handlePullRequestWebhookMutation(c, body);
      return { ok: true };
    },
  },
});

export async function reloadRepositoryMutation(c: any, input: { repoId: string }) {
  const context = await getOrganizationContext(c);
  const current = await c.db.select().from(githubRepositories).where(eq(githubRepositories.repoId, input.repoId)).get();
  if (!current) {
    throw new Error(`Unknown GitHub repository: ${input.repoId}`);
  }
  const { appShell } = getActorRuntimeContext();
  const repository =
    context.installationId != null
      ? await appShell.github.getInstallationRepository(context.installationId, current.fullName)
      : context.accessToken
        ? await appShell.github.getUserRepository(context.accessToken, current.fullName)
        : null;
  if (!repository) {
    throw new Error(`Unable to reload repository: ${current.fullName}`);
  }

  const updatedAt = Date.now();
  const currentMeta = await readMeta(c);
  await c.db
    .insert(githubRepositories)
    .values({
      repoId: input.repoId,
      fullName: repository.fullName,
      cloneUrl: repository.cloneUrl,
      private: repository.private ? 1 : 0,
      defaultBranch: repository.defaultBranch,
      syncGeneration: currentMeta.syncGeneration,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: githubRepositories.repoId,
      set: {
        fullName: repository.fullName,
        cloneUrl: repository.cloneUrl,
        private: repository.private ? 1 : 0,
        defaultBranch: repository.defaultBranch,
        syncGeneration: currentMeta.syncGeneration,
        updatedAt,
      },
    })
    .run();
  await refreshRepositoryBranches(
    c,
    context,
    {
      fullName: repository.fullName,
      cloneUrl: repository.cloneUrl,
      private: repository.private,
      defaultBranch: repository.defaultBranch,
    },
    updatedAt,
  );

  return {
    repoId: input.repoId,
    fullName: repository.fullName,
    cloneUrl: repository.cloneUrl,
    private: repository.private,
    defaultBranch: repository.defaultBranch,
  };
}

export async function clearStateMutation(c: any, input: ClearStateInput) {
  const beforeRows = await readAllPullRequestRows(c);
  const currentMeta = await readMeta(c);
  await c.db.delete(githubPullRequests).run();
  await c.db.delete(githubBranches).run();
  await c.db.delete(githubRepositories).run();
  await c.db.delete(githubMembers).run();
  await writeMeta(c, {
    connectedAccount: input.connectedAccount,
    installationStatus: input.installationStatus,
    installationId: input.installationId,
    syncStatus: "pending",
    lastSyncLabel: input.label,
    lastSyncAt: null,
    syncGeneration: currentMeta.syncGeneration,
    syncPhase: null,
    processedRepositoryCount: 0,
    totalRepositoryCount: 0,
  });

  await emitPullRequestChangeEvents(c, beforeRows, []);
}

export async function handlePullRequestWebhookMutation(c: any, input: PullRequestWebhookInput) {
  const beforeRows = await readAllPullRequestRows(c);
  const repoId = repoIdFromRemote(input.repository.cloneUrl);
  const currentRepository = await c.db.select().from(githubRepositories).where(eq(githubRepositories.repoId, repoId)).get();
  const updatedAt = Date.now();
  const currentMeta = await readMeta(c);
  const state = normalizePrStatus(input.pullRequest);
  const prId = `${repoId}#${input.pullRequest.number}`;

  await c.db
    .insert(githubRepositories)
    .values({
      repoId,
      fullName: input.repository.fullName,
      cloneUrl: input.repository.cloneUrl,
      private: input.repository.private ? 1 : 0,
      defaultBranch: currentRepository?.defaultBranch ?? input.pullRequest.baseRefName ?? "main",
      syncGeneration: currentMeta.syncGeneration,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: githubRepositories.repoId,
      set: {
        fullName: input.repository.fullName,
        cloneUrl: input.repository.cloneUrl,
        private: input.repository.private ? 1 : 0,
        defaultBranch: currentRepository?.defaultBranch ?? input.pullRequest.baseRefName ?? "main",
        syncGeneration: currentMeta.syncGeneration,
        updatedAt,
      },
    })
    .run();

  if (state === "CLOSED" || state === "MERGED") {
    await c.db.delete(githubPullRequests).where(eq(githubPullRequests.prId, prId)).run();
  } else {
    await c.db
      .insert(githubPullRequests)
      .values({
        prId,
        repoId,
        repoFullName: input.repository.fullName,
        number: input.pullRequest.number,
        title: input.pullRequest.title,
        body: input.pullRequest.body ?? null,
        state,
        url: input.pullRequest.url,
        headRefName: input.pullRequest.headRefName,
        baseRefName: input.pullRequest.baseRefName,
        authorLogin: input.pullRequest.authorLogin ?? null,
        isDraft: input.pullRequest.isDraft ? 1 : 0,
        syncGeneration: currentMeta.syncGeneration,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: githubPullRequests.prId,
        set: {
          title: input.pullRequest.title,
          body: input.pullRequest.body ?? null,
          state,
          url: input.pullRequest.url,
          headRefName: input.pullRequest.headRefName,
          baseRefName: input.pullRequest.baseRefName,
          authorLogin: input.pullRequest.authorLogin ?? null,
          isDraft: input.pullRequest.isDraft ? 1 : 0,
          syncGeneration: currentMeta.syncGeneration,
          updatedAt,
        },
      })
      .run();
  }

  await publishSyncProgress(c, {
    connectedAccount: input.connectedAccount,
    installationStatus: input.installationStatus,
    installationId: input.installationId,
    syncStatus: "synced",
    lastSyncLabel: "GitHub webhook received",
    lastSyncAt: updatedAt,
    syncPhase: null,
    processedRepositoryCount: 0,
    totalRepositoryCount: 0,
  });

  const afterRows = await readAllPullRequestRows(c);
  await emitPullRequestChangeEvents(c, beforeRows, afterRows);
  if (state === "CLOSED" || state === "MERGED") {
    const previous = beforeRows.find((row) => row.prId === prId);
    if (previous) {
      await autoArchiveTaskForClosedPullRequest(c, {
        ...previous,
        state,
      });
    }
  }
}
