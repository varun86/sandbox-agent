import type { AgentType, ProviderId, TaskStatus } from "./contracts.js";

export type WorkbenchTaskStatus = TaskStatus | "new";
export type WorkbenchAgentKind = "Claude" | "Codex" | "Cursor";
export type WorkbenchModelId =
  | "claude-sonnet-4"
  | "claude-opus-4"
  | "gpt-5.3-codex"
  | "gpt-5.4"
  | "gpt-5.2-codex"
  | "gpt-5.1-codex-max"
  | "gpt-5.2"
  | "gpt-5.1-codex-mini";
export type WorkbenchSessionStatus = "pending_provision" | "pending_session_create" | "ready" | "running" | "idle" | "error";

export interface WorkbenchTranscriptEvent {
  id: string;
  eventIndex: number;
  sessionId: string;
  createdAt: number;
  connectionId: string;
  sender: "client" | "agent";
  payload: unknown;
}

export interface WorkbenchComposerDraft {
  text: string;
  attachments: WorkbenchLineAttachment[];
  updatedAtMs: number | null;
}

/** Session metadata without transcript content. */
export interface WorkbenchSessionSummary {
  id: string;
  sessionId: string | null;
  sessionName: string;
  agent: WorkbenchAgentKind;
  model: WorkbenchModelId;
  status: WorkbenchSessionStatus;
  thinkingSinceMs: number | null;
  unread: boolean;
  created: boolean;
  errorMessage?: string | null;
}

/** Full session content — only fetched when viewing a specific session tab. */
export interface WorkbenchSessionDetail {
  /** Stable UI tab id used for the session topic key and routing. */
  sessionId: string;
  tabId: string;
  sandboxSessionId: string | null;
  sessionName: string;
  agent: WorkbenchAgentKind;
  model: WorkbenchModelId;
  status: WorkbenchSessionStatus;
  thinkingSinceMs: number | null;
  unread: boolean;
  created: boolean;
  errorMessage?: string | null;
  draft: WorkbenchComposerDraft;
  transcript: WorkbenchTranscriptEvent[];
}

export interface WorkbenchFileChange {
  path: string;
  added: number;
  removed: number;
  type: "M" | "A" | "D";
}

export interface WorkbenchFileTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: WorkbenchFileTreeNode[];
}

export interface WorkbenchLineAttachment {
  id: string;
  filePath: string;
  lineNumber: number;
  lineContent: string;
}

export interface WorkbenchHistoryEvent {
  id: string;
  messageId: string;
  preview: string;
  sessionName: string;
  tabId: string;
  createdAtMs: number;
  detail: string;
}

export type WorkbenchDiffLineKind = "context" | "add" | "remove" | "hunk";

export interface WorkbenchParsedDiffLine {
  kind: WorkbenchDiffLineKind;
  lineNumber: number;
  text: string;
}

export interface WorkbenchPullRequestSummary {
  number: number;
  status: "draft" | "ready";
}

export interface WorkbenchSandboxSummary {
  providerId: ProviderId;
  sandboxId: string;
  cwd: string | null;
}

/** Sidebar-level task data. Materialized in the workspace actor's SQLite. */
export interface WorkbenchTaskSummary {
  id: string;
  repoId: string;
  title: string;
  status: WorkbenchTaskStatus;
  repoName: string;
  updatedAtMs: number;
  branch: string | null;
  pullRequest: WorkbenchPullRequestSummary | null;
  /** Summary of sessions — no transcript content. */
  sessionsSummary: WorkbenchSessionSummary[];
}

