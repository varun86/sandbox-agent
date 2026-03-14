import { actor, queue } from "rivetkit";
import { workflow } from "rivetkit/workflow";
import type {
  AgentType,
  TaskRecord,
  TaskWorkbenchChangeModelInput,
  TaskWorkbenchRenameInput,
  TaskWorkbenchRenameSessionInput,
  TaskWorkbenchSetSessionUnreadInput,
  TaskWorkbenchSendMessageInput,
  TaskWorkbenchUpdateDraftInput,
  ProviderId,
} from "@sandbox-agent/foundry-shared";
import { expectQueueResponse } from "../../services/queue.js";
import { selfTask } from "../handles.js";
import { taskDb } from "./db/db.js";
import { getCurrentRecord } from "./workflow/common.js";
import {
  changeWorkbenchModel,
  closeWorkbenchSession,
  createWorkbenchSession,
  getSessionDetail,
  getTaskDetail,
  getTaskSummary,
  markWorkbenchUnread,
  publishWorkbenchPr,
  renameWorkbenchBranch,
  renameWorkbenchTask,
  renameWorkbenchSession,
  revertWorkbenchFile,
  sendWorkbenchMessage,
  syncWorkbenchSessionStatus,
  setWorkbenchSessionUnread,
  stopWorkbenchSession,
  updateWorkbenchDraft,
} from "./workbench.js";
import { TASK_QUEUE_NAMES, taskWorkflowQueueName, runTaskWorkflow } from "./workflow/index.js";

export interface TaskInput {
  workspaceId: string;
  repoId: string;
  taskId: string;
  repoRemote: string;
  repoLocalPath?: string;
  branchName: string | null;
  title: string | null;
  task: string;
  providerId: ProviderId;
  agentType: AgentType | null;
  explicitTitle: string | null;
  explicitBranchName: string | null;
  initialPrompt: string | null;
}

interface InitializeCommand {
  providerId?: ProviderId;
}

interface TaskActionCommand {
  reason?: string;
}

interface TaskTabCommand {
  tabId: string;
}

interface TaskStatusSyncCommand {
  sessionId: string;
  status: "running" | "idle" | "error";
  at: number;
}

interface TaskWorkbenchValueCommand {
  value: string;
}

interface TaskWorkbenchSessionTitleCommand {
  sessionId: string;
  title: string;
}

interface TaskWorkbenchSessionUnreadCommand {
  sessionId: string;
  unread: boolean;
}

interface TaskWorkbenchUpdateDraftCommand {
  sessionId: string;
  text: string;
  attachments: Array<any>;
}

interface TaskWorkbenchChangeModelCommand {
  sessionId: string;
  model: string;
}

interface TaskWorkbenchSendMessageCommand {
  sessionId: string;
  text: string;
  attachments: Array<any>;
}

interface TaskWorkbenchSendMessageActionInput extends TaskWorkbenchSendMessageInput {
  waitForCompletion?: boolean;
}

interface TaskWorkbenchCreateSessionCommand {
  model?: string;
}

interface TaskWorkbenchSessionCommand {
  sessionId: string;
}

