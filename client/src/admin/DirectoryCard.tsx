import { useEffect, useState } from "react";
import { DIRECTORY_PAGE, DIRECTORY_SORTS, type DirectoryPage, type DirectorySort } from "@shared/admin";
import { dateTimeFormat, language, t } from "../i18n";
import { formatBytes } from "./AdminPage";

/**
 * Every document on the server, each a link that opens it in a new tab.
 *
 * Searched as you type, a moment after you stop, so a fast typist does not
 * send a request per letter. A document with a password opens without it:
 * the admin's cookie is a key to every document.
 */

const when = dateTimeFormat({ dateStyle: "medium", timeStyle: "short" });
const count = new Intl.NumberFormat(language);

const SORT_LABEL: Record<DirectorySort, Parameters<typeof t>[0]> = {
  updated: "admin.sortUpdated",
  created: "admin.sortCreated",
  size: "admin.sortSize",
};

export default function DirectoryCard() {
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<DirectorySort>("updated");
  const [openOnly, setOpenOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<DirectoryPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(typed.trim());
      setOffset(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [typed]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ sort, offset: String(offset) });
    if (query) params.set("q", query);
    if (openOnly) params.set("open", "1");
    fetch(`/api/admin/documents?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        setPage((await response.json()) as DirectoryPage);
        setFailed(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [query, sort, openOnly, offset, reload]);

  const shown = page?.documents.length ?? 0;

  return (
    <section className="admin-card">
      <div className="admin-card-head">
        <h2 className="admin-heading">{t("admin.directory")}</h2>
        <button type="button" className="menu-button" onClick={() => setReload((n) => n + 1)}>{t("admin.refresh")}</button>
      </div>
      <p className="admin-muted">{t("admin.directoryNote")}</p>

      <div className="admin-directory-controls">
        <input
          className="dialog-input admin-directory-search"
          type="search"
          placeholder={t("admin.search")}
          aria-label={t("admin.search")}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
        <select
          className="dialog-input"
          aria-label={t("admin.sortBy")}
          value={sort}
          onChange={(event) => {
            setSort(event.target.value as DirectorySort);
            setOffset(0);
          }}
        >
          {DIRECTORY_SORTS.map((choice) => <option key={choice} value={choice}>{t(SORT_LABEL[choice])}</option>)}
        </select>
        <label className="admin-check">
          <input
            type="checkbox"
            checked={openOnly}
            onChange={(event) => {
              setOpenOnly(event.target.checked);
              setOffset(0);
            }}
          />
          {t("admin.openOnly")}
        </label>
      </div>

      {failed && <p className="dialog-error" role="alert">{t("common.noServer")}</p>}
      {!page && !failed && <p className="admin-muted">{t("common.loading")}</p>}
      {page && shown === 0 && <p className="admin-found">{t("admin.noDocuments")}</p>}

      {page && shown > 0 && (
        <ul className="admin-directory">
          {page.documents.map((entry) => (
            <li key={entry.id} className="admin-doc">
              <a className="admin-doc-link" href={`/${entry.id}`} target="_blank" rel="noreferrer">
                <span className={entry.title ? "admin-doc-title" : "admin-doc-title admin-muted-inline"}>
                  {entry.title || t("admin.untitled")}
                </span>
                <span className="admin-doc-id">/{entry.id}</span>
              </a>
              <div className="admin-doc-meta">
                {entry.editors > 0 && (
                  <span className="admin-badge admin-badge-live">{t("admin.hereNow", { count: count.format(entry.editors) })}</span>
                )}
                {entry.protect && (
                  <span className="admin-badge">{t(entry.protect === "view" ? "admin.lockedView" : "admin.lockedEdit")}</span>
                )}
                {entry.expiresAt !== null && (
                  <span className="admin-badge">{t("admin.expiresAt", { when: when.format(entry.expiresAt) })}</span>
                )}
                <span>{t("admin.lastChanged", { when: when.format(entry.updatedAt) })}</span>
                <span>{formatBytes(entry.bytes)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {page && page.total > DIRECTORY_PAGE && (
        <div className="admin-actions admin-pager">
          <span className="admin-muted-inline">
            {t("admin.range", {
              from: count.format(page.offset + 1),
              to: count.format(page.offset + shown),
              total: count.format(page.total),
            })}
          </span>
          <button
            type="button"
            className="menu-button"
            disabled={page.offset === 0}
            onClick={() => setOffset(Math.max(0, page.offset - DIRECTORY_PAGE))}
          >
            {t("admin.previous")}
          </button>
          <button
            type="button"
            className="menu-button"
            disabled={page.offset + shown >= page.total}
            onClick={() => setOffset(page.offset + DIRECTORY_PAGE)}
          >
            {t("admin.next")}
          </button>
        </div>
      )}
    </section>
  );
}
