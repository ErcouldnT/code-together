import { useState } from "react";
import { createPortal } from "react-dom";
import { useParams } from "react-router-dom";
import ConnectionStatus from "./components/ConnectionStatus";
import DocumentSkeleton from "./components/DocumentSkeleton";
import HistoryPanel from "./components/HistoryPanel";
import PresenceBar from "./components/PresenceBar";
import TopBar from "./components/TopBar";
import { useQuill } from "./useQuill";
import { useTitle } from "./useTitle";

export default function Editor() {
  const { id: documentId } = useParams<{ id: string }>();
  const {
    containerRef,
    status,
    problem,
    uploading,
    ready,
    provider,
    toolbar,
    editorArea,
    identity,
    rename,
  } = useQuill(documentId);
  const { title, setTitle, onFocus, onBlur } = useTitle(provider, documentId);
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <>
      {documentId && (
        <TopBar
          documentId={documentId}
          title={title}
          onTitleChange={setTitle}
          onFocus={onFocus}
          onBlur={onBlur}
          onShowHistory={() => setHistoryOpen(true)}
        />
      )}

      {historyOpen && documentId && (
        <HistoryPanel
          documentId={documentId}
          provider={provider}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {/* One place for status, loading or not: the skeleton is the shape of the
          document, the notice bar is the words about it. */}
      <ConnectionStatus status={status} problem={problem} uploading={uploading} />

      <div className="container" ref={containerRef} />

      {!ready && editorArea && createPortal(<DocumentSkeleton problem={problem} />, editorArea)}

      {toolbar
        && createPortal(
          <PresenceBar provider={provider} identity={identity} onRename={rename} />,
          toolbar,
        )}
    </>
  );
}
