import { Delta } from "quill";
import { useEffect, useState } from "react";
import { TEXT_KEY } from "@shared/ydoc";
import type { SocketProvider } from "../yjs/socketProvider";

/**
 * Going back to how the document was.
 *
 * Restoring does not reset the document. It works out the difference between
 * what the text says now and what the snapshot said, and applies that
 * difference as an ordinary edit — so everyone else in the room receives it
 * the way they receive any other change, nobody's history is discarded, and
 * the restore itself can be undone.
 *
 * Resetting the CRDT instead would mean every other person in the room is
 * holding a document the server has never seen, and the two would merge rather
 * than replace: the old text would come straight back, doubled.
 */

interface Snapshot {
  id: string;
  createdAt: number;
  bytes: number;
}

interface Props {
  documentId: string;
  provider: SocketProvider | null;
  onClose: () => void;
}

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export default function HistoryPanel({ documentId, provider, onClose }: Props) {
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/documents/${documentId}/snapshots`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("failed"))))
      .then((data: { snapshots: Snapshot[] }) => {
        if (!cancelled) setSnapshots(data.snapshots);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the history.");
      });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  async function restore(snapshotId: string) {
    if (!provider) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/documents/${documentId}/snapshots/${snapshotId}`);
      if (!response.ok) throw new Error("failed");
      const { ops } = (await response.json()) as { ops: unknown[] };

      const text = provider.doc.getText(TEXT_KEY);
      const current = new Delta(text.toDelta() as ConstructorParameters<typeof Delta>[0]);
      const target = new Delta(ops as ConstructorParameters<typeof Delta>[0]);
      const change = current.diff(target);
      if (change.ops.length > 0) text.applyDelta(change.ops);
      onClose();
    }
    catch {
      setError("Could not restore that version.");
    }
    finally {
      setBusy(false);
    }
  }

  return (
    <div className="history" role="dialog" aria-label="Version history">
      <div className="history-head">
        <h2 className="history-title">Version history</h2>
        <button type="button" className="menu-button" onClick={onClose}>Close</button>
      </div>

      {error && <p className="history-error">{error}</p>}
      {snapshots === null && !error && <p className="history-empty">Loading…</p>}
      {snapshots?.length === 0 && (
        <p className="history-empty">
          Nothing saved yet. A version is kept every ten minutes while the document is being
          edited.
        </p>
      )}

      {snapshots?.map((snapshot) => (
        <div className="history-row" key={snapshot.id}>
          <span className="history-when">{when.format(snapshot.createdAt)}</span>
          {confirming === snapshot.id
            ? (
                <span className="history-confirm">
                  <button
                    type="button"
                    className="menu-button"
                    disabled={busy}
                    onClick={() => void restore(snapshot.id)}
                  >
                    {busy ? "Restoring…" : "Yes, restore"}
                  </button>
                  <button type="button" className="menu-button" onClick={() => setConfirming(null)}>
                    Cancel
                  </button>
                </span>
              )
            : (
                // Two steps rather than a browser confirm dialogue: this changes
                // the document for everyone else in the room too.
                <button
                  type="button"
                  className="menu-button"
                  onClick={() => setConfirming(snapshot.id)}
                >
                  Restore
                </button>
              )}
        </div>
      ))}
    </div>
  );
}
