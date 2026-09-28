import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteAttachment,
  downloadUrl,
  formatBytes,
  listAttachments,
  uploadAttachment,
  type Attachment,
} from "../attachments";
import type { SocketProvider } from "../yjs/socketProvider";

/**
 * Files that travel with the document. Same panel shape as the version
 * history, and for the same reason: nothing here should hide the text.
 *
 * Deleting is immediate and final — the file is removed from the server, not
 * hidden — so it takes a second click in the row rather than a browser
 * confirm(), which would block every other tab's socket while it is open.
 */

interface Props {
  documentId: string;
  provider: SocketProvider | null;
  addedBy: string;
  onClose: () => void;
}

interface Pending {
  key: number;
  name: string;
  progress: number;
}

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export default function AttachmentsPanel({ documentId, provider, addedBy, onClose }: Props) {
  const [attachments, setAttachments] = useState<Attachment[] | null>(null);
  const [maxBytes, setMaxBytes] = useState<number | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const nextKey = useRef(0);

  const refresh = useCallback(() => {
    listAttachments(documentId)
      .then((data) => {
        setAttachments(data.attachments);
        setMaxBytes(data.maxBytes);
      })
      .catch((cause: Error) => setError(cause.message));
  }, [documentId]);

  useEffect(refresh, [refresh]);

  // Someone else in the room added or removed a file.
  useEffect(() => {
    const socket = provider?.socket;
    if (!socket) return;
    socket.on("attachments-changed", refresh);
    return () => {
      socket.off("attachments-changed", refresh);
    };
  }, [provider, refresh]);

  async function add(files: FileList | File[]) {
    setError(null);
    for (const file of Array.from(files)) {
      if (maxBytes !== null && file.size > maxBytes) {
        setError(`“${file.name}” is larger than ${formatBytes(maxBytes)}.`);
        continue;
      }
      const key = nextKey.current++;
      setPending((was) => [...was, { key, name: file.name, progress: 0 }]);
      try {
        await uploadAttachment(documentId, file, addedBy, (progress) => {
          setPending((was) => was.map((entry) => (entry.key === key ? { ...entry, progress } : entry)));
        });
        refresh();
      }
      catch (cause) {
        setError((cause as Error).message);
      }
      finally {
        setPending((was) => was.filter((entry) => entry.key !== key));
      }
    }
  }

  async function remove(id: string) {
    setConfirming(null);
    setError(null);
    try {
      await deleteAttachment(documentId, id);
      setAttachments((was) => was?.filter((entry) => entry.id !== id) ?? null);
    }
    catch (cause) {
      setError((cause as Error).message);
    }
  }

  return (
    <div
      className={`history attachments${dragging ? " attachments-dragging" : ""}`}
      role="dialog"
      aria-label="Attachments"
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void add(event.dataTransfer.files);
      }}
    >
      <div className="history-head">
        <h2 className="history-title">Attachments</h2>
        <button type="button" className="menu-button" onClick={onClose}>Close</button>
      </div>

      <button type="button" className="menu-button attachments-add" onClick={() => input.current?.click()}>
        Add files…
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) void add(event.target.files);
          event.target.value = "";
        }}
      />
      <p className="history-empty">
        Or drop files here{maxBytes !== null && ` — up to ${formatBytes(maxBytes)} each`}.
      </p>

      {error && <p className="history-error">{error}</p>}

      {pending.map((entry) => (
        <div className="history-row" key={`pending-${entry.key}`}>
          <span className="attachments-name">{entry.name}</span>
          <progress className="attachments-progress" value={entry.progress} max={1} />
        </div>
      ))}

      {attachments === null && !error && <p className="history-empty">Loading…</p>}
      {attachments?.length === 0 && pending.length === 0 && (
        <p className="history-empty">No files attached yet.</p>
      )}

      {attachments?.map((entry) => (
        <div className="history-row" key={entry.id}>
          <div className="attachments-info">
            <span className="attachments-name" title={entry.name}>{entry.name}</span>
            <span className="attachments-meta">
              {formatBytes(entry.size)} · {when.format(entry.createdAt)}
              {entry.addedBy && ` · ${entry.addedBy}`}
            </span>
          </div>
          {confirming === entry.id
            ? (
              <div className="history-confirm">
                <button type="button" className="menu-button attachments-danger" onClick={() => void remove(entry.id)}>
                  Delete
                </button>
                <button type="button" className="menu-button" onClick={() => setConfirming(null)}>
                  Keep
                </button>
              </div>
            )
            : (
              <div className="history-confirm">
                {/* A plain link: the server sends the attachment disposition,
                    so the browser's own download does the work. */}
                <a className="menu-button" href={downloadUrl(documentId, entry.id)} download={entry.name}>
                  Download
                </a>
                <button type="button" className="menu-button" onClick={() => setConfirming(entry.id)}>
                  Delete
                </button>
              </div>
            )}
        </div>
      ))}
    </div>
  );
}
