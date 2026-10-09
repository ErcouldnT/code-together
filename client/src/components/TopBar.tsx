import { t } from "../i18n";
import type { SaveState } from "../useQuill";
import DocumentMenu from "./DocumentMenu";
import SaveStateBadge from "./SaveState";

/**
 * The document's own row: what it is called, and what you can do with it.
 *
 * Above the toolbar rather than in it. The toolbar is ten format groups and
 * the presence chips already; a title box wide enough to be useful would push
 * it onto a third row on every phone.
 */

interface Props {
  documentId: string;
  title: string;
  onTitleChange: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  onShowHistory: () => void;
  onShowAttachments: () => void;
  onNewDocument: () => void;
  /** present only on a read-only document whose password would make it writable */
  onUnlock?: () => void;
  saveState: SaveState;
  onThisDevice: boolean;
  readOnly: boolean;
  contentsOpen: boolean;
  onToggleContents: () => void;
}

export default function TopBar(
  {
    documentId,
    title,
    onTitleChange,
    onFocus,
    onBlur,
    onShowHistory,
    onShowAttachments,
    onNewDocument,
    onUnlock,
    saveState,
    onThisDevice,
    readOnly,
    contentsOpen,
    onToggleContents,
  }: Props,
) {
  return (
    <header className="topbar">
      <button
        type="button"
        className="topbar-icon"
        aria-pressed={contentsOpen}
        aria-label={contentsOpen ? t("toc.hide") : t("toc.show")}
        title={contentsOpen ? t("toc.hide") : t("toc.show")}
        onClick={onToggleContents}
      >
        {/* an outline: a heading and two indented lines under it */}
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <path
            d="M3 5h14M6 10h11M6 15h11"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <input
        className="topbar-title"
        value={title}
        placeholder={t("topbar.untitled")}
        aria-label={t("topbar.titleLabel")}
        maxLength={120}
        readOnly={readOnly}
        onChange={(event) => onTitleChange(event.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      {/* Nothing a reader does is saved, so "Saved" would be a claim about
          nothing; what they need to know is why the editor will not type. */}
      {readOnly
        ? <span className="savestate" title={t("topbar.readOnlyHint")}>{t("topbar.readOnly")}</span>
        : <SaveStateBadge state={saveState} onThisDevice={onThisDevice} />}
      <DocumentMenu
        documentId={documentId}
        onShowHistory={onShowHistory}
        onShowAttachments={onShowAttachments}
        onNewDocument={onNewDocument}
        onUnlock={onUnlock}
      />
    </header>
  );
}
