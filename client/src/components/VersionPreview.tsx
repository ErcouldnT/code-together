import Quill, { Delta } from "quill";
import { useEffect, useRef, useState } from "react";
import type { DeltaOp } from "@shared/events";

/**
 * Reading a version before deciding to restore it.
 *
 * Restoring is not a private act — it rewrites the document under everyone
 * else in the room — and a timestamp is not enough to decide on. So there are
 * two things to look at here: the version as it stood, and what restoring it
 * would actually change.
 *
 * The second is the useful one and costs almost nothing: Quill's own deltas
 * know how to diff, and the result is expressed as formatting over the current
 * text — struck through where the restore would remove, highlighted where it
 * would add. No diff library, no server round trip.
 */

type Mode = "version" | "changes";

interface Props {
  when: string;
  /** the snapshot's contents */
  ops: DeltaOp[];
  /** the document as it stands now */
  current: DeltaOp[];
  /** absent for a reader, who can look back but not put anything back */
  onRestore?: () => void;
  onClose: () => void;
  busy: boolean;
}

const ADDED = "rgba(74, 222, 128, 0.35)";
const REMOVED = "rgba(248, 113, 113, 0.35)";

type Ops = ConstructorParameters<typeof Delta>[0];

/**
 * The current text, marked up with what a restore would do to it.
 *
 * A delete cannot be shown — deleted text is absent by definition — so each
 * one is turned back into a retain that keeps the characters and strikes them
 * out. Composing that over the current document leaves both sides visible at
 * once, in place, which is the only arrangement that answers "what changes?"
 * without making the reader hold two documents in their head.
 */
function markUp(current: Delta, target: Delta): Delta {
  const diff = current.diff(target);
  const marked = new Delta(
    diff.ops.map((op) => {
      if (op.delete !== undefined) {
        return { retain: op.delete, attributes: { strike: true, background: REMOVED } };
      }
      if (op.insert !== undefined) {
        return { ...op, attributes: { ...op.attributes, background: ADDED } };
      }
      return op;
    }) as Ops,
  );
  return current.compose(marked);
}

export default function VersionPreview({ when, ops, current, onRestore, onClose, busy }: Props) {
  const [mode, setMode] = useState<Mode>("changes");
  const host = useRef<HTMLDivElement>(null);
  const quill = useRef<Quill | null>(null);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    // No toolbar and no cursors: this is a document to read, and read-only is
    // the whole point — an editable preview would be a second live document
    // that nobody else in the room can see.
    quill.current = new Quill(node, { theme: "snow", readOnly: true, modules: { toolbar: false } });
    return () => {
      quill.current = null;
      node.innerHTML = "";
    };
  }, []);

  useEffect(() => {
    const editor = quill.current;
    if (!editor) return;
    const target = new Delta(ops as Ops);
    const now = new Delta(current as Ops);
    editor.setContents(mode === "version" ? target : markUp(now, target));
  }, [ops, current, mode]);

  const unchanged = mode === "changes" && new Delta(current as Ops).diff(new Delta(ops as Ops)).ops.length === 0;

  return (
    <div className="preview" role="dialog" aria-label={`Version from ${when}`}>
      <div className="preview-head">
        <h2 className="preview-title">{when}</h2>

        <div className="preview-modes" role="group" aria-label="What to show">
          <button
            type="button"
            className="menu-button"
            aria-pressed={mode === "changes"}
            onClick={() => setMode("changes")}
          >
            Changes
          </button>
          <button
            type="button"
            className="menu-button"
            aria-pressed={mode === "version"}
            onClick={() => setMode("version")}
          >
            This version
          </button>
        </div>

        <div className="preview-actions">
          {onRestore && (
            <button type="button" className="menu-button" disabled={busy} onClick={onRestore}>
              {busy ? "Restoring…" : "Restore this"}
            </button>
          )}
          <button type="button" className="menu-button" onClick={onClose}>Close</button>
        </div>
      </div>

      {mode === "changes" && (
        <p className="preview-legend">
          {unchanged
            ? "Nothing would change — this version matches the document as it stands."
            : "Struck through would be removed, highlighted would be added."}
        </p>
      )}

      <div className="preview-body" ref={host} />
    </div>
  );
}
