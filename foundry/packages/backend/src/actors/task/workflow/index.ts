// @ts-nocheck
/**
 * Task workflow — queue-based command loop.
 *
 * Mutations are dispatched through named queues and processed inside the
 * workflow command loop so that every command appears in the RivetKit
 * inspector's workflow history. Read actions remain direct (no queue).
 *
 * Callers send commands directly via `.send(taskWorkflowQueueName(...), ...)`.
 */
import { Loop } from "rivetkit/workflow";
import { logActorWarning, resolveErrorMessage } from "../../logging.js";
import { TASK_QUEUE_NAMES, type TaskQueueName, taskWorkflowQueueName } from "./queue.js";
import { getCurrentRecord } from "./common.js";
import { initBootstrapDbActivity, initCompleteActivity, initEnqueueProvisionActivity, initFailedActivity } from "./init.js";
import {
  handleArchiveActivity,
  handleAttachActivity,
  handleGetActivity,
  handlePushActivity,
  handleSimpleCommandActivity,
  handleSwitchActivity,
  killDestroySandboxActivity,
  killWriteDbActivity,
} from "./commands.js";
import {
  changeTaskOwnerManually,
  changeWorkspaceModel,
  closeWorkspaceSession,
  createWorkspaceSession,
  ensureWorkspaceSession,
  refreshWorkspaceDerivedState,
  refreshWorkspaceSessionTranscript,
  markWorkspaceUnread,
  publishWorkspacePr,
  renameWorkspaceTask,
  renameWorkspaceSession,
  selectWorkspaceSession,
  revertWorkspaceFile,
  sendWorkspaceMessage,
  setWorkspaceSessionUnread,
  stopWorkspaceSession,
  syncTaskPullRequest,
  syncWorkspaceSessionStatus,
  updateWorkspaceDraft,
} from "../workspace.js";

export { taskWorkflowQueueName } from "./queue.js";

// ---------------------------------------------------------------------------
// Workflow command loop — runs inside `run: workflow(runTaskWorkflow)`
// ---------------------------------------------------------------------------

type WorkflowHandler = (loopCtx: any, msg: any) => Promise<void>;

