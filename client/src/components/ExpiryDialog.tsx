import { useEffect, useRef, useState, type FormEvent } from "react";
import { EXPIRY_CHOICES } from "@shared/access";
import { EXPIRY_LABELS, setExpiry } from "../expiry";
import { dateTimeFormat, t } from "../i18n";

/**
 * Choosing when the document deletes itself, or that it should not.
 *
 * The choice counts from now: "in 24 hours" set at noon means noon tomorrow,
 * whatever was set before. The current setting is said in words above the
 * choices rather than preselected among them, because a date three days off
 * is not any of "1 hour", "24 hours", "7 days".
 */

interface Props {
  documentId: string;
  expiresAt: number | null;
  onChange: (expiresAt: number | null) => void;
  onClose: () => void;
}

const when = dateTimeFormat({ dateStyle: "medium", timeStyle: "short" });

export default function ExpiryDialog({ documentId, expiresAt, onChange, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [choice, setChoice] = useState<number | null>(expiresAt === null ? null : EXPIRY_CHOICES[1]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      onChange(await setExpiry(documentId, choice));
      onClose();
    }
    catch {
      setError(t("expiry.failed"));
    }
    finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialog} className="dialog" aria-labelledby="expiry-title" onClose={onClose} onCancel={onClose}>
      <form className="dialog-form" onSubmit={(event) => void submit(event)}>
        <h2 id="expiry-title" className="dialog-title">{t("expiry.title")}</h2>
        <p className="dialog-note">{t("expiry.note")}</p>
        {expiresAt !== null && (
          <p className="dialog-note dialog-note-strong">{t("expiry.current", { when: when.format(expiresAt) })}</p>
        )}

        <fieldset className="dialog-field dialog-choice">
          <legend className="dialog-label">{t("new.expiry")}</legend>
          <label>
            <input type="radio" name="expiry" checked={choice === null} onChange={() => setChoice(null)} />
            {" "}{t("expiry.never")}
          </label>
          {EXPIRY_CHOICES.map((ms) => (
            <label key={ms}>
              <input type="radio" name="expiry" checked={choice === ms} onChange={() => setChoice(ms)} />
              {" "}{EXPIRY_LABELS[ms]}
            </label>
          ))}
        </fieldset>

        {error && <p className="dialog-error" role="alert">{error}</p>}

        <div className="dialog-actions">
          <button type="button" className="menu-button" onClick={onClose}>{t("common.cancel")}</button>
          <button type="submit" className="menu-button dialog-primary" disabled={busy}>
            {busy ? t("expiry.saving") : t("expiry.save")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
