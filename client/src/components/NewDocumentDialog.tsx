import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { MIN_PASSWORD_LENGTH, type Protection } from "@shared/access";
import { addressFor, createDocument } from "../access";

/**
 * Making a document with a name of its own instead of a random address.
 *
 * The name becomes both the address — slugified, shown underneath as it is
 * typed so nobody is surprised by what they share — and the title. A password
 * is optional, and what it guards is the creator's choice: the whole document,
 * or only the right to change it.
 *
 * A native <dialog> opened with `showModal`, which brings focus trapping,
 * Escape and the backdrop with it rather than reimplementing them.
 */

interface Props {
  onClose: () => void;
}

const ERRORS = {
  "bad-name": "Use at least one letter or digit.",
  "taken": "A document already has that address. Pick another name.",
  "bad-password": `The password needs at least ${MIN_PASSWORD_LENGTH} characters.`,
  "too-many": "Too many documents made just now. Wait a minute and try again.",
} as const;

export default function NewDocumentDialog({ onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [protect, setProtect] = useState<Protection>("view");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  const address = addressFor(name);
  const hasPassword = password.length > 0;
  const mismatch = hasPassword && confirm.length > 0 && confirm !== password;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!address) return setError(ERRORS["bad-name"]);
    if (hasPassword && password.length < MIN_PASSWORD_LENGTH) return setError(ERRORS["bad-password"]);
    if (hasPassword && confirm !== password) return setError("The two passwords are not the same.");

    setBusy(true);
    setError(null);
    try {
      const created = await createDocument({
        name,
        ...(hasPassword ? { password, protect } : {}),
      });
      if ("error" in created) {
        setError(ERRORS[created.error]);
        return;
      }
      onClose();
      navigate(`/${created.id}`);
    }
    catch {
      setError("Could not reach the server.");
    }
    finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby="new-document-title"
      // Escape closes a modal dialog by itself; this keeps React in step.
      onClose={onClose}
      onCancel={onClose}
    >
      <form className="dialog-form" onSubmit={(event) => void submit(event)}>
        <h2 id="new-document-title" className="dialog-title">New document</h2>

        <label className="dialog-field">
          <span className="dialog-label">Name</span>
          <input
            className="dialog-input"
            value={name}
            maxLength={120}
            required
            autoFocus
            placeholder="Meeting notes"
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
          />
          <span className="dialog-hint">
            {address ? `${window.location.host}/${address}` : "The address is made from the name."}
          </span>
        </label>

        <label className="dialog-field">
          <span className="dialog-label">Password</span>
          <input
            className="dialog-input"
            type="password"
            value={password}
            autoComplete="new-password"
            placeholder="Optional"
            onChange={(event) => {
              setPassword(event.target.value);
              setError(null);
            }}
          />
        </label>

        <label className="dialog-field">
          <span className="dialog-label">Password again</span>
          <input
            className="dialog-input"
            type="password"
            value={confirm}
            autoComplete="new-password"
            disabled={!hasPassword}
            aria-invalid={mismatch}
            onChange={(event) => {
              setConfirm(event.target.value);
              setError(null);
            }}
          />
          {mismatch && <span className="dialog-hint dialog-hint-error">The two passwords are not the same.</span>}
        </label>

        <fieldset className="dialog-field dialog-choice" disabled={!hasPassword}>
          <legend className="dialog-label">The password protects</legend>
          <label>
            <input
              type="radio"
              name="protect"
              checked={protect === "view"}
              onChange={() => setProtect("view")}
            />
            {" "}Viewing — nobody without it can open the document
          </label>
          <label>
            <input
              type="radio"
              name="protect"
              checked={protect === "edit"}
              onChange={() => setProtect("edit")}
            />
            {" "}Editing — everyone can read, only someone with the password can write
          </label>
        </fieldset>

        <p className="dialog-note">
          {hasPassword
            ? "Keep the password somewhere safe: it cannot be recovered or changed."
            : "Without a password the document is public: anyone with the address can read and edit it."}
        </p>

        {error && <p className="dialog-error" role="alert">{error}</p>}

        <div className="dialog-actions">
          <button type="button" className="menu-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="menu-button dialog-primary" disabled={busy || !address || mismatch}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