const COMMAND_HANDLERS: Record<TaskQueueName, WorkflowHandler> = {
  "task.command.initialize": async (loopCtx, msg) => {
    await initBootstrapDbActivity(loopCtx, msg.body);
    await initEnqueueProvisionActivity(loopCtx, msg.body);
    const record = await getCurrentRecord(loopCtx);
    await msg.complete(record);
  },

  "task.command.provision": async (loopCtx, msg) => {
    try {
      await initCompleteActivity(loopCtx, msg.body);
      await msg.complete({ ok: true });
    } catch (error) {
      await initFailedActivity(loopCtx, error, msg.body);
      await msg.complete({ ok: false, error: resolveErrorMessage(error) });
    }
  },

  "task.command.attach": async (loopCtx, msg) => {
    await handleAttachActivity(loopCtx, msg);
  },

  "task.command.switch": async (loopCtx, msg) => {
    await handleSwitchActivity(loopCtx, msg);
  },

  "task.command.push": async (loopCtx, msg) => {
    await handlePushActivity(loopCtx, msg);
  },

  "task.command.sync": async (loopCtx, msg) => {
    await handleSimpleCommandActivity(loopCtx, msg, "task.sync");
  },

  "task.command.merge": async (loopCtx, msg) => {
    await handleSimpleCommandActivity(loopCtx, msg, "task.merge");
  },

  "task.command.archive": async (loopCtx, msg) => {
    await handleArchiveActivity(loopCtx, msg);
  },

  "task.command.kill": async (loopCtx, msg) => {
    await killDestroySandboxActivity(loopCtx);
    await killWriteDbActivity(loopCtx, msg);
  },

  "task.command.get": async (loopCtx, msg) => {
    await handleGetActivity(loopCtx, msg);
  },

  "task.command.pull_request.sync": async (loopCtx, msg) => {
    await syncTaskPullRequest(loopCtx, msg.body?.pullRequest ?? null);
    await msg.complete({ ok: true });
  },

  "task.command.workspace.mark_unread": async (loopCtx, msg) => {
    await markWorkspaceUnread(loopCtx, msg.body?.authSessionId);
    await msg.complete({ ok: true });
  },

  "task.command.workspace.rename_task": async (loopCtx, msg) => {
    await renameWorkspaceTask(loopCtx, msg.body.value);
    await msg.complete({ ok: true });
  },

  "task.command.workspace.create_session": async (loopCtx, msg) => {
    const result = await createWorkspaceSession(loopCtx, msg.body?.model, msg.body?.authSessionId);
    await msg.complete(result);
  },

  "task.command.workspace.create_session_and_send": async (loopCtx, msg) => {
    try {
      const created = await createWorkspaceSession(loopCtx, msg.body?.model, msg.body?.authSessionId);
      await sendWorkspaceMessage(loopCtx, created.sessionId, msg.body.text, [], msg.body?.authSessionId);
    } catch (error) {
      logActorWarning("task.workflow", "create_session_and_send failed", {
        error: resolveErrorMessage(error),
      });
    }
    await msg.complete({ ok: true });
  },

  "task.command.workspace.ensure_session": async (loopCtx, msg) => {
    await ensureWorkspaceSession(loopCtx, msg.body.sessionId, msg.body?.model, msg.body?.authSessionId);
    await msg.complete({ ok: true });
  },

  "task.command.workspace.rename_session": async (loopCtx, msg) => {
    await renameWorkspaceSession(loopCtx, msg.body.sessionId, msg.body.title);
    await msg.complete({ ok: true });
  },

  "task.command.workspace.select_session": async (loopCtx, msg) => {
    await selectWorkspaceSession(loopCtx, msg.body.sessionId, msg.body?.authSessionId);
    await msg.complete({ ok: true });
  },

  "task.command.workspace.set_session_unread": async (loopCtx, msg) => {
    await setWorkspaceSessionUnread(loopCtx, msg.body.sessionId, msg.body.unread, msg.body?.authSessionId);
    await msg.complete({ ok: true });
  },

  "task.command.workspace.update_draft": async (loopCtx, msg) => {
    await updateWorkspaceDraft(loopCtx, msg.body.sessionId, msg.body.text, msg.body.attachments, msg.body?.authSessionId);
    await msg.complete({ ok: true });
  },

  "task.command.workspace.change_model": async (loopCtx, msg) => {
    await changeWorkspaceModel(loopCtx, msg.body.sessionId, msg.body.model, msg.body?.authSessionId);
    await msg.complete({ ok: true });
  },

  "task.command.workspace.send_message": async (loopCtx, msg) => {
    await sendWorkspaceMessage(loopCtx, msg.body.sessionId, msg.body.text, msg.body.attachments, msg.body?.authSessionId);
    await msg.complete({ ok: true });
  },

  "task.command.workspace.stop_session": async (loopCtx, msg) => {
    await stopWorkspaceSession(loopCtx, msg.body.sessionId);
    await msg.complete({ ok: true });
  },

  "task.command.workspace.sync_session_status": async (loopCtx, msg) => {
    await syncWorkspaceSessionStatus(loopCtx, msg.body.sessionId, msg.body.status, msg.body.at);
    await msg.complete({ ok: true });
  },

  "task.command.workspace.refresh_derived": async (loopCtx, msg) => {
    await refreshWorkspaceDerivedState(loopCtx);
    await msg.complete({ ok: true });
  },

  "task.command.workspace.refresh_session_transcript": async (loopCtx, msg) => {
    await refreshWorkspaceSessionTranscript(loopCtx, msg.body.sessionId);
    await msg.complete({ ok: true });
  },

  "task.command.workspace.close_session": async (loopCtx, msg) => {
    await closeWorkspaceSession(loopCtx, msg.body.sessionId, msg.body?.authSessionId);
    await msg.complete({ ok: true });
  },

  "task.command.workspace.publish_pr": async (loopCtx, msg) => {
    await publishWorkspacePr(loopCtx);
    await msg.complete({ ok: true });
  },

  "task.command.workspace.revert_file": async (loopCtx, msg) => {
    await revertWorkspaceFile(loopCtx, msg.body.path);
    await msg.complete({ ok: true });
  },

  "task.command.workspace.change_owner": async (loopCtx, msg) => {
    await changeTaskOwnerManually(loopCtx, {
      primaryUserId: msg.body.primaryUserId,
      primaryGithubLogin: msg.body.primaryGithubLogin,
      primaryGithubEmail: msg.body.primaryGithubEmail,
      primaryGithubAvatarUrl: msg.body.primaryGithubAvatarUrl ?? null,
    });
    await msg.complete({ ok: true });
  },
};

export async function runTaskWorkflow(ctx: any): Promise<void> {
  await ctx.loop("task-command-loop", async (loopCtx: any) => {
    const msg = await loopCtx.queue.next("next-task-command", {
      names: [...TASK_QUEUE_NAMES],
      completable: true,
    });

    if (!msg) {
      return Loop.continue(undefined);
    }

    const handler = COMMAND_HANDLERS[msg.name as TaskQueueName];
    if (!handler) {
      logActorWarning("task.workflow", "unknown task command", { command: msg.name });
      await msg.complete({ error: `Unknown command: ${msg.name}` }).catch(() => {});
      return Loop.continue(undefined);
    }

    try {
      // Wrap in a step so c.state and c.db are accessible inside mutation functions.
      await loopCtx.step({
        name: msg.name,
        timeout: 10 * 60_000,
        run: async () => handler(loopCtx, msg),
      });
    } catch (error) {
      const message = resolveErrorMessage(error);
      logActorWarning("task.workflow", "task workflow command failed", {
        command: msg.name,
        error: message,
      });
      await msg.complete({ error: message }).catch(() => {});
    }

    return Loop.continue(undefined);
  });
}
