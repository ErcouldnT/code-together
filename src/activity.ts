import { eq, sql } from "drizzle-orm";
import { db } from "./db/index.js";
import { documentEditors, documents } from "./db/schema.js";
import type { Origin } from "./geo.js";

/**
 * Where documents are made and changed from, written down for the admin
 * screen.
 *
 * Edits are counted in memory by the room and handed over here once per
 * save, so a minute of typing is one small write, not hundreds.
 */

export interface EditTally {
  country: string | null;
  edits: number;
  firstAt: number;
  lastAt: number;
}

/** Add one update from `origin` to a room's running tally. */
export function tally(into: Map<string, EditTally>, origin: Origin, now = Date.now()): void {
  const seen = into.get(origin.ip);
  if (seen) {
    seen.edits += 1;
    seen.lastAt = now;
    seen.country = origin.country;
  }
  else {
    into.set(origin.ip, { country: origin.country, edits: 1, firstAt: now, lastAt: now });
  }
}

/** Write a room's tally, and who changed it last. */
export function recordEdits(documentId: string, tallies: Map<string, EditTally>): void {
  if (tallies.size === 0) return;
  let latest: [string, EditTally] | null = null;
  for (const entry of tallies) if (!latest || entry[1].lastAt > latest[1].lastAt) latest = entry;
  if (!latest) return;
  const [ip, last] = latest;

  db.transaction((tx) => {
    const updated = tx.update(documents)
      .set({ editedIp: ip, editedCountry: last.country, editedAt: new Date(last.lastAt) })
      .where(eq(documents.id, documentId))
      .run();
    // Deleted between the edit and the save: there is nothing to attach the
    // rows to, and the foreign key would refuse them anyway.
    if (updated.changes === 0) return;
    for (const [address, t] of tallies) {
      tx.insert(documentEditors)
        .values({
          documentId,
          ip: address,
          country: t.country,
          edits: t.edits,
          firstAt: new Date(t.firstAt),
          lastAt: new Date(t.lastAt),
        })
        .onConflictDoUpdate({
          target: [documentEditors.documentId, documentEditors.ip],
          set: {
            edits: sql`${documentEditors.edits} + ${t.edits}`,
            lastAt: new Date(t.lastAt),
            country: t.country,
          },
        })
        .run();
    }
  });
}
