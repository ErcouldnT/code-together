CREATE TABLE `expired_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`expired_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `documents` ADD `expires_at` integer;--> statement-breakpoint
CREATE INDEX `documents_expires_at_idx` ON `documents` (`expires_at`);