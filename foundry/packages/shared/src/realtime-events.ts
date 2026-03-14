import type { FoundryAppSnapshot } from "./app-shell.js";
import type { WorkbenchOpenPrSummary, WorkbenchRepoSummary, WorkbenchSessionDetail, WorkbenchTaskDetail, WorkbenchTaskSummary } from "./workbench.js";

export interface SandboxProcessSnapshot {
  id: string;
  command: string;
  args: string[];
  createdAtMs: number;
  cwd?: string | null;
  exitCode?: number | null;
  exitedAtMs?: number | null;
  interactive: boolean;
  pid?: number | null;
  status: "running" | "exited";
  tty: boolean;
}

/** Workspace-level events broadcast by the workspace actor. */
export type WorkspaceEvent =
  | { type: "taskSummaryUpdated"; taskSummary: WorkbenchTaskSummary }
  | { type: "taskRemoved"; taskId: string }
  | { type: "repoAdded"; repo: WorkbenchRepoSummary }
  | { type: "repoUpdated"; repo: WorkbenchRepoSummary }
  | { type: "repoRemoved"; repoId: string }
  | { type: "pullRequestUpdated"; pullRequest: WorkbenchOpenPrSummary }
  | { type: "pullRequestRemoved"; prId: string };

/** Task-level events broadcast by the task actor. */
export type TaskEvent = { type: "taskDetailUpdated"; detail: WorkbenchTaskDetail };

/** Session-level events broadcast by the task actor and filtered by sessionId on the client. */
export type SessionEvent = { type: "sessionUpdated"; session: WorkbenchSessionDetail };

/** App-level events broadcast by the app workspace actor. */
export type AppEvent = { type: "appUpdated"; snapshot: FoundryAppSnapshot };

/** Sandbox process events broadcast by the sandbox instance actor. */
export type SandboxProcessesEvent = { type: "processesUpdated"; processes: SandboxProcessSnapshot[] };
