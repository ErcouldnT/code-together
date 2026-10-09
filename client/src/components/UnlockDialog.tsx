import { useEffect, useRef, useState, type FormEvent } from "react";
import { unlock } from "../access";
import { t } from "../i18n";

/**
 * Asking for a document's password, in both of the places it is needed:
 * in front of a document that cannot be opened without it, and over one that
 * can be read but not changed.
 *
 * A right answer reloads the page rather than updating it in place. The
 * socket decides what this tab may do from the cookies it connected with, so
 * the new cookie means nothing to it until it reconnects — and a reload is the
 * one reconnect that also resets every piece of state that assumed otherwise.
 */

interface Props {
  documentId: string;
  /** "view": nothing is shown until it is unlocked, so it cannot be dismissed */
  reason: "view" | "edit";
  onClose?: () => void;
}

export default function UnlockDialog({ documentId, reason, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (await unlock(documentId, password)) {
        window.location.reload();
        return;
      }
      setError(t("unlock.wrong"));
      setPassword("");
    }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : t("common.noServer"));
    }
    finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby="unlock-title"
      onCancel={(event) => {
        if (reason === "view") event.preventDefault();
        else onClose?.();
      }}
    >
      <form className="dialog-form" onSubmit={(event) => void submit(event)}>
        <h2 id="unlock-title" className="dialog-title">
          {reason === "view" ? t("unlock.viewTitle") : t("unlock.editTitle")}
        </h2>
        <p className="dialog-note">
          {reason === "view"
            ? t("unlock.viewNote")
            : t("unlock.editNote")}
        </p>

        <label className="dialog-field">
          <span className="dialog-label">{t("new.password")}</span>
          <input
            className="dialog-input"
            type="password"
            value={password}
            autoComplete="current-password"
            autoFocus
            required
            onChange={(event) => {
              setPassword(event.target.value);
              setError(null);
            }}
          />
        </label>

        {error && <p className="dialog-error" role="alert">{error}</p>}

        <div className="dialog-actions">
          {reason === "view"
            ? <a className="menu-button" href="/">{t("new.title")}</a>
            : <button type="button" className="menu-button" onClick={onClose}>{t("common.cancel")}</button>}
          <button type="submit" className="menu-button dialog-primary" disabled={busy || !password}>
            {busy ? t("unlock.checking") : t("unlock.submit")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
