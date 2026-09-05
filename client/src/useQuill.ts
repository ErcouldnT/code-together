import Quill from "quill";
import QuillCursors from "quill-cursors";
import { useCallback, useEffect, useRef, useState } from "react";
import { QuillBinding } from "y-quill";
import { TEXT_KEY } from "@shared/ydoc";
import { catchPastedDataUrls, createInserter, IMAGE_MIME_TYPES, type Inserter } from "./editor-images";
import { loadIdentity, saveIdentity, type Identity } from "./identity";
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
  /** how many pictures are on their way up */
  uploading: number;
  /** null until the socket exists; presence reads awareness off it */
  provider: SocketProvider | null;
  /**
   * Quill builds its own toolbar element, so the presence chips are portalled
   * into it rather than positioned next to it — that way they sit in the same
   * flex row and wrap onto their own line on a phone, instead of floating over
   * the buttons.
   */
  toolbar: HTMLElement | null;
  identity: Identity;
  rename: (name: string) => void;
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
  const [uploading, setUploading] = useState(0);
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null);
  const [identity, setIdentity] = useState<Identity>(loadIdentity);

  /*
   * Quill is built before the document exists, but its image handling has to
   * reach the document to insert anything. The ref is that seam: Quill's
   * options are fixed at construction and always call through here, and the
   * effect below fills it in once the provider has arrived.
   */
  const inserter = useRef<Inserter | null>(null);

  const containerRef = useCallback((wrapper: HTMLDivElement | null) => {
    if (!wrapper) return;
    wrapper.innerHTML = "";
    const editor = document.createElement("div");
    wrapper.append(editor);

    const instance = new Quill(editor, {
      theme: "snow",
      placeholder: "Loading…",
      modules: {
        toolbar: {
          container: TOOLBAR_OPTIONS,
          // Without this the button keeps Quill's own behaviour, which is to
          // embed the picture as base64 — the one thing uploads exist to stop.
          handlers: { image: () => inserter.current?.choose() },
        },
        cursors: true,
        // Quill routes both pasted files and dropped files here.
        uploader: {
          mimetypes: IMAGE_MIME_TYPES,
          handler: (_range: unknown, files: File[]) => {
            void inserter.current?.insert(files);
          },
        },
      },
    });
    // Disabled until the first sync lands. Typing before then is not lost —
    // Yjs merges it — but writing into a document that is about to fill in
    // around you reads as a bug.
    instance.disable();
    setQuill(instance);
    setToolbar((instance.getModule("toolbar") as { container?: HTMLElement } | undefined)?.container ?? null);

    return () => {
      setQuill(null);
      setToolbar(null);
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
    const text = provider.doc.getText(TEXT_KEY);
    const binding = new QuillBinding(text, quill, provider.awareness);

    const images = createInserter({
      quill,
      doc: provider.doc,
      text,
      onBusy: setUploading,
      onError: setProblem,
    });
    inserter.current = images;
    catchPastedDataUrls(quill, images);

    return () => {
      inserter.current = null;
      binding.destroy();
    };
  }, [quill, provider]);

  useEffect(() => {
    if (!quill) return;
    if (ready) quill.enable();
    else quill.disable();
  }, [quill, ready]);

  // The name and colour every other person sees on this cursor. y-quill reads
  // `user.name` and `user.color` straight off the awareness state; without
  // them a cursor is an orange bar labelled "User: 2847391043".
  useEffect(() => {
    provider?.awareness.setLocalStateField("user", identity);
  }, [provider, identity]);

  const rename = useCallback((name: string) => {
    setIdentity((current) => {
      const next = { ...current, name };
      saveIdentity(next);
      return next;
    });
  }, []);

  return { containerRef, status, problem, uploading, provider, toolbar, identity, rename };
}
