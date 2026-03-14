// @ts-nocheck
import { eq } from "drizzle-orm";
import { resolveCreateFlowDecision } from "../../../services/create-flow.js";
import { resolveWorkspaceGithubAuth } from "../../../services/github-auth.js";
import { getActorRuntimeContext } from "../../context.js";
import { getOrCreateHistory, getOrCreateProject, selfTask } from "../../handles.js";
import { logActorWarning, resolveErrorMessage } from "../../logging.js";
import { defaultSandboxProviderId } from "../../../sandbox-config.js";
import { task as taskTable, taskRuntime } from "../db/schema.js";
import { TASK_ROW_ID, appendHistory, collectErrorMessages, resolveErrorDetail, setTaskState } from "./common.js";
import { taskWorkflowQueueName } from "./queue.js";

async function ensureTaskRuntimeCacheColumns(db: any): Promise<void> {
  await db.execute(`ALTER TABLE task_runtime ADD COLUMN git_state_json text`).catch(() => {});
  await db.execute(`ALTER TABLE task_runtime ADD COLUMN git_state_updated_at integer`).catch(() => {});
  await db.execute(`ALTER TABLE task_runtime ADD COLUMN provision_stage text`).catch(() => {});
  await db.execute(`ALTER TABLE task_runtime ADD COLUMN provision_stage_updated_at integer`).catch(() => {});
}

export async function initBootstrapDbActivity(loopCtx: any, body: any): Promise<void> {
  const { config } = getActorRuntimeContext();
  const providerId = body?.providerId ?? loopCtx.state.providerId ?? defaultSandboxProviderId(config);
  const now = Date.now();
  const initialStatusMessage = loopCtx.state.branchName && loopCtx.state.title ? "provisioning" : "naming";

  await ensureTaskRuntimeCacheColumns(loopCtx.db);

  await loopCtx.db
    .insert(taskTable)
    .values({
      id: TASK_ROW_ID,
      branchName: loopCtx.state.branchName,
      title: loopCtx.state.title,
      task: loopCtx.state.task,
      providerId,
      status: "init_bootstrap_db",
      agentType: loopCtx.state.agentType ?? config.default_agent,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: taskTable.id,
      set: {
        branchName: loopCtx.state.branchName,
        title: loopCtx.state.title,
        task: loopCtx.state.task,
        providerId,
        status: "init_bootstrap_db",
        agentType: loopCtx.state.agentType ?? config.default_agent,
        updatedAt: now,
      },
    })
    .run();

  await loopCtx.db
    .insert(taskRuntime)
    .values({
      id: TASK_ROW_ID,
      activeSandboxId: null,
      activeSessionId: null,
      activeSwitchTarget: null,
      activeCwd: null,
      statusMessage: initialStatusMessage,
      gitStateJson: null,
      gitStateUpdatedAt: null,
      provisionStage: "queued",
      provisionStageUpdatedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: taskRuntime.id,
      set: {
        activeSandboxId: null,
        activeSessionId: null,
        activeSwitchTarget: null,
        activeCwd: null,
        statusMessage: initialStatusMessage,
        provisionStage: "queued",
        provisionStageUpdatedAt: now,
        updatedAt: now,
      },
    })
    .run();
}

export async function initEnqueueProvisionActivity(loopCtx: any, body: any): Promise<void> {
  await setTaskState(loopCtx, "init_enqueue_provision", "provision queued");
  await loopCtx.db
    .update(taskRuntime)
    .set({
      provisionStage: "queued",
      provisionStageUpdatedAt: Date.now(),
      updatedAt: Date.now(),
    })
    .where(eq(taskRuntime.id, TASK_ROW_ID))
    .run();

  const self = selfTask(loopCtx);
  try {
    await self.send(taskWorkflowQueueName("task.command.provision"), body, {
      wait: false,
    });
  } catch (error) {
    logActorWarning("task.init", "background provision command failed", {
      workspaceId: loopCtx.state.workspaceId,
      repoId: loopCtx.state.repoId,
      taskId: loopCtx.state.taskId,
      error: resolveErrorMessage(error),
    });
    throw error;
  }
}

