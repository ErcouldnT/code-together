import { sql } from "drizzle-orm";
import { blob, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { LegacyDocumentData } from "../../shared/events.js";

export const documents = sqliteTable(
  "documents",
  {
    /** The nanoid from the URL — the room name people share with each other. */
    id: text("id").primaryKey(),
    /**
     * The Yjs document, as one encoded state update. This is the document.
     *
     * Null only for a room that existed before the Yjs migration and has not
     * been opened since; the first join seeds it from `data`.
     */
    ystate: blob("ystate", { mode: "buffer" }),
    /**
     * The pre-Yjs Quill delta. Read once, to seed `ystate`, and written only as
     * an empty delta for rooms created from now on — but not dropped, and not
     * made nullable either.
     *
     * Both of those are deliberate. Dropping it would delete the only copy of a
     * room's contents until somebody opens that room. Relaxing NOT NULL looks
     * tidier and is worse: SQLite cannot change a column in place, so drizzle
     * rewrites the whole table, and the generated INSERT ... SELECT reads
     * `ystate`/`title` out of the *old* table, which does not have them yet.
     * That migration fails at boot. Leaving the column exactly as it was keeps
     * this a pair of plain ADD COLUMNs.
     */
    data: text("data", { mode: "json" }).$type<LegacyDocumentData>().notNull(),
    /**
     * Mirror of the title held inside the Yjs document, kept here so a room can
     * be listed without decoding its CRDT. Written by the persistence path.
     */
    title: text("title"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [index("documents_updated_at_idx").on(table.updatedAt)],
);

/**
 * Periodic full copies of a document, so an edit can be undone hours later by
 * somebody who was not there when it happened.
 *
 * Full states rather than a log of updates: the Yjs history *is* the log, and
 * it is not addressable by wall-clock time. What a person wants is "how it
 * looked before lunch", and that is a snapshot.
 */
export const documentSnapshots = sqliteTable(
  "document_snapshots",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      // Delete the room, delete its history with it. A snapshot of a document
      // that no longer exists is unreachable by construction.
      .references(() => documents.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    /** the Yjs state at that moment */
    state: blob("state", { mode: "buffer" }).notNull(),
  },
  (table) => [index("document_snapshots_document_idx").on(table.documentId, table.createdAt)],
);

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentSnapshot = typeof documentSnapshots.$inferSelect;
