import { eq, lt } from "drizzle-orm";
import type { DocumentData } from "../shared/events.js";
import { db } from "./db/index.js";
import { documents } from "./db/schema.js";

const emptyDocument: DocumentData = { ops: [] };

/**
 * Fetch a room's contents, creating an empty room the first time someone opens it.
 * Concurrent joins race here, so the insert ignores an id that already exists.
 */
export function findOrCreateDocument(id: string): DocumentData {
  const existing = db.select().from(documents).where(eq(documents.id, id)).get();
  if (existing) return existing.data;

  db.insert(documents)
    .values({ id, data: emptyDocument })
    .onConflictDoNothing({ target: documents.id })
    .run();

  const created = db.select().from(documents).where(eq(documents.id, id)).get();
  return created?.data ?? emptyDocument;
}

export function saveDocument(id: string, data: DocumentData): void {
  db.update(documents)
    .set({ data, updatedAt: new Date() })
    .where(eq(documents.id, id))
    .run();
}

/** Drop rooms nobody has touched in a while. Only runs when DOCUMENT_TTL_DAYS is set. */
export function deleteStaleDocuments(ttlDays: number): number {
  if (ttlDays <= 0) return 0;
  const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000);
  return db.delete(documents).where(lt(documents.updatedAt, cutoff)).run().changes;
}
