import Quill from "quill";
import QuillCursors from "quill-cursors";
import { useCallback, useEffect, useRef, useState } from "react";
import { QuillBinding } from "y-quill";
import type { JoinErrorReason, UpdateRejection } from "@shared/events";
import { TEXT_KEY } from "@shared/ydoc";
import { catchPastedDataUrls, createInserter, IMAGE_MIME_TYPES, type Inserter } from "./editor-images";
import { t } from "./i18n";
import { loadIdentity, saveIdentity, type Identity } from "./identity";
import { markdownBindings } from "./markdown";
import { pasteMarkdown } from "./markdown-paste";
import { keepTokensLocal, refreshCodePickers, syntaxOptions } from "./syntax";
import { connect } from "./socket";
import { keepLocalCopy } from "./yjs/offline";
import { SocketProvider, type ProviderStatus } from "./yjs/socketProvider";
import "quill/dist/quill.snow.css";

Quill.register("modules/cursors", QuillCursors);

const TOOLBAR_OPTIONS = [
  [{ header: [1, 2, 3, 4, 5, 6, false] }],
  [{ font: [] }],
  [{ list: "ordered" }, { list: "bullet" }, { list: "check" }],
  ["bold", "italic", "underline", "strike"],
  [{ color: [] }, { background: [] }],
  [{ script: "sub" }, { script: "super" }],
  [{ align: [] }],
  ["link", "image", "blockquote", "code-block"],
  ["clean"],
];

/** Something the user needs to know, because the alternative is typing into a void. */
const message = (reason: JoinErrorReason | UpdateRejection): string => t(`problem.${reason}`);

/**
 * What the save indicator says. Coarse on purpose: the useful question is
 * whether the document is somewhere other than this tab yet.
 */
export type SaveState = "saving" | "saved" | "offline";

export interface EditorState {
  containerRef: (node: HTMLDivElement | null) => void;
  /** the editor itself, for things that read the document's shape */
  quill: Quill | null;
  status: ProviderStatus;
  /** null when everything is fine */
  problem: string | null;
  /** how many pictures are on their way up */
  uploading: number;
  /**
   * True while this tab holds work that closing it would destroy — a picture
   * still uploading, or an unsent edit in a browser with no local copy to
   * recover from. The browser is asked to confirm the close.
   */
  unsaved: boolean;
  /** for the indicator in the title row */
  saveState: SaveState;
  /** whether a copy of the document is kept in this browser's storage */
  onThisDevice: boolean;
  /** false until the first sync lands — the skeleton is up until it does */
  ready: boolean;
  /** null until the socket exists; presence reads awareness off it */
  provider: SocketProvider | null;
  /**
   * Quill builds its own toolbar element, so the presence chips are portalled
   * into it rather than positioned next to it — that way they sit in the same
   * flex row and wrap onto their own line on a phone, instead of floating over
   * the buttons.
   */
  toolbar: HTMLElement | null;
  /**
   * Quill's editor wrapper. The loading skeleton is portalled in here rather
   * than laid over the whole page: covering the toolbar too would mean the
   * toolbar appears when the document arrives, pushing the sheet down by its
   * own height — the exact jump the skeleton exists to avoid.
   */
  editorArea: HTMLElement | null;
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
export function useQuill(
  documentId: string | undefined,
  readOnly = false,
  /** the document expired while open: there is nothing left to edit */
  onExpired?: () => void,
): EditorState {
  const expiredRef = useRef(onExpired);
  expiredRef.current = onExpired;
  const [quill, setQuill] = useState<Quill | null>(null);
  const [provider, setProvider] = useState<SocketProvider | null>(null);
  const [status, setStatus] = useState<ProviderStatus>("connecting");
  const [problem, setProblem] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [pending, setPending] = useState(false);
  const [onThisDevice, setOnThisDevice] = useState(false);
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null);
  const [editorArea, setEditorArea] = useState<HTMLElement | null>(null);
  const [identity, setIdentity] = useState<Identity>(loadIdentity);

  /*
   * Quill is built before the document exists, but its image handling has to
   * reach the document to insert anything. The ref is that seam: Quill's
   * options are fixed at construction and always call through here, and the
   * effect below fills it in once the provider has arrived.
   */
  const inserter = useRef<Inserter | null>(null);
  const identityRef = useRef(identity);
  identityRef.current = identity;

