import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { DocumentData } from "../../shared/events.js";

export const documents = sqliteTable(
  "documents",
  {
    /** The nanoid from the URL — the room name people share with each other. */
    id: text("id").primaryKey(),
    /** Quill delta, stored as JSON text. */
    data: text("data", { mode: "json" }).$type<DocumentData>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [index("documents_updated_at_idx").on(table.updatedAt)],
);

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
