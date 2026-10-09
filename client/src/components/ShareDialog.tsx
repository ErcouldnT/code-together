import { useEffect, useMemo, useRef, useState } from "react";
import type { Protection } from "@shared/access";
import { t } from "../i18n";

/**
 * Handing the document to someone: the address as a QR code for a phone in
 * the same room, as text to copy, and — where the browser has one — the
 * system share sheet.
 *
 * The code is drawn as an SVG from the module matrix rather than as an image,
 * so it is sharp at any size and on any screen density, and always black on
 * white whatever the theme: a camera reads dark-on-light, and a "dark mode"
 * QR code is one many phones will not scan.
 */

interface Props {
  url: string;
  protect: Protection | null;
  onClose: () => void;
}

/** The QR matrix as one SVG path, a unit square per dark module. */
function qrPath(text: string): Promise<{ size: number; path: string }> {
  // Loaded when the dialog opens, not with the editor: most visits never
  // share anything.
  return import("qrcode-generator").then(({ default: qrcode }) => {
    // Medium error correction: survives a smudge or a glare without making
    // the code so dense a phone across a table cannot resolve it.
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const size = qr.getModuleCount();
    let path = "";
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        if (qr.isDark(row, col)) path += `M${col} ${row}h1v1h-1z`;
      }
    }
    return { size, path };
  });
}

export default function ShareDialog({ url, protect, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [code, setCode] = useState<{ size: number; path: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const canShare = useMemo(() => typeof navigator.share === "function", []);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  useEffect(() => {
    let live = true;
    void qrPath(url).then((next) => {
      if (live) setCode(next);
    });
    return () => {
      live = false;
    };
  }, [url]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    }
    catch {
      // No clipboard permission (or an insecure origin): select the text so
      // a long-press or Ctrl+C finishes the job.
      document.querySelector<HTMLInputElement>(".share-url")?.select();
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function share() {
    try {
      await navigator.share({ url, title: document.title });
    }
    catch {
      // dismissed, which is not an error worth showing
    }
  }

  // Four modules of white all round: the quiet zone scanners need to find it.
  const quiet = 4;

  return (
    <dialog ref={dialog} className="dialog share" aria-labelledby="share-title" onClose={onClose} onCancel={onClose}>
      <div className="dialog-form">
        <h2 id="share-title" className="dialog-title">{t("share.title")}</h2>

        <div className="share-code">
          {code
            ? (
                <svg
                  viewBox={`${-quiet} ${-quiet} ${code.size + quiet * 2} ${code.size + quiet * 2}`}
                  role="img"
                  aria-label={t("share.qrLabel")}
                  shapeRendering="crispEdges"
                >
                  <rect x={-quiet} y={-quiet} width={code.size + quiet * 2} height={code.size + quiet * 2} fill="#fff" />
                  <path d={code.path} fill="#000" />
                </svg>
              )
            : <div className="share-code-loading" aria-hidden="true" />}
        </div>
        <p className="dialog-note share-scan">{t("share.scan")}</p>
        {protect && <p className="dialog-note dialog-note-strong">{t("share.password")}</p>}

        <div className="share-row">
          <input
            className="dialog-input share-url"
            value={url}
            readOnly
            aria-label={t("share.address")}
            onFocus={(event) => event.target.select()}
          />
          <button type="button" className="menu-button dialog-primary" onClick={() => void copy()}>
            {copied ? t("share.copied") : t("share.copy")}
          </button>
        </div>

        <div className="dialog-actions">
          {canShare && (
            <button type="button" className="menu-button" onClick={() => void share()}>{t("share.native")}</button>
          )}
          <button type="button" className="menu-button" onClick={onClose}>{t("common.close")}</button>
        </div>
      </div>
    </dialog>
  );
}
