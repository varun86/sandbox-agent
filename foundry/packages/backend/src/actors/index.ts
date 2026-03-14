import { authUser } from "./auth-user/index.js";
import { setup } from "rivetkit";
import { task } from "./task/index.js";
import { history } from "./history/index.js";
import { projectBranchSync } from "./project-branch-sync/index.js";
import { projectPrSync } from "./project-pr-sync/index.js";
import { project } from "./project/index.js";
import { taskSandbox } from "./sandbox/index.js";
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
    authUser,
    workspace,
    project,
    task,
    taskSandbox,
    history,
    projectPrSync,
    projectBranchSync,
  },
});

export * from "./context.js";
export * from "./events.js";
export * from "./auth-user/index.js";
export * from "./task/index.js";
export * from "./history/index.js";
export * from "./keys.js";
export * from "./project-branch-sync/index.js";
export * from "./project-pr-sync/index.js";
export * from "./project/index.js";
export * from "./sandbox/index.js";
export * from "./workspace/index.js";
