import { eq, lt } from "drizzle-orm";
import * as Y from "yjs";
import type { DeltaOp, LegacyDocumentData } from "../shared/events.js";
import { META_KEY, TEXT_KEY } from "../shared/ydoc.js";
import { db } from "./db/index.js";
import { documents } from "./db/schema.js";
import { storedNameIn, storeUpload } from "./uploads.js";

/** What a room created from now on writes into the legacy column. */
const EMPTY_DELTA: LegacyDocumentData = { ops: [] };

export interface LoadedDocument {
  doc: Y.Doc;
  /**
   * True when the contents came from the legacy Quill delta rather than from
   * `ystate`, which means this document exists only in memory so far.
   *
   * The caller has to write it out. Seeding produces a *new* Yjs document with
   * a fresh client id every time, so a room that is seeded, read, and never
   * saved gets a different — and equally valid — document on the next open.
   * Two such documents do not recognise each other as the same content: they
   * merge, and the text appears twice. Persisting the first seed is what makes
   * the migration happen once.
   */
  seeded: boolean;
}

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
 *    document once and reported as `seeded`. Nothing is deleted, so an
 *    interrupted seed simply happens again next time.
 */
export function loadDocument(id: string): LoadedDocument {
  const doc = new Y.Doc();
  const row = db.select().from(documents).where(eq(documents.id, id)).get();

  if (!row) {
    // Concurrent first joins race here; whoever loses keeps its empty doc and
    // syncs against the winner's like any other peer.
    db.insert(documents)
      .values({ id, data: EMPTY_DELTA })
      .onConflictDoNothing({ target: documents.id })
      .run();
    return { doc, seeded: false };
  }

  if (row.ystate && row.ystate.length > 0) {
    Y.applyUpdate(doc, new Uint8Array(row.ystate));
    return { doc, seeded: false };
  }

  const ops = row.data?.ops ?? [];
  if (ops.length === 0) return { doc, seeded: false };

  doc.getText(TEXT_KEY).applyDelta(unembed(ops));
  return { doc, seeded: true };
}

/** `data:image/png;base64,…` → the bytes it stands for, or null. */
function decodeDataUrl(value: string): Buffer | null {
  const match = /^data:[^;,]*;base64,([A-Za-z0-9+/=\s]+)$/.exec(value);
  if (!match?.[1]) return null;
  try {
    return Buffer.from(match[1], "base64");
  }
  catch {
    return null;
  }
}

/**
 * Move base64 pictures out of a legacy delta and into the upload store as it is
 * seeded.
 *
 * This is the one moment it can be done cheaply. Leave them and they become
 * part of the Yjs document, at which point every one of those megabytes is
 * broadcast to the whole room on every edit and rewritten to SQLite on every
 * save — the seeding step would carry the exact problem uploads exist to end
 * across into the new world.
 *
 * A picture we cannot store (a corrupt data URL, or an SVG) is left exactly as
 * it was rather than dropped: it is somebody's document, and a broken image is
 * a better outcome than a missing one.
 */
function unembed(ops: DeltaOp[]): DeltaOp[] {
  return ops.map((op) => {
    const insert = op.insert;
    if (typeof insert !== "object" || insert === null) return op;
    const image = (insert as { image?: unknown }).image;
    if (typeof image !== "string" || !image.startsWith("data:")) return op;

    const bytes = decodeDataUrl(image);
    if (!bytes) return op;
    const stored = storeUpload(bytes);
    if ("error" in stored) return op;
    return { ...op, insert: { ...insert, image: stored.url } };
  });
}

/**
 * Every stored picture any document still points at.
 *
 * Read out of SQLite rather than out of the in-memory rooms, which makes the
 * answer up to one save interval stale — covered many times over by the
 * sweep's grace period.
 *
 * Throws rather than returning what it managed to read. The caller deletes
 * everything *not* in this set, so a partial answer is not a smaller answer,
 * it is a set of deletions of pictures that are still in use. Failing here
 * stops the sweep, which is the safe direction: pictures accumulate, and the
 * error says which document could not be read.
 */
export function referencedUploads(): Set<string> {
  const names = new Set<string>();
  const rows = db.select({ id: documents.id, ystate: documents.ystate }).from(documents).all();

  for (const row of rows) {
    if (!row.ystate || row.ystate.length === 0) continue;
    const doc = new Y.Doc();
    try {
      Y.applyUpdate(doc, new Uint8Array(row.ystate));
      for (const op of doc.getText(TEXT_KEY).toDelta() as DeltaOp[]) {
        const image = (op.insert as { image?: unknown } | undefined)?.image;
        if (typeof image !== "string") continue;
        const name = storedNameIn(image);
        if (name) names.add(name);
      }
    }
    catch (cause) {
      throw new Error(`Could not read document ${row.id} while collecting upload references`, { cause });
    }
    finally {
      doc.destroy();
    }
  }
  return names;
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
