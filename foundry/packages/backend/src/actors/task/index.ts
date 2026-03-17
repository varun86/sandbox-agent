import { actor, queue } from "rivetkit";
import { workflow } from "rivetkit/workflow";
import type { TaskRecord } from "@sandbox-agent/foundry-shared";
import { taskDb } from "./db/db.js";
import { getCurrentRecord } from "./workflow/common.js";
import { getSessionDetail, getTaskDetail, getTaskSummary } from "./workspace.js";
import { runTaskWorkflow } from "./workflow/index.js";
import { TASK_QUEUE_NAMES } from "./workflow/queue.js";

export interface TaskInput {
  organizationId: string;
  repoId: string;
  taskId: string;
}

export const task = actor({
  db: taskDb,
  queues: Object.fromEntries(TASK_QUEUE_NAMES.map((name) => [name, queue()])),
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
  },
  run: workflow(runTaskWorkflow),
});

export { taskWorkflowQueueName } from "./workflow/index.js";
