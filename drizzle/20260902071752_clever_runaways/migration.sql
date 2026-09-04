CREATE TABLE `displays` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`job_id` text NOT NULL,
	`widget_id` text,
	`title` text NOT NULL,
	`format` text NOT NULL,
	`content` text NOT NULL,
	`alt` text,
	`caption` text,
	`links` text NOT NULL,
	`created_at` integer NOT NULL,
	`dismissed` integer DEFAULT false NOT NULL,
	CONSTRAINT `fk_displays_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_displays_job_id_jobs_id_fk` FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`request` text NOT NULL,
	`status` text NOT NULL,
	`child_workers` text NOT NULL,
	`network_enabled` integer NOT NULL,
	`created_at` integer NOT NULL,
	`result` text,
	`error` text,
	CONSTRAINT `fk_jobs_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `replies` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`job_id` text NOT NULL,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`display_title` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_replies_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_replies_job_id_jobs_id_fk` FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY,
	`title` text NOT NULL,
	`workspace` text,
	`pi_session_file` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workers` (
	`session_id` text NOT NULL,
	`name` text NOT NULL,
	`task` text NOT NULL,
	`parent_job_id` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`stops` text NOT NULL,
	`updates` text NOT NULL,
	`summary` text,
	`error` text,
	CONSTRAINT `workers_pk` PRIMARY KEY(`parent_job_id`, `name`),
	CONSTRAINT `fk_workers_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_workers_parent_job_id_jobs_id_fk` FOREIGN KEY (`parent_job_id`) REFERENCES `jobs`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `displays_session_created_idx` ON `displays` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `displays_job_widget_idx` ON `displays` (`job_id`,`widget_id`);--> statement-breakpoint
CREATE INDEX `jobs_session_created_idx` ON `jobs` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `replies_session_created_idx` ON `replies` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `sessions_updated_at_idx` ON `sessions` (`updated_at`);--> statement-breakpoint
CREATE INDEX `workers_job_idx` ON `workers` (`parent_job_id`);