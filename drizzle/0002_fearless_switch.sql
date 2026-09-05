CREATE TABLE `document_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`state` blob NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `document_snapshots_document_idx` ON `document_snapshots` (`document_id`,`created_at`);