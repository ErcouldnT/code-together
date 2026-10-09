import { sql } from "drizzle-orm";
import { blob, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
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
    /**
     * `scrypt$salt$hash`, or null for a document anyone with the address may
     * open and edit — which is every document made before this column existed.
     */
    passwordHash: text("password_hash"),
    /**
     * What the password guards: "view" keeps the whole document behind it,
     * "edit" lets anyone read and only the password holder write. Null exactly
     * when `passwordHash` is.
     */
    protect: text("protect", { enum: ["view", "edit"] }),
    /**
     * When the document deletes itself, or null for one that lives until
     * somebody deletes it. Checked by a sweep every half minute, and on join
     * so a document is never opened in the gap between expiring and the
     * sweep coming round.
     */
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    /**
     * Where the document was made from, and where it was last changed from,
     * for the admin screen. Null for documents older than the columns, and
     * a country is null for an address no country owns (a private network).
     * Every editor, not only the last, is in `document_editors`.
     */
    createdIp: text("created_ip"),
    createdCountry: text("created_country"),
    editedIp: text("edited_ip"),
    editedCountry: text("edited_country"),
    editedAt: integer("edited_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("documents_updated_at_idx").on(table.updatedAt),
    index("documents_created_at_idx").on(table.createdAt),
    index("documents_expires_at_idx").on(table.expiresAt),
  ],
);

/**
 * Addresses whose document expired, kept for a while after the document is
 * gone.
 *
 * Without this, expiring would not stick. A browser keeps its own copy of a
 * document it has opened, and the sync handshake sends whatever the server
 * lacks — so the first person to come back online after the deletion would
 * quietly upload the whole document again, to a fresh row at the same
 * address. While the address is here, joining it is refused instead.
 */
export const expiredDocuments = sqliteTable("expired_documents", {
  id: text("id").primaryKey(),
  expiredAt: integer("expired_at", { mode: "timestamp_ms" }).notNull(),
});

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

/**
 * Files attached to a document — anything, not only pictures.
 *
 * Kept out of the Yjs document on purpose: an attachment is not part of the
 * text's history, so restoring an old version must not bring back a file that
 * was deleted, and deleting one must actually free the disk now.
 */
export const documentAttachments = sqliteTable(
  "document_attachments",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    /** what the person called it — only ever used in the download header, never on disk */
    name: text("name").notNull(),
    size: integer("size").notNull(),
    addedBy: text("added_by"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [index("document_attachments_document_idx").on(table.documentId, table.createdAt)],
);

/**
 * Everyone who has changed a document, one row per address: how many
 * changes, and when the first and the latest were. Gathered in memory while
 * the room is open and written with each save, so typing is not a write per
 * keystroke. Goes with the document when the document goes.
 */
export const documentEditors = sqliteTable(
  "document_editors",
  {
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    ip: text("ip").notNull(),
    country: text("country"),
    /** updates received from this address — a burst of typing, not a character */
    edits: integer("edits").notNull().default(0),
    firstAt: integer("first_at", { mode: "timestamp_ms" }).notNull(),
    lastAt: integer("last_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.documentId, table.ip] }),
    index("document_editors_ip_idx").on(table.ip),
    index("document_editors_country_idx").on(table.country),
  ],
);

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentSnapshot = typeof documentSnapshots.$inferSelect;
export type DocumentAttachment = typeof documentAttachments.$inferSelect;

/**
 * Limits changed from the admin screen, one row per limit, the value as JSON.
 * A limit with no row here is whatever the environment says — so a fresh
 * install behaves exactly as configured, and clearing a row returns to it.
 */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/*
 * Better Auth's tables — accounts, sessions, and the tokens behind email
 * verification and password resets — plus the admin plugin's columns
 * (role, ban, impersonation). Named and shaped as Better Auth expects; the
 * Drizzle adapter maps its models onto these by name.
 */

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  /** "admin", or a comma-separated list of roles; null is an ordinary user */
  role: text("role"),
  banned: integer("banned", { mode: "boolean" }).default(false),
  banReason: text("ban_reason"),
  banExpires: integer("ban_expires", { mode: "timestamp_ms" }),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonated_by"),
  },
  (table) => [index("session_user_idx").on(table.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    /** scrypt hash, for the "credential" provider — email and password */
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("account_user_idx").on(table.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);