/** Full task detail — only fetched when viewing a specific task. */
export interface WorkbenchTaskDetail extends WorkbenchTaskSummary {
  /** Original task prompt/instructions shown in the detail view. */
  task: string;
  /** Agent choice used when creating new sandbox sessions for this task. */
  agentType: AgentType | null;
  /** Underlying task runtime status preserved for detail views and error handling. */
  runtimeStatus: TaskStatus;
  statusMessage: string | null;
  activeSessionId: string | null;
  diffStat: string | null;
  prUrl: string | null;
  reviewStatus: string | null;
  fileChanges: WorkbenchFileChange[];
  diffs: Record<string, string>;
  fileTree: WorkbenchFileTreeNode[];
  minutesUsed: number;
  /** Sandbox info for this task. */
  sandboxes: WorkbenchSandboxSummary[];
  activeSandboxId: string | null;
}

/** Repo-level summary for workspace sidebar. */
export interface WorkbenchRepoSummary {
  id: string;
  label: string;
  /** Aggregated branch/task overview state (replaces getRepoOverview polling). */
  taskCount: number;
  latestActivityMs: number;
}

/** Workspace-level snapshot — initial fetch for the workspace topic. */
export interface WorkspaceSummarySnapshot {
  workspaceId: string;
  repos: WorkbenchRepoSummary[];
  taskSummaries: WorkbenchTaskSummary[];
}

/**
 * Deprecated compatibility aliases for older mock/view-model code.
 * New code should use the summary/detail/topic-specific types above.
 */
export interface WorkbenchAgentTab extends WorkbenchSessionSummary {
  draft: WorkbenchComposerDraft;
  transcript: WorkbenchTranscriptEvent[];
}

export interface WorkbenchTask {
  id: string;
  repoId: string;
  title: string;
  status: WorkbenchTaskStatus;
  runtimeStatus?: TaskStatus;
  statusMessage?: string | null;
  repoName: string;
  updatedAtMs: number;
  branch: string | null;
  pullRequest: WorkbenchPullRequestSummary | null;
  tabs: WorkbenchAgentTab[];
  fileChanges: WorkbenchFileChange[];
  diffs: Record<string, string>;
  fileTree: WorkbenchFileTreeNode[];
  minutesUsed: number;
  activeSandboxId?: string | null;
}

export interface WorkbenchRepo {
  id: string;
  label: string;
}

export interface WorkbenchProjectSection {
  id: string;
  label: string;
  updatedAtMs: number;
  tasks: WorkbenchTask[];
}

export interface TaskWorkbenchSnapshot {
  workspaceId: string;
  repos: WorkbenchRepo[];
  projects: WorkbenchProjectSection[];
  tasks: WorkbenchTask[];
}

export interface WorkbenchModelOption {
  id: WorkbenchModelId;
  label: string;
}

export interface WorkbenchModelGroup {
  provider: string;
  models: WorkbenchModelOption[];
}

export interface TaskWorkbenchSelectInput {
  taskId: string;
}

export interface TaskWorkbenchCreateTaskInput {
  repoId: string;
  task: string;
  title?: string;
  branch?: string;
  model?: WorkbenchModelId;
}

export interface TaskWorkbenchRenameInput {
  taskId: string;
  value: string;
}

export interface TaskWorkbenchSendMessageInput {
  taskId: string;
  tabId: string;
  text: string;
  attachments: WorkbenchLineAttachment[];
}

export interface TaskWorkbenchTabInput {
  taskId: string;
  tabId: string;
}

export interface TaskWorkbenchRenameSessionInput extends TaskWorkbenchTabInput {
  title: string;
}

export interface TaskWorkbenchChangeModelInput extends TaskWorkbenchTabInput {
  model: WorkbenchModelId;
}

export interface TaskWorkbenchUpdateDraftInput extends TaskWorkbenchTabInput {
  text: string;
  attachments: WorkbenchLineAttachment[];
}

export interface TaskWorkbenchSetSessionUnreadInput extends TaskWorkbenchTabInput {
  unread: boolean;
}

export interface TaskWorkbenchDiffInput {
  taskId: string;
  path: string;
}

export interface TaskWorkbenchCreateTaskResponse {
  taskId: string;
  tabId?: string;
}

export interface TaskWorkbenchAddTabResponse {
  tabId: string;
}
