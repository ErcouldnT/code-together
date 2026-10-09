import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useParams } from "react-router-dom";
import type { AccessInfo } from "@shared/access";
import { fetchAccess } from "./access";
import AttachmentsPanel from "./components/AttachmentsPanel";
import ConnectionStatus from "./components/ConnectionStatus";
import DocumentSkeleton from "./components/DocumentSkeleton";
import HistoryPanel from "./components/HistoryPanel";
import NewDocumentDialog from "./components/NewDocumentDialog";
import PresenceBar from "./components/PresenceBar";
import TopBar from "./components/TopBar";
import UnlockDialog from "./components/UnlockDialog";
import { useQuill } from "./useQuill";
import { useTitle } from "./useTitle";

/**
 * Asked before anything connects: a document behind a password must not be
 * joined, and one that is read-only must open with the editor already locked
 * rather than unlocking and then snapping shut.
 *
 * If the question cannot be asked — offline, which this app otherwise copes
 * with — the document opens as if it were public. That gives nothing away:
 * the socket asks the server the same question on join, and a refusal there
 * still holds. What it keeps is the offline reload that shows the copy kept in
 * this browser instead of an error.
 */
const UNKNOWN: AccessInfo = { protect: null, read: true, write: true };

export default function Editor() {
  const { id: documentId } = useParams<{ id: string }>();
  const [access, setAccess] = useState<{ id: string; info: AccessInfo } | null>(null);

  useEffect(() => {
    if (!documentId) return;
    let live = true;
    fetchAccess(documentId)
      .catch(() => UNKNOWN)
      .then((info) => {
        if (live) setAccess({ id: documentId, info });
      });
    return () => {
      live = false;
    };
  }, [documentId]);

  // The answer for the previous address does not count for this one.
  if (!documentId || access?.id !== documentId) return null;
  if (!access.info.read) return <UnlockDialog documentId={documentId} reason="view" />;
  return <DocumentView key={documentId} documentId={documentId} access={access.info} />;
}

function DocumentView({ documentId, access }: { documentId: string; access: AccessInfo }) {
  const readOnly = !access.write;
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
    saveState,
    onThisDevice,
  } = useQuill(documentId, readOnly);
  const { title, setTitle, onFocus, onBlur } = useTitle(provider, documentId);
  // One panel at a time: they sit in the same place.
  const [panel, setPanel] = useState<"history" | "attachments" | null>(null);
  const [dialog, setDialog] = useState<"new" | "unlock" | null>(null);

  return (
    <>
      <TopBar
        documentId={documentId}
        title={title}
        onTitleChange={setTitle}
        onFocus={onFocus}
        onBlur={onBlur}
        onShowHistory={() => setPanel("history")}
        onShowAttachments={() => setPanel("attachments")}
        onNewDocument={() => setDialog("new")}
        onUnlock={access.protect === "edit" && readOnly ? () => setDialog("unlock") : undefined}
        saveState={saveState}
        onThisDevice={onThisDevice}
        readOnly={readOnly}
      />

      {panel === "history" && (
        <HistoryPanel
          documentId={documentId}
          provider={provider}
          readOnly={readOnly}
          onClose={() => setPanel(null)}
        />
      )}

      {panel === "attachments" && (
        <AttachmentsPanel
          documentId={documentId}
          provider={provider}
          addedBy={identity.name}
          readOnly={readOnly}
          onClose={() => setPanel(null)}
        />
      )}

      {dialog === "new" && <NewDocumentDialog onClose={() => setDialog(null)} />}
      {dialog === "unlock" && (
        <UnlockDialog documentId={documentId} reason="edit" onClose={() => setDialog(null)} />
      )}

      {/* One place for status, loading or not: the skeleton is the shape of the
          document, the notice bar is the words about it. */}
      <ConnectionStatus status={status} problem={problem} uploading={uploading} />

      <div className="container" ref={containerRef} data-readonly={readOnly || undefined} />

      {!ready && editorArea && createPortal(<DocumentSkeleton problem={problem} />, editorArea)}

      {toolbar
        && createPortal(
          <PresenceBar provider={provider} identity={identity} onRename={rename} />,
          toolbar,
        )}
    </>
  );
}
