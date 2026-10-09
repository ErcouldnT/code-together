import { useEffect, useRef, useState } from "react";
import { chooseLanguage, language, LANGUAGE_NAMES, LANGUAGES, t } from "../i18n";
import { recentDocuments, type RecentDocument } from "../recent";

/**
 * Everything you can do to a document that is not typing in it: start a new
 * one, take it away as a file, print it, go back to one you had open before,
 * or read it all in another language.
 */

interface Props {
  documentId: string;
  onShowHistory: () => void;
  onShowAttachments: () => void;
  onNewDocument: () => void;
  onUnlock?: () => void;
  /** absent for a reader */
  onSetExpiry?: () => void;
}

export default function DocumentMenu(
  { documentId, onShowHistory, onShowAttachments, onNewDocument, onUnlock, onSetExpiry }: Props,
) {
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
        {t("menu.document")}
      </button>

      {open && (
        <div className="menu-panel" role="menu">
          <button
            type="button"
            className="menu-item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onNewDocument();
            }}
          >
            {t("menu.new")}
          </button>
          {onUnlock && (
            <button
              type="button"
              className="menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onUnlock();
              }}
            >
              {t("menu.unlock")}
            </button>
          )}
          <hr className="menu-separator" />
          {/* Plain links, not fetch-and-save: the server already sends the
              right Content-Disposition, so the browser's own download does
              the work and keeps working with the tab closed. */}
          <a
            className="menu-item"
            role="menuitem"
            href={`/api/documents/${documentId}/export?format=html`}
            onClick={() => setOpen(false)}
          >
            {t("menu.html")}
          </a>
          <a
            className="menu-item"
            role="menuitem"
            href={`/api/documents/${documentId}/export?format=md`}
            onClick={() => setOpen(false)}
          >
            {t("menu.markdown")}
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
            {t("menu.print")}
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
            {t("menu.history")}
          </button>
          <button
            type="button"
            className="menu-item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onShowAttachments();
            }}
          >
            {t("menu.attachments")}
          </button>
          {onSetExpiry && (
            <button
              type="button"
              className="menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSetExpiry();
              }}
            >
              {t("expiry.menu")}
            </button>
          )}

          {recent.length > 0 && (
            <>
              <p className="menu-heading">{t("menu.recent")}</p>
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

          {/* Picked automatically from the browser; this is for when the
              browser's answer is not the person's. Choosing reloads, because
              every label on the page was read once, at load. */}
          <p className="menu-heading">{t("menu.language")}</p>
          <div className="menu-languages">
            {LANGUAGES.map((code) => (
              <button
                key={code}
                type="button"
                className="menu-item"
                role="menuitemradio"
                aria-checked={code === language}
                lang={code}
                onClick={() => {
                  setOpen(false);
                  if (code !== language) chooseLanguage(code);
                }}
              >
                {LANGUAGE_NAMES[code]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
