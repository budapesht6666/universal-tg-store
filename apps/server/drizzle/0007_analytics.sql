CREATE TABLE `analytics_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`type` text NOT NULL,
	`product_id` text,
	`source` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `analytics_events_type` ON `analytics_events` (`type`,`created_at`);--> statement-breakpoint
CREATE INDEX `analytics_events_user` ON `analytics_events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `carts` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`items` text NOT NULL,
	`total` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `users` ADD `bot_blocked_at` integer;