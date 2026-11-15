-- Номер сотрудника больше не спрашиваем: неиспользованные приглашения (ждали номер) аннулируем.
DELETE FROM `invites` WHERE `used_at` IS NULL;--> statement-breakpoint
ALTER TABLE `invites` DROP COLUMN `claimed_by`;--> statement-breakpoint
ALTER TABLE `staff` DROP COLUMN `phone`;