  const containerRef = useCallback((wrapper: HTMLDivElement | null) => {
    if (!wrapper) return;
    wrapper.innerHTML = "";
    const editor = document.createElement("div");
    wrapper.append(editor);

    const instance = new Quill(editor, {
      theme: "snow",
      placeholder: t("editor.placeholder"),
      modules: {
        toolbar: {
          container: TOOLBAR_OPTIONS,
          // Without this the button keeps Quill's own behaviour, which is to
          // embed the picture as base64 — the one thing uploads exist to stop.
          handlers: { image: () => inserter.current?.choose() },
        },
        cursors: true,
        keyboard: { bindings: markdownBindings },
        syntax: syntaxOptions,
        // Quill routes both pasted files and dropped files here.
        uploader: {
          mimetypes: IMAGE_MIME_TYPES,
          handler: (_range: unknown, files: File[]) => {
            void inserter.current?.insert(files);
          },
        },
      },
    });
    // Disabled until the first sync lands, and covered by the skeleton until
    // then. Typing before then would not be lost — Yjs merges it — but writing
    // into a document that is about to fill in around you reads as a bug.
    instance.disable();
    /*
     * The uploader only passes on files whose type is in `mimetypes`, and
     * silently drops the rest. Its `upload` is the single point both a drop and
     * a pasted file reach, with the drop position already worked out, so the
     * other files are split off there and attached instead of being lost.
     */
    const uploader = instance.getModule("uploader") as {
      upload: (range: { index: number } | null, files: FileList | File[]) => void;
    };
    const uploadImages = uploader.upload.bind(uploader);
    uploader.upload = (range, files) => {
      // Quill takes drops on a disabled editor too, and the server would
      // refuse what they lead to; better not to start an upload at all.
      if (!instance.isEnabled()) return;
      const all = Array.from(files);
      const isImage = (file: File) => IMAGE_MIME_TYPES.includes(file.type);
      uploadImages(range, all.filter(isImage));
      const others = all.filter((file) => !isImage(file));
      if (others.length > 0) void inserter.current?.attach(others, range?.index);
    };

    const stopPasting = pasteMarkdown(instance);

    setQuill(instance);
    setToolbar((instance.getModule("toolbar") as { container?: HTMLElement } | undefined)?.container ?? null);
    setEditorArea(instance.container);

    return () => {
      stopPasting();
      setQuill(null);
      setToolbar(null);
      setEditorArea(null);
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
      onUnsaved: setPending,
      onJoinError: (reason) => {
        if (reason === "expired" && expiredRef.current) expiredRef.current();
        else setProblem(message(reason));
      },
      onRejected: (reason) => setProblem(message(reason)),
    });
    setProvider(instance);

    // Reading the stored copy is what makes an offline reload show the
    // document instead of an empty page, so the editor opens on it without
    // waiting for a server that may not answer.
    const local = keepLocalCopy(instance.doc, documentId);
    setOnThisDevice(local !== null);
    let live = true;
    void local?.whenLoaded.then(() => {
      if (live) setReady(true);
    });

    return () => {
      live = false;
      local?.destroy();
      instance.destroy();
      socket.disconnect();
      setProvider(null);
      setPending(false);
      setOnThisDevice(false);
    };
  }, [documentId]);

  useEffect(() => {
    if (!quill || !provider) return;
    const text = provider.doc.getText(TEXT_KEY);
    const binding = new QuillBinding(text, quill, provider.awareness);
    keepTokensLocal(binding, quill);

    const images = createInserter({
      quill,
      doc: provider.doc,
      text,
      onBusy: setUploading,
      onError: setProblem,
      documentId: provider.documentId,
      addedBy: () => identityRef.current.name,
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
    if (ready && !readOnly) quill.enable();
    else quill.disable();
    refreshCodePickers(quill);
  }, [quill, ready, readOnly]);

  // The name and colour every other person sees on this cursor. y-quill reads
  // `user.name` and `user.color` straight off the awareness state; without
  // them a cursor is an orange bar labelled "User: 2847391043".
  useEffect(() => {
    provider?.awareness.setLocalStateField("user", identity);
  }, [provider, identity]);

  /*
   * A picture still climbing is lost on close whatever else is true: the bytes
   * live in this tab and nowhere else until the upload finishes. Unsent edits
   * only matter here when there is no copy on this device to come back to.
   */
  const saveState: SaveState = status === "offline"
    ? "offline"
    : pending || uploading > 0 || status !== "synced"
      ? "saving"
      : "saved";

  const unsaved = uploading > 0 || (pending && !onThisDevice);

  /*
   * The only moment the browser lets us speak up. `preventDefault` is what asks
   * for the dialog; the wording is the browser's own and cannot be set, so
   * there is nothing to write here. Registered only while something really is
   * outstanding — a listener that is always attached makes some browsers treat
   * every close as risky.
   */
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  const rename = useCallback((name: string) => {
    setIdentity((current) => {
      const next = { ...current, name };
      saveIdentity(next);
      return next;
    });
  }, []);

  return {
    containerRef,
    quill,
    status,
    problem,
    uploading,
    unsaved,
    saveState,
    onThisDevice,
    ready,
    provider,
    toolbar,
    editorArea,
    identity,
    rename,
  };
}
