CREATE TABLE `branches` (
	`branch_name` text PRIMARY KEY NOT NULL,
	`commit_sha` text NOT NULL,
	`parent_branch` text,
	`tracked_in_stack` integer DEFAULT 0 NOT NULL,
	`diff_stat` text,
	`has_unpushed` integer DEFAULT 0 NOT NULL,
	`conflicts_with_main` integer DEFAULT 0 NOT NULL,
	`first_seen_at` integer,
	`last_seen_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pr_cache` (
	`branch_name` text PRIMARY KEY NOT NULL,
	`pr_number` integer NOT NULL,
	`state` text NOT NULL,
	`title` text NOT NULL,
	`pr_url` text,
	`pr_author` text,
	`is_draft` integer DEFAULT 0 NOT NULL,
	`ci_status` text,
	`review_status` text,
	`reviewer` text,
	`fetched_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `repo_meta` (
	`id` integer PRIMARY KEY NOT NULL,
	`remote_url` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_index` (
	`task_id` text PRIMARY KEY NOT NULL,
	`branch_name` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
