import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useParams } from "react-router-dom";
import type { AccessInfo } from "@shared/access";
import { fetchAccess } from "./access";
import AttachmentsPanel from "./components/AttachmentsPanel";
import ConnectionStatus from "./components/ConnectionStatus";
import DocumentSkeleton from "./components/DocumentSkeleton";
import ExpiredNotice from "./components/ExpiredNotice";
import ExpiryDialog from "./components/ExpiryDialog";
import HistoryPanel from "./components/HistoryPanel";
import NewDocumentDialog from "./components/NewDocumentDialog";
import PresenceBar from "./components/PresenceBar";
import TableOfContents, { useHeadings } from "./components/TableOfContents";
import TopBar from "./components/TopBar";
import UnlockDialog from "./components/UnlockDialog";
import { useExpiry } from "./expiry";
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
const UNKNOWN: AccessInfo = { protect: null, read: true, write: true, expiresAt: null };

/** Wide enough for the outline to sit beside the page instead of over it. */
const WIDE = "(min-width: 70em)";
const TOC_KEY = "code-together:toc";

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/**
 * Whether the outline is open. On a wide screen it is a column people leave
 * open, so the choice is remembered — open unless they closed it. On a narrow
 * one it is a drawer opened for a moment, so it always starts shut.
 */
function useContentsOpen(wide: boolean): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => {
    if (!wide) return false;
    try {
      return localStorage.getItem(TOC_KEY) !== "closed";
    }
    catch {
      return true;
    }
  });
  useEffect(() => {
    if (!wide) setOpen(false);
  }, [wide]);
  const choose = useCallback((next: boolean) => {
    setOpen(next);
    if (!wide) return;
    try {
      localStorage.setItem(TOC_KEY, next ? "open" : "closed");
    }
    catch {
      // without storage the choice lasts as long as the page
    }
  }, [wide]);
  return [open, choose];
}

export default function Editor() {
  const { id: documentId } = useParams<{ id: string }>();
  const [access, setAccess] = useState<{ id: string; info: AccessInfo } | null>(null);
  /** the address whose document expired while it was open here */
  const [expired, setExpired] = useState<string | null>(null);

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
  if (access.info.expired || expired === documentId) return <ExpiredNotice documentId={documentId} />;
  if (!access.info.read) return <UnlockDialog documentId={documentId} reason="view" />;
  return (
    <DocumentView
      key={documentId}
      documentId={documentId}
      access={access.info}
      onExpired={() => setExpired(documentId)}
    />
  );
}

interface DocumentViewProps {
  documentId: string;
  access: AccessInfo;
  onExpired: () => void;
}

function DocumentView({ documentId, access, onExpired }: DocumentViewProps) {
  const readOnly = !access.write;
  const {
    containerRef,
    quill,
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
  } = useQuill(documentId, readOnly, onExpired);
  const [expiresAt, setExpiresAt] = useExpiry(provider, access.expiresAt);
  const { title, setTitle, onFocus, onBlur } = useTitle(provider, documentId);
  // One panel at a time: they sit in the same place.
  const [panel, setPanel] = useState<"history" | "attachments" | null>(null);
  const [dialog, setDialog] = useState<"new" | "unlock" | "expiry" | null>(null);
  const wide = useMediaQuery(WIDE);
  const [contentsOpen, setContentsOpen] = useContentsOpen(wide);
  const headings = useHeadings(quill);
  const closeContents = useCallback(() => setContentsOpen(false), [setContentsOpen]);

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
        expiresAt={expiresAt}
        onSetExpiry={readOnly ? undefined : () => setDialog("expiry")}
        contentsOpen={contentsOpen}
        onToggleContents={() => setContentsOpen(!contentsOpen)}
      />

      {contentsOpen && <TableOfContents headings={headings} overlay={!wide} onClose={closeContents} />}

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
      {dialog === "expiry" && (
        <ExpiryDialog
          documentId={documentId}
          expiresAt={expiresAt}
          onChange={setExpiresAt}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "unlock" && (
        <UnlockDialog documentId={documentId} reason="edit" onClose={() => setDialog(null)} />
      )}

      {/* One place for status, loading or not: the skeleton is the shape of the
          document, the notice bar is the words about it. */}
      <ConnectionStatus status={status} problem={problem} uploading={uploading} />

      <div
        className="container"
        ref={containerRef}
        data-readonly={readOnly || undefined}
        data-toc={(contentsOpen && wide) || undefined}
      />

      {!ready && editorArea && createPortal(<DocumentSkeleton problem={problem} />, editorArea)}

      {toolbar
        && createPortal(
          <PresenceBar provider={provider} identity={identity} onRename={rename} />,
          toolbar,
        )}
    </>
  );
}
