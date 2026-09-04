import Quill from "quill";
import QuillCursors from "quill-cursors";
import { useCallback, useEffect, useState } from "react";
import { QuillBinding } from "y-quill";
import { TEXT_KEY } from "@shared/ydoc";
import { connect } from "./socket";
import { SocketProvider, type ProviderStatus } from "./yjs/socketProvider";
import "quill/dist/quill.snow.css";

Quill.register("modules/cursors", QuillCursors);

const TOOLBAR_OPTIONS = [
  [{ header: [1, 2, 3, 4, 5, 6, false] }],
  [{ font: [] }],
  [{ list: "ordered" }, { list: "bullet" }],
  ["bold", "italic", "underline"],
  [{ color: [] }, { background: [] }],
  [{ script: "sub" }, { script: "super" }],
  [{ align: [] }],
  ["image", "blockquote", "code-block"],
  ["clean"],
];

/** Something the user needs to know, because the alternative is typing into a void. */
const MESSAGES = {
  "bad-id": "That is not a valid document address.",
  "too-large": "This document has grown too large to open.",
  "too-fast": "Slow down — some changes were not saved.",
  "document-full": "This document is full; new changes are not being saved.",
  "not-joined": "Not connected to the document yet.",
} as const;

export interface EditorState {
  containerRef: (node: HTMLDivElement | null) => void;
  status: ProviderStatus;
  /** null when everything is fine */
  problem: string | null;
}

/**
 * Quill, a Yjs document and the socket that carries it, wired together.
 *
 * What used to be four `useEffect`s of hand-rolled delta plumbing and a
 * two-second `setInterval` that overwrote the whole document is now one
 * `QuillBinding`. The old arrangement lost data whenever two people typed at
 * the same position: deltas were rebroadcast without being transformed against
 * each other, so the two documents diverged and the next full-document save
 * silently overwrote whichever one arrived first.
 */
export function useQuill(documentId: string | undefined): EditorState {
  const [quill, setQuill] = useState<Quill | null>(null);
  const [provider, setProvider] = useState<SocketProvider | null>(null);
  const [status, setStatus] = useState<ProviderStatus>("connecting");
  const [problem, setProblem] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const containerRef = useCallback((wrapper: HTMLDivElement | null) => {
    if (!wrapper) return;
    wrapper.innerHTML = "";
    const editor = document.createElement("div");
    wrapper.append(editor);

    const instance = new Quill(editor, {
      theme: "snow",
      placeholder: "Loading…",
      modules: { toolbar: TOOLBAR_OPTIONS, cursors: true },
    });
    // Disabled until the first sync lands. Typing before then is not lost —
    // Yjs merges it — but writing into a document that is about to fill in
    // around you reads as a bug.
    instance.disable();
    setQuill(instance);

    return () => {
      setQuill(null);
      wrapper.innerHTML = "";
    };
  }, []);

  useEffect(() => {
    if (!documentId) return;
    setReady(false);
    setProblem(null);

    const socket = connect();
    const instance = new SocketProvider(socket, documentId, {
      onStatus: (next) => {
        setStatus(next);
        if (next === "synced") setReady(true);
      },
      onJoinError: (reason) => setProblem(MESSAGES[reason]),
      onRejected: (reason) => setProblem(MESSAGES[reason]),
    });
    setProvider(instance);

    return () => {
      instance.destroy();
      socket.disconnect();
      setProvider(null);
    };
  }, [documentId]);

  useEffect(() => {
    if (!quill || !provider) return;
    const binding = new QuillBinding(
      provider.doc.getText(TEXT_KEY),
      quill,
      provider.awareness,
    );
    return () => binding.destroy();
  }, [quill, provider]);

  useEffect(() => {
    if (!quill) return;
    if (ready) quill.enable();
    else quill.disable();
  }, [quill, ready]);

  return { containerRef, status, problem };
}