export const task = actor({
  db: taskDb,
  queues: Object.fromEntries(TASK_QUEUE_NAMES.map((name) => [name, queue()])),
  options: {
    name: "Task",
    icon: "wrench",
    actionTimeout: 5 * 60_000,
  },
  createState: (_c, input: TaskInput) => ({
    workspaceId: input.workspaceId,
    repoId: input.repoId,
    taskId: input.taskId,
    repoRemote: input.repoRemote,
    repoLocalPath: input.repoLocalPath,
    branchName: input.branchName,
    title: input.title,
    task: input.task,
    providerId: input.providerId,
    agentType: input.agentType,
    explicitTitle: input.explicitTitle,
    explicitBranchName: input.explicitBranchName,
    initialPrompt: input.initialPrompt,
    initialized: false,
    previousStatus: null as string | null,
  }),
  actions: {
    async initialize(c, cmd: InitializeCommand): Promise<TaskRecord> {
      const self = selfTask(c);
      const result = await self.send(taskWorkflowQueueName("task.command.initialize"), cmd ?? {}, {
        wait: true,
        timeout: 5 * 60_000,
      });
      return expectQueueResponse<TaskRecord>(result);
    },

    async provision(c, cmd: InitializeCommand): Promise<{ ok: true }> {
      const self = selfTask(c);
      await self.send(taskWorkflowQueueName("task.command.provision"), cmd ?? {}, {
        wait: false,
      });
      return { ok: true };
    },

    async attach(c, cmd?: TaskActionCommand): Promise<{ target: string; sessionId: string | null }> {
      const self = selfTask(c);
      const result = await self.send(taskWorkflowQueueName("task.command.attach"), cmd ?? {}, {
        wait: true,
        timeout: 20_000,
      });
      return expectQueueResponse<{ target: string; sessionId: string | null }>(result);
    },

    async switch(c): Promise<{ switchTarget: string }> {
      const self = selfTask(c);
      const result = await self.send(
        taskWorkflowQueueName("task.command.switch"),
        {},
        {
          wait: true,
          timeout: 20_000,
        },
      );
      return expectQueueResponse<{ switchTarget: string }>(result);
    },

    async push(c, cmd?: TaskActionCommand): Promise<void> {
      const self = selfTask(c);
      await self.send(taskWorkflowQueueName("task.command.push"), cmd ?? {}, {
        wait: false,
      });
    },

    async sync(c, cmd?: TaskActionCommand): Promise<void> {
      const self = selfTask(c);
      await self.send(taskWorkflowQueueName("task.command.sync"), cmd ?? {}, {
        wait: false,
      });
    },

    async merge(c, cmd?: TaskActionCommand): Promise<void> {
      const self = selfTask(c);
      await self.send(taskWorkflowQueueName("task.command.merge"), cmd ?? {}, {
        wait: false,
      });
    },

    async archive(c, cmd?: TaskActionCommand): Promise<void> {
      const self = selfTask(c);
      await self.send(taskWorkflowQueueName("task.command.archive"), cmd ?? {}, {
        wait: false,
      });
    },

    async kill(c, cmd?: TaskActionCommand): Promise<void> {
      const self = selfTask(c);
      await self.send(taskWorkflowQueueName("task.command.kill"), cmd ?? {}, {
        wait: false,
      });
    },

    async get(c): Promise<TaskRecord> {
      return await getCurrentRecord({ db: c.db, state: c.state });
    },

    async getTaskSummary(c) {
      return await getTaskSummary(c);
    },

    async getTaskDetail(c) {
      return await getTaskDetail(c);
    },

    async getSessionDetail(c, input: { sessionId: string }) {
      return await getSessionDetail(c, input.sessionId);
    },

    async markWorkbenchUnread(c): Promise<void> {
      const self = selfTask(c);
      await self.send(
        taskWorkflowQueueName("task.command.workbench.mark_unread"),
        {},
        {
          wait: true,
          timeout: 20_000,
        },
      );
    },

    async renameWorkbenchTask(c, input: TaskWorkbenchRenameInput): Promise<void> {
      const self = selfTask(c);
      await self.send(taskWorkflowQueueName("task.command.workbench.rename_task"), { value: input.value } satisfies TaskWorkbenchValueCommand, {
        wait: true,
        timeout: 20_000,
      });
    },

    async renameWorkbenchBranch(c, input: TaskWorkbenchRenameInput): Promise<void> {
      const self = selfTask(c);
      await self.send(taskWorkflowQueueName("task.command.workbench.rename_branch"), { value: input.value } satisfies TaskWorkbenchValueCommand, {
        wait: false,
      });
    },

    async createWorkbenchSession(c, input?: { model?: string }): Promise<{ tabId: string }> {
      const self = selfTask(c);
      const result = await self.send(
        taskWorkflowQueueName("task.command.workbench.create_session"),
        { ...(input?.model ? { model: input.model } : {}) } satisfies TaskWorkbenchCreateSessionCommand,
        {
          wait: true,
          timeout: 5 * 60_000,
        },
      );
      return expectQueueResponse<{ tabId: string }>(result);
    },

    async renameWorkbenchSession(c, input: TaskWorkbenchRenameSessionInput): Promise<void> {
      const self = selfTask(c);
      await self.send(
        taskWorkflowQueueName("task.command.workbench.rename_session"),
        { sessionId: input.tabId, title: input.title } satisfies TaskWorkbenchSessionTitleCommand,
        {
          wait: true,
          timeout: 20_000,
        },
      );
    },

    async setWorkbenchSessionUnread(c, input: TaskWorkbenchSetSessionUnreadInput): Promise<void> {
      const self = selfTask(c);
      await self.send(
        taskWorkflowQueueName("task.command.workbench.set_session_unread"),
        { sessionId: input.tabId, unread: input.unread } satisfies TaskWorkbenchSessionUnreadCommand,
        {
          wait: true,
          timeout: 20_000,
        },
      );
    },

    async updateWorkbenchDraft(c, input: TaskWorkbenchUpdateDraftInput): Promise<void> {
      const self = selfTask(c);
      await self.send(
        taskWorkflowQueueName("task.command.workbench.update_draft"),
        {
          sessionId: input.tabId,
          text: input.text,
          attachments: input.attachments,
        } satisfies TaskWorkbenchUpdateDraftCommand,
        {
          wait: true,
          timeout: 20_000,
        },
      );
    },

    async changeWorkbenchModel(c, input: TaskWorkbenchChangeModelInput): Promise<void> {
      const self = selfTask(c);
      await self.send(
        taskWorkflowQueueName("task.command.workbench.change_model"),
        { sessionId: input.tabId, model: input.model } satisfies TaskWorkbenchChangeModelCommand,
        {
          wait: true,
          timeout: 20_000,
        },
      );
    },

    async sendWorkbenchMessage(c, input: TaskWorkbenchSendMessageActionInput): Promise<void> {
      const self = selfTask(c);
      const result = await self.send(
        taskWorkflowQueueName("task.command.workbench.send_message"),
        {
          sessionId: input.tabId,
          text: input.text,
          attachments: input.attachments,
        } satisfies TaskWorkbenchSendMessageCommand,
        {
          wait: input.waitForCompletion === true,
          ...(input.waitForCompletion === true ? { timeout: 10 * 60_000 } : {}),
        },
      );
      if (input.waitForCompletion === true) {
        expectQueueResponse(result);
      }
    },

    async stopWorkbenchSession(c, input: TaskTabCommand): Promise<void> {
      const self = selfTask(c);
      await self.send(taskWorkflowQueueName("task.command.workbench.stop_session"), { sessionId: input.tabId } satisfies TaskWorkbenchSessionCommand, {
        wait: false,
      });
    },

    async syncWorkbenchSessionStatus(c, input: TaskStatusSyncCommand): Promise<void> {
      const self = selfTask(c);
      await self.send(taskWorkflowQueueName("task.command.workbench.sync_session_status"), input, {
        wait: true,
        timeout: 20_000,
      });
    },

    async closeWorkbenchSession(c, input: TaskTabCommand): Promise<void> {
      const self = selfTask(c);
      await self.send(taskWorkflowQueueName("task.command.workbench.close_session"), { sessionId: input.tabId } satisfies TaskWorkbenchSessionCommand, {
        wait: false,
      });
    },

    async publishWorkbenchPr(c): Promise<void> {
      const self = selfTask(c);
      await self.send(
        taskWorkflowQueueName("task.command.workbench.publish_pr"),
        {},
        {
          wait: false,
        },
      );
    },

    async revertWorkbenchFile(c, input: { path: string }): Promise<void> {
      const self = selfTask(c);
      await self.send(taskWorkflowQueueName("task.command.workbench.revert_file"), input, {
        wait: false,
      });
    },
  },
  run: workflow(runTaskWorkflow),
});

export { TASK_QUEUE_NAMES };
