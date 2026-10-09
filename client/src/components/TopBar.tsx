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
  }: Props,
) {
  return (
    <header className="topbar">
      <input
        className="topbar-title"
        value={title}
        placeholder="Untitled document"
        aria-label="Document title"
        maxLength={120}
        readOnly={readOnly}
        onChange={(event) => onTitleChange(event.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      {/* Nothing a reader does is saved, so "Saved" would be a claim about
          nothing; what they need to know is why the editor will not type. */}
      {readOnly
        ? <span className="savestate" title="You can read this document but not change it.">Read only</span>
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
