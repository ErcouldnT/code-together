CREATE TABLE `document_editors` (
	`document_id` text NOT NULL,
	`ip` text NOT NULL,
	`country` text,
	`edits` integer DEFAULT 0 NOT NULL,
	`first_at` integer NOT NULL,
	`last_at` integer NOT NULL,
	PRIMARY KEY(`document_id`, `ip`),
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `document_editors_ip_idx` ON `document_editors` (`ip`);--> statement-breakpoint
CREATE INDEX `document_editors_country_idx` ON `document_editors` (`country`);--> statement-breakpoint
ALTER TABLE `documents` ADD `created_ip` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `created_country` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `edited_ip` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `edited_country` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `edited_at` integer;--> statement-breakpoint
CREATE INDEX `documents_created_at_idx` ON `documents` (`created_at`);