import { actor } from "rivetkit";
import type { TaskRecord } from "@sandbox-agent/foundry-shared";
import { taskDb } from "./db/db.js";
import { getCurrentRecord } from "./workflow/common.js";
import { getSessionDetail, getTaskDetail, getTaskSummary } from "./workspace.js";
import { taskCommandActions } from "./workflow/index.js";

export interface TaskInput {
  organizationId: string;
  repoId: string;
  taskId: string;
}

export const task = actor({
  db: taskDb,
  options: {
    name: "Task",
    icon: "wrench",
    actionTimeout: 10 * 60_000,
  },
  createState: (_c, input: TaskInput) => ({
    organizationId: input.organizationId,
    repoId: input.repoId,
    taskId: input.taskId,
  }),
  actions: {
    async get(c): Promise<TaskRecord> {
      return await getCurrentRecord(c);
    },

    async getTaskSummary(c) {
      return await getTaskSummary(c);
    },

    async getTaskDetail(c, input?: { authSessionId?: string }) {
      return await getTaskDetail(c, input?.authSessionId);
    },

    async getSessionDetail(c, input: { sessionId: string; authSessionId?: string }) {
      return await getSessionDetail(c, input.sessionId, input.authSessionId);
    },

    ...taskCommandActions,
  },
});

export { taskWorkflowQueueName } from "./workflow/index.js";
