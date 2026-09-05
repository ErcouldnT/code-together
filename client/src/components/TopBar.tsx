import DocumentMenu from "./DocumentMenu";

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
}

export default function TopBar(
  { documentId, title, onTitleChange, onFocus, onBlur, onShowHistory }: Props,
) {
  return (
    <header className="topbar">
      <input
        className="topbar-title"
        value={title}
        placeholder="Untitled document"
        aria-label="Document title"
        maxLength={120}
        onChange={(event) => onTitleChange(event.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      <DocumentMenu documentId={documentId} onShowHistory={onShowHistory} />
    </header>
  );
}
