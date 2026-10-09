import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { MIN_PASSWORD_LENGTH, type Protection } from "@shared/access";
import { addressFor, createDocument } from "../access";
import { t } from "../i18n";

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
  "bad-name": t("new.badName"),
  "taken": t("new.taken"),
  "bad-password": t("new.badPassword", { min: MIN_PASSWORD_LENGTH }),
  "too-many": t("new.tooMany"),
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
    if (hasPassword && confirm !== password) return setError(t("new.mismatch"));

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
      setError(t("common.noServer"));
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
        <h2 id="new-document-title" className="dialog-title">{t("new.title")}</h2>

        <label className="dialog-field">
          <span className="dialog-label">{t("new.name")}</span>
          <input
            className="dialog-input"
            value={name}
            maxLength={120}
            required
            autoFocus
            placeholder={t("new.namePlaceholder")}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
          />
          <span className="dialog-hint">
            {address ? `${window.location.host}/${address}` : t("new.addressHint")}
          </span>
        </label>

        <label className="dialog-field">
          <span className="dialog-label">{t("new.password")}</span>
          <input
            className="dialog-input"
            type="password"
            value={password}
            autoComplete="new-password"
            placeholder={t("new.optional")}
            onChange={(event) => {
              setPassword(event.target.value);
              setError(null);
            }}
          />
        </label>

        <label className="dialog-field">
          <span className="dialog-label">{t("new.passwordAgain")}</span>
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
          {mismatch && <span className="dialog-hint dialog-hint-error">{t("new.mismatch")}</span>}
        </label>

        <fieldset className="dialog-field dialog-choice" disabled={!hasPassword}>
          <legend className="dialog-label">{t("new.protects")}</legend>
          <label>
            <input
              type="radio"
              name="protect"
              checked={protect === "view"}
              onChange={() => setProtect("view")}
            />
            {" "}{t("new.protectView")}
          </label>
          <label>
            <input
              type="radio"
              name="protect"
              checked={protect === "edit"}
              onChange={() => setProtect("edit")}
            />
            {" "}{t("new.protectEdit")}
          </label>
        </fieldset>

        <p className="dialog-note">
          {hasPassword
            ? t("new.keepSafe")
            : t("new.public")}
        </p>

        {error && <p className="dialog-error" role="alert">{error}</p>}

        <div className="dialog-actions">
          <button type="button" className="menu-button" onClick={onClose}>{t("common.cancel")}</button>
          <button type="submit" className="menu-button dialog-primary" disabled={busy || !address || mismatch}>
            {busy ? t("new.creating") : t("new.create")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
