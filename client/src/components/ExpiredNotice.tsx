import { useEffect } from "react";
import { forgetExpired } from "../expiry";
import { t } from "../i18n";

/**
 * In place of a document that deleted itself — whether it went while this tab
 * had it open or long before the address was visited. Clearing the local copy
 * happens here, once the editor that was using it has been taken down.
 */
export default function ExpiredNotice({ documentId }: { documentId: string }) {
  useEffect(() => {
    forgetExpired(documentId);
  }, [documentId]);

  return (
    <main className="gone">
      <div className="gone-card">
        <svg className="gone-icon" viewBox="0 0 24 24" width="40" height="40" aria-hidden="true">
          <path
            d="M6 3h12M6 21h12M7.5 3c0 5 9 5 9 9s-9 4-9 9M16.5 3c0 5-9 5-9 9s9 4 9 9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <h1 className="gone-title">{t("expiry.gone")}</h1>
        <p className="gone-note">{t("expiry.goneNote")}</p>
        <a className="menu-button dialog-primary" href="/">{t("expiry.newDocument")}</a>
      </div>
    </main>
  );
}
