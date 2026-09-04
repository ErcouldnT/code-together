import { eq, lt } from "drizzle-orm";
import * as Y from "yjs";
import type { LegacyDocumentData } from "../shared/events.js";
import { META_KEY, TEXT_KEY } from "../shared/ydoc.js";
import { db } from "./db/index.js";
import { documents } from "./db/schema.js";

/** What a room created from now on writes into the legacy column. */
const EMPTY_DELTA: LegacyDocumentData = { ops: [] };

/**
 * Load a room into a fresh `Y.Doc`, creating the row the first time anyone
 * opens it.
 *
 * Three cases, and the third is the whole reason the legacy column survives:
 *
 *  - no row: a new room, empty document;
 *  - `ystate` present: the normal path, one `applyUpdate`;
 *  - `ystate` empty but `data` populated: a room that predates the migration,
 *    opened for the first time since. Its Quill delta is replayed into the
 *    document once, and the next save writes `ystate`. Nothing is deleted, so
 *    an interrupted seed just happens again next time.
 */
export function loadDocument(id: string): Y.Doc {
  const doc = new Y.Doc();
  const row = db.select().from(documents).where(eq(documents.id, id)).get();

  if (!row) {
    // Concurrent first joins race here; whoever loses keeps its empty doc and
    // syncs against the winner's like any other peer.
    db.insert(documents)
      .values({ id, data: EMPTY_DELTA })
      .onConflictDoNothing({ target: documents.id })
      .run();
    return doc;
  }

  if (row.ystate && row.ystate.length > 0) {
    Y.applyUpdate(doc, new Uint8Array(row.ystate));
    return doc;
  }

  const ops = row.data?.ops ?? [];
  if (ops.length > 0) doc.getText(TEXT_KEY).applyDelta(ops);
  return doc;
}

/**
 * The title, mirrored out of the document so a room can be listed without
 * decoding its CRDT. Empty until phase 3 puts a title box on the page; reading
 * it here now costs nothing and keeps that change to the UI.
 */
function titleOf(doc: Y.Doc): string | null {
  const title: unknown = doc.getMap(META_KEY).get("title");
  return typeof title === "string" && title.trim() ? title.trim().slice(0, 200) : null;
}

export function saveDocument(id: string, doc: Y.Doc): void {
  db.update(documents)
    .set({
      ystate: Buffer.from(Y.encodeStateAsUpdate(doc)),
      title: titleOf(doc),
      updatedAt: new Date(),
    })
    .where(eq(documents.id, id))
    .run();
}

/** Drop rooms nobody has touched in a while. Only runs when DOCUMENT_TTL_DAYS is set. */
export function deleteStaleDocuments(ttlDays: number): number {
  if (ttlDays <= 0) return 0;
  const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000);
  return db.delete(documents).where(lt(documents.updatedAt, cutoff)).run().changes;
}
