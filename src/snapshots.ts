import { randomUUID } from "node:crypto";
import { and, desc, eq, lt } from "drizzle-orm";
import * as Y from "yjs";
import type { DeltaOp } from "../shared/events.js";
import { TEXT_KEY } from "../shared/ydoc.js";
import { db } from "./db/index.js";
import { documentSnapshots } from "./db/schema.js";
import { env } from "./env.js";

/**
 * Version history.
 *
 * Yjs already keeps every operation that ever happened, so it is tempting to
 * think history is free. It is not the history people want: the CRDT's log is
 * addressed by client ids and clocks, not by "before lunch", and rebuilding a
 * point in time from it means replaying against a snapshot anyway. So this
 * writes whole states at intervals, which is small at this scale — a document
 * of a few pages is a few kilobytes — and directly answers the question asked.
 */

/*
 * At most one snapshot per document per interval — someone typing steadily for
 * an hour gets six points to go back to, not one per save — and only so many
 * kept. Both are in env.ts; see the note there.
 */

export interface SnapshotSummary {
  id: string;
  createdAt: number;
  bytes: number;
}

function newest(documentId: string): { createdAt: Date; state: Buffer } | undefined {
  return db
    .select({ createdAt: documentSnapshots.createdAt, state: documentSnapshots.state })
    .from(documentSnapshots)
    .where(eq(documentSnapshots.documentId, documentId))
    .orderBy(desc(documentSnapshots.createdAt))
    .limit(1)
    .get();
}

/**
 * Record the document's current state, if it is time and if anything changed.
 *
 * Called from the save path, so it inherits its throttle: a document nobody is
 * editing is never saved and therefore never snapshotted.
 */
export function takeSnapshot(documentId: string, doc: Y.Doc, now = Date.now()): boolean {
  const state = Buffer.from(Y.encodeStateAsUpdate(doc));
  const last = newest(documentId);

  if (last) {
    if (now - last.createdAt.getTime() < env.snapshotEveryMs) return false;
    // Encoding is deterministic for a given document, so identical bytes mean
    // nothing has changed — which happens when a room is opened and closed
    // without being touched.
    if (last.state.equals(state)) return false;
  }

  db.insert(documentSnapshots)
    .values({ id: randomUUID(), documentId, createdAt: new Date(now), state })
    .run();

  prune(documentId);
  return true;
}

/** Drop everything past the newest `snapshotKeep` for one document. */
function prune(documentId: string): void {
  const cutoff = db
    .select({ createdAt: documentSnapshots.createdAt })
    .from(documentSnapshots)
    .where(eq(documentSnapshots.documentId, documentId))
    .orderBy(desc(documentSnapshots.createdAt))
    .limit(1)
    .offset(Math.max(1, env.snapshotKeep) - 1)
    .get();
  if (!cutoff) return;

  db.delete(documentSnapshots)
    .where(
      and(
        eq(documentSnapshots.documentId, documentId),
        lt(documentSnapshots.createdAt, cutoff.createdAt),
      ),
    )
    .run();
}

export function listSnapshots(documentId: string): SnapshotSummary[] {
  return db
    .select({
      id: documentSnapshots.id,
      createdAt: documentSnapshots.createdAt,
      state: documentSnapshots.state,
    })
    .from(documentSnapshots)
    .where(eq(documentSnapshots.documentId, documentId))
    .orderBy(desc(documentSnapshots.createdAt))
    .all()
    .map((row) => ({ id: row.id, createdAt: row.createdAt.getTime(), bytes: row.state.length }));
}

/**
 * A snapshot's contents, as a delta.
 *
 * A delta rather than the Yjs state, because restoring is not a reset. The
 * client works out the difference between what the document says now and what
 * the snapshot said, and applies that difference as an ordinary edit — so
 * everyone else in the room converges on it the same way they converge on
 * anything else, and nobody's history is thrown away.
 */
export function snapshotContents(
  documentId: string,
  snapshotId: string,
): { createdAt: number; ops: DeltaOp[] } | null {
  const row = db
    .select()
    .from(documentSnapshots)
    .where(and(eq(documentSnapshots.id, snapshotId), eq(documentSnapshots.documentId, documentId)))
    .get();
  if (!row) return null;

  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, new Uint8Array(row.state));
    return {
      createdAt: row.createdAt.getTime(),
      ops: doc.getText(TEXT_KEY).toDelta() as DeltaOp[],
    };
  }
  finally {
    doc.destroy();
  }
}
