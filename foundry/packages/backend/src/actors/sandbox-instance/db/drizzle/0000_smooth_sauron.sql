CREATE TABLE `sandbox_instance` (
	`id` integer PRIMARY KEY NOT NULL,
	`metadata_json` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sandbox_session_events` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`event_index` integer NOT NULL,
	`created_at` integer NOT NULL,
	`connection_id` text NOT NULL,
	`sender` text NOT NULL,
	`payload_json` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sandbox_session_events_session_id_event_index_unique` ON `sandbox_session_events` (`session_id`,`event_index`);--> statement-breakpoint
CREATE TABLE `sandbox_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`agent` text NOT NULL,
	`agent_session_id` text NOT NULL,
	`last_connection_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`destroyed_at` integer,
	`session_init_json` text
);
