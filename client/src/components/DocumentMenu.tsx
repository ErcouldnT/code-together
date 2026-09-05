import { useEffect, useRef, useState } from "react";
import { recentDocuments, type RecentDocument } from "../recent";

/**
 * Everything you can do to a document that is not typing in it: take it away
 * as a file, print it, or go back to one you had open before.
 */

interface Props {
  documentId: string;
  onShowHistory: () => void;
}

export default function DocumentMenu({ documentId, onShowHistory }: Props) {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<RecentDocument[]>([]);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Read when it opens, not on every render: the list changes as you type a
    // title, and a menu that reorders itself under the pointer is unusable.
    setRecent(recentDocuments().filter((entry) => entry.id !== documentId));

    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, documentId]);

  return (
    <div className="menu" ref={root}>
      <button
        type="button"
        className="menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        Document
      </button>

      {open && (
        <div className="menu-panel" role="menu">
          {/* Plain links, not fetch-and-save: the server already sends the
              right Content-Disposition, so the browser's own download does
              the work and keeps working with the tab closed. */}
          <a
            className="menu-item"
            role="menuitem"
            href={`/api/documents/${documentId}/export?format=html`}
            onClick={() => setOpen(false)}
          >
            Download as HTML
          </a>
          <a
            className="menu-item"
            role="menuitem"
            href={`/api/documents/${documentId}/export?format=md`}
            onClick={() => setOpen(false)}
          >
            Download as Markdown
          </a>
          <button
            type="button"
            className="menu-item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              // The print stylesheet lays the document out on paper already,
              // so "save as PDF" in the print dialogue is the PDF export.
              window.print();
            }}
          >
            Print, or save as PDF
          </button>
          <button
            type="button"
            className="menu-item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onShowHistory();
            }}
          >
            Version history
          </button>

          {recent.length > 0 && (
            <>
              <p className="menu-heading">Recent</p>
              {recent.map((entry) => (
                <a
                  key={entry.id}
                  className="menu-item menu-recent"
                  role="menuitem"
                  href={`/${entry.id}`}
                  onClick={() => setOpen(false)}
                >
                  {entry.title || entry.id}
                </a>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