export async function initEnsureNameActivity(loopCtx: any): Promise<void> {
  await setTaskState(loopCtx, "init_ensure_name", "determining title and branch");
  const existing = await loopCtx.db
    .select({
      branchName: taskTable.branchName,
      title: taskTable.title,
    })
    .from(taskTable)
    .where(eq(taskTable.id, TASK_ROW_ID))
    .get();

  if (existing?.branchName && existing?.title) {
    loopCtx.state.branchName = existing.branchName;
    loopCtx.state.title = existing.title;
    return;
  }

  const { driver } = getActorRuntimeContext();
  const auth = await resolveWorkspaceGithubAuth(loopCtx, loopCtx.state.workspaceId);
  let repoLocalPath = loopCtx.state.repoLocalPath;
  if (!repoLocalPath) {
    const project = await getOrCreateProject(loopCtx, loopCtx.state.workspaceId, loopCtx.state.repoId, loopCtx.state.repoRemote);
    const result = await project.ensure({ remoteUrl: loopCtx.state.repoRemote });
    repoLocalPath = result.localPath;
    loopCtx.state.repoLocalPath = repoLocalPath;
  }

  try {
    await driver.git.fetch(repoLocalPath, { githubToken: auth?.githubToken ?? null });
  } catch (error) {
    logActorWarning("task.init", "fetch before naming failed", {
      workspaceId: loopCtx.state.workspaceId,
      repoId: loopCtx.state.repoId,
      taskId: loopCtx.state.taskId,
      error: resolveErrorMessage(error),
    });
  }

  const remoteBranches = (await driver.git.listRemoteBranches(repoLocalPath, { githubToken: auth?.githubToken ?? null })).map(
    (branch: any) => branch.branchName,
  );
  const project = await getOrCreateProject(loopCtx, loopCtx.state.workspaceId, loopCtx.state.repoId, loopCtx.state.repoRemote);
  const reservedBranches = await project.listReservedBranches({});
  const resolved = resolveCreateFlowDecision({
    task: loopCtx.state.task,
    explicitTitle: loopCtx.state.explicitTitle ?? undefined,
    explicitBranchName: loopCtx.state.explicitBranchName ?? undefined,
    localBranches: remoteBranches,
    taskBranches: reservedBranches,
  });

  const now = Date.now();
  await loopCtx.db
    .update(taskTable)
    .set({
      branchName: resolved.branchName,
      title: resolved.title,
      updatedAt: now,
    })
    .where(eq(taskTable.id, TASK_ROW_ID))
    .run();

  loopCtx.state.branchName = resolved.branchName;
  loopCtx.state.title = resolved.title;
  loopCtx.state.explicitTitle = null;
  loopCtx.state.explicitBranchName = null;

  await loopCtx.db
    .update(taskRuntime)
    .set({
      statusMessage: "provisioning",
      provisionStage: "repo_prepared",
      provisionStageUpdatedAt: now,
      updatedAt: now,
    })
    .where(eq(taskRuntime.id, TASK_ROW_ID))
    .run();

  await project.registerTaskBranch({
    taskId: loopCtx.state.taskId,
    branchName: resolved.branchName,
  });

  await appendHistory(loopCtx, "task.named", {
    title: resolved.title,
    branchName: resolved.branchName,
  });
}

export async function initAssertNameActivity(loopCtx: any): Promise<void> {
  await setTaskState(loopCtx, "init_assert_name", "validating naming");
  if (!loopCtx.state.branchName) {
    throw new Error("task branchName is not initialized");
  }
}

export async function initCompleteActivity(loopCtx: any, body: any): Promise<void> {
  const now = Date.now();
  const { config } = getActorRuntimeContext();
  const providerId = body?.providerId ?? loopCtx.state.providerId ?? defaultSandboxProviderId(config);

  await setTaskState(loopCtx, "init_complete", "task initialized");
  await loopCtx.db
    .update(taskRuntime)
    .set({
      statusMessage: "ready",
      provisionStage: "ready",
      provisionStageUpdatedAt: now,
      updatedAt: now,
    })
    .where(eq(taskRuntime.id, TASK_ROW_ID))
    .run();

  const history = await getOrCreateHistory(loopCtx, loopCtx.state.workspaceId, loopCtx.state.repoId);
  await history.append({
    kind: "task.initialized",
    taskId: loopCtx.state.taskId,
    branchName: loopCtx.state.branchName,
    payload: { providerId },
  });

  loopCtx.state.initialized = true;
}

export async function initFailedActivity(loopCtx: any, error: unknown): Promise<void> {
  const now = Date.now();
  const detail = resolveErrorDetail(error);
  const messages = collectErrorMessages(error);
  const { config } = getActorRuntimeContext();
  const providerId = loopCtx.state.providerId ?? defaultSandboxProviderId(config);

  await loopCtx.db
    .insert(taskTable)
    .values({
      id: TASK_ROW_ID,
      branchName: loopCtx.state.branchName ?? null,
      title: loopCtx.state.title ?? null,
      task: loopCtx.state.task,
      providerId,
      status: "error",
      agentType: loopCtx.state.agentType ?? config.default_agent,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: taskTable.id,
      set: {
        branchName: loopCtx.state.branchName ?? null,
        title: loopCtx.state.title ?? null,
        task: loopCtx.state.task,
        providerId,
        status: "error",
        agentType: loopCtx.state.agentType ?? config.default_agent,
        updatedAt: now,
      },
    })
    .run();

  await loopCtx.db
    .insert(taskRuntime)
    .values({
      id: TASK_ROW_ID,
      activeSandboxId: null,
      activeSessionId: null,
      activeSwitchTarget: null,
      activeCwd: null,
      statusMessage: detail,
      provisionStage: "error",
      provisionStageUpdatedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: taskRuntime.id,
      set: {
        activeSandboxId: null,
        activeSessionId: null,
        activeSwitchTarget: null,
        activeCwd: null,
        statusMessage: detail,
        provisionStage: "error",
        provisionStageUpdatedAt: now,
        updatedAt: now,
      },
    })
    .run();

  await appendHistory(loopCtx, "task.error", {
    detail,
    messages,
  });
}
