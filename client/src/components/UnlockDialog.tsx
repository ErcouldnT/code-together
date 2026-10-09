import { useEffect, useRef, useState, type FormEvent } from "react";
import { unlock } from "../access";

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
      setError("That is not the password.");
      setPassword("");
    }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reach the server.");
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
          {reason === "view" ? "This document is password protected" : "Unlock editing"}
        </h2>
        <p className="dialog-note">
          {reason === "view"
            ? "Enter the password to open it."
            : "Anyone can read this document. Enter its password to edit it."}
        </p>

        <label className="dialog-field">
          <span className="dialog-label">Password</span>
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
            ? <a className="menu-button" href="/">New document</a>
            : <button type="button" className="menu-button" onClick={onClose}>Cancel</button>}
          <button type="submit" className="menu-button dialog-primary" disabled={busy || !password}>
            {busy ? "Checking…" : "Unlock"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
