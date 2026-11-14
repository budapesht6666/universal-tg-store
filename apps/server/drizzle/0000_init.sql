CREATE TABLE `attributes` (
	`key` text PRIMARY KEY NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`definition` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer
);
--> statement-breakpoint
CREATE TABLE `bot_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`order_id` integer,
	`chat_id` integer NOT NULL,
	`message_id` integer NOT NULL,
	`customer_id` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bot_messages_order` ON `bot_messages` (`order_id`,`kind`);--> statement-breakpoint
CREATE INDEX `bot_messages_chat` ON `bot_messages` (`chat_id`,`message_id`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invites` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`claimed_by` integer,
	`used_by` integer,
	`used_at` integer
);
--> statement-breakpoint
CREATE TABLE `order_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`type` text NOT NULL,
	`status` text,
	`actor_id` integer,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `order_events_order` ON `order_events` (`order_id`,`id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`customer_name` text NOT NULL,
	`phone` text NOT NULL,
	`phone_from_telegram` integer DEFAULT false NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`accuracy` real,
	`location_source` text NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`items` text NOT NULL,
	`total` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text NOT NULL,
	`accepted_by` integer,
	`courier_id` integer,
	`cancel_reason` text,
	`cancel_comment` text,
	`cancel_requested_at` integer,
	`delivery_issue` text,
	`reminded_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `orders_status` ON `orders` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `orders_customer` ON `orders` (`customer_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `orders_courier` ON `orders` (`courier_id`,`status`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`price` integer NOT NULL,
	`compare_at_price` integer,
	`image` text,
	`badges` text NOT NULL,
	`available` integer DEFAULT true NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`attributes` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `products_category` ON `products` (`category_id`,`sort`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`paused_until` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `staff` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`roles` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`phone` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text,
	`username` text,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
