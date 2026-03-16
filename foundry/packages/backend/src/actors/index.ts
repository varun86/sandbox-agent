import { user } from "./user/index.js";
import { setup } from "rivetkit";
import { githubData } from "./github-data/index.js";
import { task } from "./task/index.js";
import { auditLog } from "./audit-log/index.js";
import { taskSandbox } from "./sandbox/index.js";
import { organization } from "./organization/index.js";
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
    user,
    organization,
    task,
    taskSandbox,
    auditLog,
    githubData,
  },
});

export * from "./context.js";
export * from "./audit-log/index.js";
export * from "./user/index.js";
export * from "./github-data/index.js";
export * from "./task/index.js";
export * from "./keys.js";
export * from "./sandbox/index.js";
export * from "./organization/index.js";
