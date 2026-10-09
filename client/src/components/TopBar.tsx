import { timeLeft, useNow } from "../expiry";
import { dateTimeFormat, t } from "../i18n";
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
  /** when the document deletes itself, if it does */
  expiresAt: number | null;
  /** absent for a reader, who cannot change it */
  onSetExpiry?: () => void;
}

const when = dateTimeFormat({ dateStyle: "medium", timeStyle: "short" });

/**
 * A countdown, next to the title, for a document that will delete itself —
 * the one fact about it everybody in the room needs to have seen. A button
 * for those who may change it, a plain label for those who may not.
 */
function ExpiryBadge({ expiresAt, onClick }: { expiresAt: number; onClick?: () => void }) {
  const now = useNow();
  const left = expiresAt - now;
  const duration = timeLeft(left);
  const text = t("expiry.badge", { left: duration });
  const hint = t("expiry.badgeHint", { when: when.format(expiresAt) });
  const soon = left < 60 * 60 * 1000;
  // On a phone the sentence would take the title's room; the hourglass and
  // the time say it, and the sentence stays as the accessible name.
  const content = (
    <>
      <svg className="expiry-icon" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
        <path
          d="M6 3h12M6 21h12M7.5 3c0 5 9 5 9 9s-9 4-9 9M16.5 3c0 5-9 5-9 9s9 4 9 9"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </svg>
      <span className="expiry-long">{text}</span>
      <span className="expiry-short" aria-hidden="true">{duration}</span>
    </>
  );
  return onClick
    ? (
        <button
          type="button"
          className="expiry-badge"
          data-soon={soon || undefined}
          title={hint}
          aria-label={text}
          onClick={onClick}
        >
          {content}
        </button>
      )
    : <span className="expiry-badge" data-soon={soon || undefined} title={hint} aria-label={text}>{content}</span>;
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
    expiresAt,
    onSetExpiry,
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
      {expiresAt !== null && <ExpiryBadge expiresAt={expiresAt} onClick={onSetExpiry} />}
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
        onSetExpiry={onSetExpiry}
      />
    </header>
  );
}
