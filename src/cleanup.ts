import { inArray, lt } from "drizzle-orm";
import * as Y from "yjs";
import type { CleanupEntry } from "../shared/admin.js";
import type { DeltaOp } from "../shared/events.js";
import { META_KEY, TEXT_KEY } from "../shared/ydoc.js";
import { deleteAttachmentFiles } from "./attachments.js";
import { db } from "./db/index.js";
import { documentAttachments, documents } from "./db/schema.js";
import { peekRoom } from "./rooms.js";

/**
 * Clearing out documents nobody is going to come back to.
 *
 * Two kinds. An *empty* document is what visiting the front page leaves
 * behind when nobody types: a row with no text, no title, no attachments and
 * no password — every bounce off the home page makes one. An *abandoned* one
 * has content but has not been touched in a long time.
 *
 * A document somebody has open right now is never deleted, whatever it looks
 * like: its row may be seconds behind the room, and deleting it under the
 * people in it would be deleting their work. Unlike expiry, nothing here
 * leaves a tombstone — if the person who had an abandoned document comes
 * back with a copy in their browser, getting it back is the right outcome.
 */

const SAMPLE = 20;

function entry(row: { id: string; title: string | null; createdAt: Date; updatedAt: Date }): CleanupEntry {
  return { id: row.id, title: row.title, createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() };
}

/** Nothing typed, nothing pasted, no title — whatever the CRDT has been through. */
export function isBlank(ystate: Buffer | null, legacyOps: DeltaOp[] | undefined): boolean {
  if (!ystate || ystate.length === 0) {
    return (legacyOps ?? []).every((op) => typeof op.insert === "string" && op.insert.trim() === "");
  }
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, new Uint8Array(ystate));
    const title = doc.getMap(META_KEY).get("title");
    if (typeof title === "string" && title.trim()) return false;
    const ops = doc.getText(TEXT_KEY).toDelta() as DeltaOp[];
    // An embed (a picture, a rule) is content even with no text round it.
    return ops.every((op) => typeof op.insert === "string" && op.insert.trim() === "");
  }
  catch {
    // Unreadable is not the same as empty; leave it for a person to look at.
    return false;
  }
  finally {
    doc.destroy();
  }
}

/** Empty documents made more than `olderThanHours` ago. */
export function findEmpty(olderThanHours: number, now = Date.now()): CleanupEntry[] {
  const cutoff = new Date(now - olderThanHours * 60 * 60 * 1000);
  const withFiles = new Set(
    db.selectDistinct({ id: documentAttachments.documentId }).from(documentAttachments).all().map((row) => row.id),
  );
  return db
    .select()
    .from(documents)
    .where(lt(documents.createdAt, cutoff))
    .all()
    .filter((row) =>
      !row.passwordHash
      && !row.title
      && !withFiles.has(row.id)
      && !peekRoom(row.id)
      && isBlank(row.ystate, row.data?.ops))
    .map(entry);
}

/** Documents nobody has changed in `days` days. */
export function findAbandoned(days: number, now = Date.now()): CleanupEntry[] {
  const cutoff = new Date(now - days * 24 * 60 * 60 * 1000);
  return db
    .select({ id: documents.id, title: documents.title, createdAt: documents.createdAt, updatedAt: documents.updatedAt })
    .from(documents)
    .where(lt(documents.updatedAt, cutoff))
    .all()
    .filter((row) => !peekRoom(row.id))
    .map(entry)
    .sort((a, b) => a.updatedAt - b.updatedAt);
}

/**
 * Delete these documents — history and attachment rows by cascade, files by
 * hand — skipping any that somebody opened since they were found.
 */
export function deleteDocuments(ids: string[]): number {
  const closed = ids.filter((id) => !peekRoom(id));
  if (closed.length === 0) return 0;
  let removed = 0;
  // In slices, so a cleanup of thousands does not build one enormous statement.
  for (let i = 0; i < closed.length; i += 500) {
    const slice = closed.slice(i, i + 500);
    const gone = db.delete(documents).where(inArray(documents.id, slice)).returning({ id: documents.id }).all();
    for (const { id } of gone) deleteAttachmentFiles(id);
    removed += gone.length;
  }
  return removed;
}

export function preview(found: CleanupEntry[]): { count: number; sample: CleanupEntry[] } {
  return { count: found.length, sample: found.slice(0, SAMPLE) };
}

/**
 * The hourly job: whatever the admin screen has switched on. Both are off
 * unless asked for — except that DOCUMENT_TTL_DAYS, which this replaces,
 * still turns the abandoned half on as it always did.
 */
export function automaticCleanup(settings: { emptyDocumentHours: number; abandonedDocumentDays: number }): {
  empty: number;
  abandoned: number;
} {
  const empty = settings.emptyDocumentHours > 0
    ? deleteDocuments(findEmpty(settings.emptyDocumentHours).map((row) => row.id))
    : 0;
  const abandoned = settings.abandonedDocumentDays > 0
    ? deleteDocuments(findAbandoned(settings.abandonedDocumentDays).map((row) => row.id))
    : 0;
  return { empty, abandoned };
}
