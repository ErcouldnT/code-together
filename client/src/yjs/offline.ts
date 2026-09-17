import { IndexeddbPersistence } from "y-indexeddb";
import type * as Y from "yjs";

/**
 * The document, kept on this machine as well as on the server.
 *
 * Without it, an edit made while the connection is down lives only in the
 * tab's memory: close it, or let the browser discard it to reclaim memory, and
 * the work is gone with nothing to warn about afterwards. With it, the same
 * edit is on disk before the tab closes and is pushed up by the ordinary sync
 * handshake the next time the socket comes back.
 *
 * Merging a local copy into the live document is safe because both sides are
 * Yjs updates: they commute. What comes out of IndexedDB is not a competing
 * version to be reconciled, it is the same document minus whatever happened
 * elsewhere since — applying it can only add back what this browser knew.
 */

export interface LocalCopy {
  /** resolves once the stored document, if any, has been merged in */
  whenLoaded: Promise<void>;
  destroy: () => void;
}

/**
 * Returns null where IndexedDB cannot be used at all — Firefox in private
 * mode, a locked-down enterprise profile, a browser with storage disabled.
 * That is a weaker guarantee, not a broken app, so the caller keeps the
 * "closing this tab loses work" warning for those cases instead of failing.
 */
export function keepLocalCopy(doc: Y.Doc, documentId: string): LocalCopy | null {
  if (typeof indexedDB === "undefined") return null;

  let persistence: IndexeddbPersistence;
  try {
    persistence = new IndexeddbPersistence(`code-together:${documentId}`, doc);
  }
  catch {
    return null;
  }

  const whenLoaded = new Promise<void>((resolve) => {
    persistence.once("synced", () => resolve());
    // A rejected promise here would be an unhandled rejection in a browser
    // where storage is refused mid-flight; the caller only ever awaits.
    persistence.whenSynced.catch(() => resolve());
  });

  return {
    whenLoaded,
    destroy: () => {
      // `destroy` alone leaves the database open; the document is not deleted
      // either way — that is the point of it.
      void persistence.destroy();
    },
  };
}
