-- Несколько фото у блюда: старое одно фото `image` становится первым (главным) в `images`.
ALTER TABLE `products` ADD `images` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
UPDATE `products` SET `images` = json_array(json(`image`)) WHERE `image` IS NOT NULL AND json_valid(`image`);
