CREATE TABLE `primary_agents` (
	`session_id` text PRIMARY KEY,
	`status` text NOT NULL,
	`current_job_id` text,
	`current_task` text,
	`started_at` text NOT NULL,
	`stops` text NOT NULL,
	`updates` text NOT NULL,
	`artifacts` text NOT NULL,
	`pi_session_id` text NOT NULL,
	`pi_session_file` text,
	`error` text,
	CONSTRAINT `fk_primary_agents_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `workers` ADD `artifacts` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `workers` ADD `pi_session_id` text;--> statement-breakpoint
ALTER TABLE `workers` ADD `pi_session_file` text;