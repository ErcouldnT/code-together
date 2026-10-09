import { eq, isNotNull, lt, lte } from "drizzle-orm";
import express, { type Router } from "express";
import { isExpiryChoice } from "../shared/access.js";
import { allowed } from "./access.js";
import { deleteAttachmentFiles } from "./attachments.js";
import { db } from "./db/index.js";
import { documents, expiredDocuments } from "./db/schema.js";
import { discardRoom, ROOM_ID } from "./rooms.js";

/**
 * Documents that delete themselves.
 *
 * A document can be given a time to live when it is made, or later from its
 * menu by anyone who may edit it. When the time comes the row goes, and with
 * it — by cascade — its history and attachment records; the attachment bytes
 * are removed by hand, and the address is recorded in `expired_documents` so
 * that a browser holding its own copy cannot sync the document back into
 * existence. See the schema for why that matters.
 *
 * The room, if anyone is in it, is told and emptied. Pictures the document
 * used are left to the hourly upload sweep, which already deletes any picture
 * nothing refers to.
 */

/** How long an expired address stays refused before it is free again. */
const TOMBSTONE_MS = 30 * 24 * 60 * 60 * 1000;

/** What the sweep needs from the socket server, handed in so tests can stand in for it. */
export interface ExpiryEvents {
  /** the document is gone: tell the room and close it */
  expired: (documentId: string) => void;
  /** the expiry moved */
  changed: (documentId: string, expiresAt: number | null) => void;
}

export function isTombstoned(documentId: string): boolean {
  return db.select({ id: expiredDocuments.id }).from(expiredDocuments).where(eq(expiredDocuments.id, documentId)).get() !== undefined;
}

/** A named document may be made again at an address that once expired. */
export function clearTombstone(documentId: string): void {
  db.delete(expiredDocuments).where(eq(expiredDocuments.id, documentId)).run();
}

export function expiryOf(documentId: string): number | null {
  const row = db.select({ expiresAt: documents.expiresAt }).from(documents).where(eq(documents.id, documentId)).get();
  return row?.expiresAt?.getTime() ?? null;
}

/**
 * Delete one document now, as expiry does: row, history, attachments, room,
 * and a tombstone at the address. Returns false if there was nothing to delete.
 */
export function expireDocument(documentId: string, events?: ExpiryEvents, now = Date.now()): boolean {
  const removed = db.transaction((tx) => {
    const gone = tx.delete(documents).where(eq(documents.id, documentId)).returning({ id: documents.id }).all();
    if (gone.length === 0) return false;
    tx.insert(expiredDocuments)
      .values({ id: documentId, expiredAt: new Date(now) })
      .onConflictDoUpdate({ target: expiredDocuments.id, set: { expiredAt: new Date(now) } })
      .run();
    return true;
  });
  if (!removed) return false;
  // Out of memory before the sockets go, so their leaving cannot flush the
  // document back to a row that no longer exists.
  discardRoom(documentId);
  events?.expired(documentId);
  deleteAttachmentFiles(documentId);
  return true;
}

/** Every document whose time is up. Returns how many went. */
export function expireDue(events?: ExpiryEvents, now = Date.now()): number {
  const due = db
    .select({ id: documents.id })
    .from(documents)
    .where(lte(documents.expiresAt, new Date(now)))
    .all();
  let count = 0;
  for (const { id } of due) if (expireDocument(id, events, now)) count += 1;
  return count;
}

/** The document is past its time, whether or not the sweep has been yet. */
export function isOverdue(documentId: string, now = Date.now()): boolean {
  const expiresAt = expiryOf(documentId);
  return expiresAt !== null && expiresAt <= now;
}

/** Forget tombstones old enough that nobody is still holding a copy worth refusing. */
export function pruneTombstones(now = Date.now()): number {
  return db
    .delete(expiredDocuments)
    .where(lt(expiredDocuments.expiredAt, new Date(now - TOMBSTONE_MS)))
    .run().changes;
}

/** How many documents are set to expire, for the admin screen. */
export function countExpiring(): number {
  return db.select({ id: documents.id }).from(documents).where(isNotNull(documents.expiresAt)).all().length;
}

export function expiryRoutes(events: ExpiryEvents): Router {
  const router = express.Router();

  /**
   * Set, move or clear a document's expiry. Anyone who may edit may do this —
   * the same people who could delete every word in it anyway.
   */
  router.post("/api/documents/:id/expiry", express.json({ limit: "1kb" }), (req, res) => {
    const id = req.params.id;
    if (!ROOM_ID.test(id)) {
      res.status(400).json({ error: "bad-id" });
      return;
    }
    if (!allowed(req, res, id, "write")) return;
    const expiresIn = (req.body as { expiresIn?: unknown } | undefined)?.expiresIn;
    if (expiresIn !== null && !isExpiryChoice(expiresIn)) {
      res.status(400).json({ error: "bad-expiry" });
      return;
    }
    const expiresAt = expiresIn === null ? null : new Date(Date.now() + expiresIn);
    const updated = db.update(documents).set({ expiresAt }).where(eq(documents.id, id)).run();
    if (updated.changes === 0) {
      res.sendStatus(404);
      return;
    }
    const value = expiresAt?.getTime() ?? null;
    events.changed(id, value);
    res.json({ expiresAt: value });
  });

  return router;
}
