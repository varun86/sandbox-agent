import { logActorWarning, resolveErrorMessage } from "../../logging.js";
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

/**
 * Task command actions — converted from queue/workflow handlers to direct actions.
 * Each export becomes an action on the task actor.
 */
export const taskCommandActions = {
  async initialize(c: any, body: any) {
    await initBootstrapDbActivity(c, body);
    await initEnqueueProvisionActivity(c, body);
    return await getCurrentRecord(c);
  },

  async provision(c: any, body: any) {
    try {
      await initCompleteActivity(c, body);
      return { ok: true };
    } catch (error) {
      await initFailedActivity(c, error, body);
      return { ok: false, error: resolveErrorMessage(error) };
    }
  },

  async attach(c: any, body: any) {
    // handleAttachActivity expects msg with complete — adapt
    const result = { value: undefined as any };
    const msg = {
      name: "task.command.attach",
      body,
      complete: async (v: any) => {
        result.value = v;
      },
    };
    await handleAttachActivity(c, msg);
    return result.value;
  },

  async switchTask(c: any, body: any) {
    const result = { value: undefined as any };
    const msg = {
      name: "task.command.switch",
      body,
      complete: async (v: any) => {
        result.value = v;
      },
    };
    await handleSwitchActivity(c, msg);
    return result.value;
  },

  async push(c: any, body: any) {
    const result = { value: undefined as any };
    const msg = {
      name: "task.command.push",
      body,
      complete: async (v: any) => {
        result.value = v;
      },
    };
    await handlePushActivity(c, msg);
    return result.value;
  },

  async sync(c: any, body: any) {
    const result = { value: undefined as any };
    const msg = {
      name: "task.command.sync",
      body,
      complete: async (v: any) => {
        result.value = v;
      },
    };
    await handleSimpleCommandActivity(c, msg, "task.sync");
    return result.value;
  },

  async merge(c: any, body: any) {
    const result = { value: undefined as any };
    const msg = {
      name: "task.command.merge",
      body,
      complete: async (v: any) => {
        result.value = v;
      },
    };
    await handleSimpleCommandActivity(c, msg, "task.merge");
    return result.value;
  },

  async archive(c: any, body: any) {
    const result = { value: undefined as any };
    const msg = {
      name: "task.command.archive",
      body,
      complete: async (v: any) => {
        result.value = v;
      },
    };
    await handleArchiveActivity(c, msg);
    return result.value;
  },

  async kill(c: any, body: any) {
    const result = { value: undefined as any };
    const msg = {
      name: "task.command.kill",
      body,
      complete: async (v: any) => {
        result.value = v;
      },
    };
    await killDestroySandboxActivity(c);
    await killWriteDbActivity(c, msg);
    return result.value;
  },

  async getRecord(c: any, body: any) {
    const result = { value: undefined as any };
    const msg = {
      name: "task.command.get",
      body,
      complete: async (v: any) => {
        result.value = v;
      },
    };
    await handleGetActivity(c, msg);
    return result.value;
  },

  async pullRequestSync(c: any, body: any) {
    await syncTaskPullRequest(c, body?.pullRequest ?? null);
    return { ok: true };
  },

  async markUnread(c: any, body: any) {
    await markWorkspaceUnread(c, body?.authSessionId);
    return { ok: true };
  },

  async renameTask(c: any, body: any) {
    await renameWorkspaceTask(c, body.value);
    return { ok: true };
  },

  async createSession(c: any, body: any) {
    return await createWorkspaceSession(c, body?.model, body?.authSessionId);
  },

  async createSessionAndSend(c: any, body: any) {
    try {
      const created = await createWorkspaceSession(c, body?.model, body?.authSessionId);
      await sendWorkspaceMessage(c, created.sessionId, body.text, [], body?.authSessionId);
    } catch (error) {
      logActorWarning("task.workflow", "create_session_and_send failed", {
        error: resolveErrorMessage(error),
      });
    }
    return { ok: true };
  },

  async ensureSession(c: any, body: any) {
    await ensureWorkspaceSession(c, body.sessionId, body?.model, body?.authSessionId);
    return { ok: true };
  },

  async renameSession(c: any, body: any) {
    await renameWorkspaceSession(c, body.sessionId, body.title);
    return { ok: true };
  },

  async selectSession(c: any, body: any) {
    await selectWorkspaceSession(c, body.sessionId, body?.authSessionId);
    return { ok: true };
  },

  async setSessionUnread(c: any, body: any) {
    await setWorkspaceSessionUnread(c, body.sessionId, body.unread, body?.authSessionId);
    return { ok: true };
  },

  async updateDraft(c: any, body: any) {
    await updateWorkspaceDraft(c, body.sessionId, body.text, body.attachments, body?.authSessionId);
    return { ok: true };
  },

  async changeModel(c: any, body: any) {
    await changeWorkspaceModel(c, body.sessionId, body.model, body?.authSessionId);
    return { ok: true };
  },

  async sendMessage(c: any, body: any) {
    await sendWorkspaceMessage(c, body.sessionId, body.text, body.attachments, body?.authSessionId);
    return { ok: true };
  },

  async stopSession(c: any, body: any) {
    await stopWorkspaceSession(c, body.sessionId);
    return { ok: true };
  },

  async syncSessionStatus(c: any, body: any) {
    await syncWorkspaceSessionStatus(c, body.sessionId, body.status, body.at);
    return { ok: true };
  },

  async refreshDerived(c: any, _body: any) {
    await refreshWorkspaceDerivedState(c);
    return { ok: true };
  },

  async refreshSessionTranscript(c: any, body: any) {
    await refreshWorkspaceSessionTranscript(c, body.sessionId);
    return { ok: true };
  },

  async closeSession(c: any, body: any) {
    await closeWorkspaceSession(c, body.sessionId, body?.authSessionId);
    return { ok: true };
  },

  async publishPr(c: any, _body: any) {
    await publishWorkspacePr(c);
    return { ok: true };
  },

  async revertFile(c: any, body: any) {
    await revertWorkspaceFile(c, body.path);
    return { ok: true };
  },
};
