import { actor, queue } from "rivetkit";
import { workflow } from "rivetkit/workflow";
import { userDb } from "./db/db.js";
import { betterAuthActions } from "./actions/better-auth.js";
import { userActions } from "./actions/user.js";
import { USER_QUEUE_NAMES, runUserWorkflow } from "./workflow.js";

export const user = actor({
  db: userDb,
  queues: Object.fromEntries(USER_QUEUE_NAMES.map((name) => [name, queue()])),
  options: {
    name: "User",
    icon: "shield",
    actionTimeout: 60_000,
  },
  createState: (_c, input: { userId: string }) => ({
    userId: input.userId,
  }),
  actions: {
    ...betterAuthActions,
    ...userActions,
  },
  run: workflow(runUserWorkflow),
});
