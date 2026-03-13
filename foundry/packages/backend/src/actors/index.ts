import { setup } from "rivetkit";
import { taskStatusSync } from "./task-status-sync/index.js";
import { task } from "./task/index.js";
import { history } from "./history/index.js";
import { projectBranchSync } from "./project-branch-sync/index.js";
import { projectPrSync } from "./project-pr-sync/index.js";
import { project } from "./project/index.js";
import { sandboxInstance } from "./sandbox-instance/index.js";
import { workspace } from "./workspace/index.js";
import { logger } from "../logging.js";

const RUNNER_VERSION = Math.floor(Date.now() / 1000);

export const registry = setup({
  serverless: {
    basePath: "/v1/rivet",
  },
  runner: {
    version: RUNNER_VERSION,
  },
  logging: {
    baseLogger: logger,
  },
  use: {
    workspace,
    project,
    task,
    sandboxInstance,
    history,
    projectPrSync,
    projectBranchSync,
    taskStatusSync,
  },
});

export * from "./context.js";
export * from "./events.js";
export * from "./task-status-sync/index.js";
export * from "./task/index.js";
export * from "./history/index.js";
export * from "./keys.js";
export * from "./project-branch-sync/index.js";
export * from "./project-pr-sync/index.js";
export * from "./project/index.js";
export * from "./sandbox-instance/index.js";
export * from "./workspace/index.js";
