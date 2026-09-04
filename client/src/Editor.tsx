import Quill, { Delta } from "quill";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { DeltaOp, DocumentData } from "@shared/events";
import { connect, type AppSocket } from "./socket";
import "quill/dist/quill.snow.css";

const SAVE_INTERVAL_MS = 2000;
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

type DeltaOps = ConstructorParameters<typeof Delta>[0];

function toDelta(payload: DeltaOp[] | DocumentData): Delta {
  const ops = Array.isArray(payload) ? payload : payload.ops;
  return new Delta((ops ?? []) as DeltaOps);
}

function toDocumentData(delta: Delta): DocumentData {
  return { ops: delta.ops as DocumentData["ops"] };
}

export default function Editor() {
  const { id: documentId } = useParams<{ id: string }>();
  const [socket, setSocket] = useState<AppSocket>();
  const [quill, setQuill] = useState<Quill>();

  useEffect(() => {
    const s = connect();
    setSocket(s);
    return () => {
      s.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!socket || !quill || !documentId) return;

    socket.once("load-document", (document) => {
      quill.setContents(toDelta(document));
      quill.enable();
    });

    socket.emit("get-document", documentId);
  }, [socket, quill, documentId]);

  useEffect(() => {
    if (!socket || !quill) return;

    const interval = setInterval(() => {
      socket.emit("save-document", toDocumentData(quill.getContents()));
    }, SAVE_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [socket, quill]);

  useEffect(() => {
    if (!socket || !quill) return;

    const handler = (delta: DeltaOp[] | DocumentData) => {
      quill.updateContents(toDelta(delta));
    };
    socket.on("receive-changes", handler);

    return () => {
      socket.off("receive-changes", handler);
    };
  }, [socket, quill]);

  useEffect(() => {
    if (!socket || !quill) return;

    const handler = (delta: Delta, _oldDelta: Delta, source: string) => {
      if (source !== "user") return;
      socket.emit("send-changes", toDocumentData(delta));
    };
    quill.on("text-change", handler);

    return () => {
      quill.off("text-change", handler);
    };
  }, [socket, quill]);

  const wrapperRef = useCallback((wrapper: HTMLDivElement | null) => {
    if (wrapper === null) return;

    wrapper.innerHTML = "";
    const editor = document.createElement("div");
    wrapper.append(editor);

    const q = new Quill(editor, {
      theme: "snow",
      modules: { toolbar: TOOLBAR_OPTIONS },
    });
    q.disable();
    q.setText("Loading...");
    setQuill(q);
  }, []);

  return <div className="container" ref={wrapperRef} />;
}
