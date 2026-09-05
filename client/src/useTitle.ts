import { useCallback, useEffect, useRef, useState } from "react";
import { META_KEY } from "@shared/ydoc";
import { rememberDocument } from "./recent";
import type { SocketProvider } from "./yjs/socketProvider";

/**
 * The document's title, which is part of the document.
 *
 * It lives in the Yjs document as `meta.title` rather than being a field of
 * its own, so it syncs, merges and persists by exactly the same machinery as
 * the text — no second event, no second save path, no chance of the two
 * disagreeing about which is newer. The server mirrors it into a column on
 * save, but only so a room can be listed without decoding its CRDT.
 */
export function useTitle(
  provider: SocketProvider | null,
  documentId: string | undefined,
): { title: string; setTitle: (value: string) => void; onFocus: () => void; onBlur: () => void } {
  const [title, setLocalTitle] = useState("");
  /**
   * Remote changes are ignored while the box has focus. Writing somebody
   * else's keystroke into an input you are typing in moves your caret to the
   * end of it, which is worse than being a second behind.
   */
  const typing = useRef(false);

  useEffect(() => {
    if (!provider || !documentId) return;
    const meta = provider.doc.getMap(META_KEY);

    const read = () => {
      const value = meta.get("title");
      const text = typeof value === "string" ? value : "";
      setLocalTitle(text);
      document.title = text ? `${text} — Code together!` : "Code together!";
      rememberDocument(documentId, text);
    };

    read();
    const observer = () => {
      if (!typing.current) read();
    };
    meta.observe(observer);
    return () => {
      meta.unobserve(observer);
      document.title = "Code together!";
    };
  }, [provider, documentId]);

  const setTitle = useCallback(
    (value: string) => {
      const trimmed = value.slice(0, 120);
      setLocalTitle(trimmed);
      if (!provider) return;
      provider.doc.getMap(META_KEY).set("title", trimmed);
      document.title = trimmed ? `${trimmed} — Code together!` : "Code together!";
      if (documentId) rememberDocument(documentId, trimmed);
    },
    [provider, documentId],
  );

  const onFocus = useCallback(() => {
    typing.current = true;
  }, []);

  const onBlur = useCallback(() => {
    typing.current = false;
    // Catch up on anything that arrived while the box had focus.
    const value = provider?.doc.getMap(META_KEY).get("title");
    if (typeof value === "string") setLocalTitle(value);
  }, [provider]);

  return { title, setTitle, onFocus, onBlur };
}
