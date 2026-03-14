import { integer, sqliteTable, text } from "rivetkit/db/drizzle";

// SQLite is per project actor instance (workspaceId+repoId), so no workspaceId/repoId columns needed.

export const branches = sqliteTable("branches", {
  branchName: text("branch_name").notNull().primaryKey(),
  commitSha: text("commit_sha").notNull(),
  parentBranch: text("parent_branch"),
  trackedInStack: integer("tracked_in_stack").notNull().default(0),
  diffStat: text("diff_stat"),
  hasUnpushed: integer("has_unpushed").notNull().default(0),
  conflictsWithMain: integer("conflicts_with_main").notNull().default(0),
  firstSeenAt: integer("first_seen_at"),
  lastSeenAt: integer("last_seen_at"),
  updatedAt: integer("updated_at").notNull(),
});

export const repoMeta = sqliteTable("repo_meta", {
  id: integer("id").primaryKey(),
  remoteUrl: text("remote_url").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const taskIndex = sqliteTable("task_index", {
  taskId: text("task_id").notNull().primaryKey(),
  branchName: text("branch_name"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const repoActionJobs = sqliteTable("repo_action_jobs", {
  jobId: text("job_id").notNull().primaryKey(),
  action: text("action").notNull(),
  branchName: text("branch_name"),
  parentBranch: text("parent_branch"),
  status: text("status").notNull(),
  message: text("message").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  completedAt: integer("completed_at"),
});
