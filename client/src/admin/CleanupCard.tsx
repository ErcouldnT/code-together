import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ABANDONED_CHOICES, type CleanupEntry, type CleanupPreview, type CleanupRequest } from "@shared/admin";
import { dateTimeFormat, language, t } from "../i18n";

/**
 * Finding documents to clear out, and clearing them — always in two steps:
 * see how many and which, then confirm. The server finds them again when
 * asked to delete rather than taking a list from here, so the confirmation
 * is about a kind of document, and nothing else can be slipped in.
 */

const when = dateTimeFormat({ dateStyle: "medium" });
const count = new Intl.NumberFormat(language);

function duration(value: number, unit: "hour" | "day"): string {
  return new Intl.NumberFormat(language, { style: "unit", unit, unitDisplay: "long" }).format(value);
}

function List({ entries, total }: { entries: CleanupEntry[]; total: number }) {
  return (
    <details className="admin-list">
      <summary>{t("admin.showList")}</summary>
      <ul>
        {entries.map((entry) => (
          <li key={entry.id}>
            <a href={`/${entry.id}`} target="_blank" rel="noreferrer">{entry.title || entry.id}</a>
            {!entry.title && <span className="admin-muted-inline"> · {t("admin.untitled")}</span>}
            <span className="admin-muted-inline"> · {t("admin.lastChanged", { when: when.format(entry.updatedAt) })}</span>
          </li>
        ))}
      </ul>
      {total > entries.length && <p className="admin-muted">{t("admin.andMore", { count: count.format(total - entries.length) })}</p>}
    </details>
  );
}

interface GroupProps {
  title: string;
  note: ReactNode;
  found: { count: number; sample: CleanupEntry[] } | null;
  request: CleanupRequest;
  onDeleted: () => void;
}

function Group({ title, note, found, request, onDeleted }: GroupProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  // A new count is a new question.
  useEffect(() => {
    setConfirming(false);
  }, [found]);

  async function remove() {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/cleanup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      if (!response.ok) throw new Error(String(response.status));
      const { deleted } = (await response.json()) as { deleted: number };
      setResult(t("admin.deleted", { count: count.format(deleted) }));
      onDeleted();
    }
    catch {
      setResult(t("common.noServer"));
    }
    finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="admin-group">
      <h3 className="admin-subheading">{title}</h3>
      <div className="admin-muted">{note}</div>
      {found === null
        ? <p className="admin-muted">{t("common.loading")}</p>
        : found.count === 0
          ? <p className="admin-found">{t("admin.noneFound")}</p>
          : (
              <>
                <p className="admin-found"><strong>{t("admin.found", { count: count.format(found.count) })}</strong></p>
                <List entries={found.sample} total={found.count} />
              </>
            )}
      <div className="admin-actions">
        {result && <span className="admin-ok" role="status">{result}</span>}
        {confirming
          ? (
              <>
                <span className="admin-confirm">{t("admin.confirmDelete", { count: count.format(found?.count ?? 0) })}</span>
                <button type="button" className="menu-button" onClick={() => setConfirming(false)}>{t("common.cancel")}</button>
                <button type="button" className="menu-button admin-danger" disabled={busy} onClick={() => void remove()}>
                  {t("admin.yesDelete")}
                </button>
              </>
            )
          : (
              <button
                type="button"
                className="menu-button admin-danger-outline"
                disabled={!found || found.count === 0}
                onClick={() => {
                  setResult(null);
                  setConfirming(true);
                }}
              >
                {t("admin.delete")}
              </button>
            )}
      </div>
    </div>
  );
}

export default function CleanupCard({ onChanged }: { onChanged: () => void }) {
  const [days, setDays] = useState<number>(ABANDONED_CHOICES[1]);
  const [preview, setPreview] = useState<CleanupPreview | null>(null);

  const load = useCallback(async () => {
    setPreview(null);
    try {
      const response = await fetch(`/api/admin/cleanup?days=${days}`);
      if (response.ok) setPreview((await response.json()) as CleanupPreview);
    }
    catch {
      // the groups stay on "loading"; the status card above says if the server is gone
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  const deleted = () => {
    void load();
    onChanged();
  };

  return (
    <section className="admin-card">
      <h2 className="admin-heading">{t("admin.cleanup")}</h2>
      <p className="admin-muted">{t("admin.cleanupNote")}</p>

      <div className="admin-groups">
        <Group
          title={t("admin.empty")}
          note={t("admin.emptyNote", { age: duration(preview?.empty.olderThanHours ?? 1, "hour") })}
          found={preview?.empty ?? null}
          request={{ kind: "empty" }}
          onDeleted={deleted}
        />
        <Group
          title={t("admin.abandoned")}
          note={(
            <label className="admin-inline-field">
              {t("admin.abandonedNote")}
              <select className="dialog-input" value={days} onChange={(event) => setDays(Number(event.target.value))}>
                {ABANDONED_CHOICES.map((choice) => <option key={choice} value={choice}>{duration(choice, "day")}</option>)}
              </select>
            </label>
          )}
          found={preview?.abandoned ?? null}
          request={{ kind: "abandoned", days }}
          onDeleted={deleted}
        />
      </div>
    </section>
  );
}
