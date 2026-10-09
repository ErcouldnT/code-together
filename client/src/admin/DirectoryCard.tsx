import { useEffect, useRef, useState } from "react";
import {
  DIRECTORY_PAGE,
  DIRECTORY_PROTECTIONS,
  DIRECTORY_SORTS,
  type DirectoryEntry,
  type DirectoryPage,
  type DirectoryProtection,
  type DirectorySort,
  type DocumentDetail,
} from "@shared/admin";
import { language, t } from "../i18n";
import { formatBytes } from "./AdminPage";
import { ago, countryName, flag, stamp } from "./format";
import Origin, { Address, Country, type OriginFilter } from "./Origin";

/**
 * Every document on the server, each a link that opens it in a new tab —
 * password or not, because the admin's cookie opens everything.
 *
 * Searched as you type, a moment after you stop, so a fast typist does not
 * send a request per letter. A country or an address anywhere on the card
 * is a button that narrows the list to it.
 */

const count = new Intl.NumberFormat(language);

const SORT_LABEL: Record<DirectorySort, Parameters<typeof t>[0]> = {
  updated: "admin.sortUpdated",
  created: "admin.sortCreated",
  size: "admin.sortSize",
};

const PROTECTION_LABEL: Record<DirectoryProtection, Parameters<typeof t>[0]> = {
  all: "admin.protection.all",
  none: "admin.protection.none",
  locked: "admin.protection.locked",
  view: "admin.protection.view",
  edit: "admin.protection.edit",
};

/** A filter set from outside — a country or address clicked in the statistics. */
export interface Preset extends OriginFilter {
  nonce: number;
}

export default function DirectoryCard({ preset }: { preset: Preset | null }) {
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<DirectorySort>("updated");
  const [openOnly, setOpenOnly] = useState(false);
  const [protection, setProtection] = useState<DirectoryProtection>("all");
  const [country, setCountry] = useState("");
  const [typedIp, setTypedIp] = useState("");
  const [ip, setIp] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<DirectoryPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const card = useRef<HTMLElement>(null);

  // the two text boxes wait for a pause in typing
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(typed.trim());
      setIp(typedIp.trim());
      setOffset(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [typed, typedIp]);

  const filter = (next: OriginFilter) => {
    if (next.country !== undefined) setCountry(next.country);
    if (next.ip !== undefined) {
      setTypedIp(next.ip);
      setIp(next.ip);
    }
    setOffset(0);
  };

  useEffect(() => {
    if (!preset) return;
    filter(preset);
    card.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [preset]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ sort, offset: String(offset) });
    if (query) params.set("q", query);
    if (openOnly) params.set("open", "1");
    if (protection !== "all") params.set("protection", protection);
    if (country) params.set("country", country);
    if (ip) params.set("ip", ip);
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
  }, [query, sort, openOnly, protection, country, ip, offset, reload]);

  const shown = page?.documents.length ?? 0;
  const filtered = protection !== "all" || country !== "" || typedIp !== "" || openOnly || typed !== "";
  const countries = page?.countries ?? [];

  function clear() {
    setTyped("");
    setTypedIp("");
    setQuery("");
    setIp("");
    setCountry("");
    setProtection("all");
    setOpenOnly(false);
    setOffset(0);
  }

  return (
    <section className="admin-card" ref={card}>
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

      <div className="admin-directory-controls admin-filters">
        <select
          className="dialog-input"
          aria-label={t("admin.filterProtection")}
          value={protection}
          onChange={(event) => {
            setProtection(event.target.value as DirectoryProtection);
            setOffset(0);
          }}
        >
          {DIRECTORY_PROTECTIONS.map((choice) => <option key={choice} value={choice}>{t(PROTECTION_LABEL[choice])}</option>)}
        </select>
        <select
          className="dialog-input"
          aria-label={t("admin.colCountry")}
          value={country}
          onChange={(event) => filter({ country: event.target.value })}
        >
          <option value="">{t("admin.allCountries")}</option>
          {/* a country set from outside stays choosable even before the list knows it */}
          {[...new Set([...countries, ...(country ? [country] : [])])].map((code) => (
            <option key={code} value={code}>{`${flag(code)} ${countryName(code)}`}</option>
          ))}
        </select>
        <input
          className="dialog-input admin-ip-filter"
          type="search"
          inputMode="decimal"
          placeholder={t("admin.ipFilter")}
          aria-label={t("admin.ipFilter")}
          value={typedIp}
          onChange={(event) => setTypedIp(event.target.value)}
        />
        {filtered && <button type="button" className="admin-link" onClick={clear}>{t("admin.clearFilters")}</button>}
      </div>

      {failed && <p className="dialog-error" role="alert">{t("common.noServer")}</p>}
      {!page && !failed && <p className="admin-muted">{t("common.loading")}</p>}
      {page && shown === 0 && <p className="admin-found">{t("admin.noDocuments")}</p>}

      {page && shown > 0 && (
        <ul className="admin-directory">
          {page.documents.map((entry) => <Row key={entry.id} entry={entry} onFilter={filter} />)}
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

function Row({ entry, onFilter }: { entry: DirectoryEntry; onFilter: (filter: OriginFilter) => void }) {
  const [open, setOpen] = useState(false);
  const edited = entry.editedAt ?? entry.updatedAt;
  return (
    <li className="admin-doc">
      <div className="admin-doc-head">
        <a className="admin-doc-link" href={`/${entry.id}`} target="_blank" rel="noreferrer">
          <span className={entry.title ? "admin-doc-title" : "admin-doc-title admin-muted-inline"}>
            {entry.title || t("admin.untitled")}
          </span>
          <span className="admin-doc-id">/{entry.id}</span>
        </a>
        <div className="admin-doc-badges">
          {entry.editors > 0 && (
            <span className="admin-badge admin-badge-live">{t("admin.hereNow", { count: count.format(entry.editors) })}</span>
          )}
          {entry.protect && (
            <span className="admin-badge">{t(entry.protect === "view" ? "admin.lockedView" : "admin.lockedEdit")}</span>
          )}
          {entry.expiresAt !== null && (
            <span className="admin-badge" title={stamp(entry.expiresAt)}>{t("admin.expiresAt", { when: ago(entry.expiresAt) })}</span>
          )}
        </div>
      </div>

      <div className="admin-doc-meta">
        <span title={stamp(entry.createdAt)}>{t("admin.createdAgo", { ago: ago(entry.createdAt) })}</span>
        <span>{t("admin.editedAgo", { ago: ago(edited), when: stamp(edited) })}</span>
        <span>{formatBytes(entry.bytes)}</span>
      </div>

      <dl className="admin-doc-origins">
        <div>
          <dt>{t("admin.createdFrom")}</dt>
          <dd><Origin ip={entry.createdIp} country={entry.createdCountry} onFilter={onFilter} /></dd>
        </div>
        <div>
          <dt>{t("admin.editedFrom")}</dt>
          <dd><Origin ip={entry.editedIp} country={entry.editedCountry} onFilter={onFilter} /></dd>
        </div>
        <button type="button" className="admin-link admin-doc-more" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? t("admin.hideDetails") : t("admin.details")}
        </button>
      </dl>

      {open && <Detail id={entry.id} onFilter={onFilter} />}
    </li>
  );
}

function Detail({ id, onFilter }: { id: string; onFilter: (filter: OriginFilter) => void }) {
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/admin/documents/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        setDetail((await response.json()) as DocumentDetail);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [id]);

  if (failed) return <p className="dialog-error">{t("common.noServer")}</p>;
  if (!detail) return <p className="admin-muted">{t("common.loading")}</p>;

  return (
    <div className="admin-detail">
      <p className="admin-detail-facts">
        <span>{t("admin.detailWords", { words: count.format(detail.words), characters: count.format(detail.characters) })}</span>
        <span>{t("admin.detailSnapshots", { count: count.format(detail.snapshots) })}</span>
        <span>
          {t("admin.detailAttachments", { files: count.format(detail.attachments.files), size: formatBytes(detail.attachments.bytes) })}
        </span>
      </p>
      <h3 className="admin-subheading">{t("admin.editorsHeading")}</h3>
      {detail.editors.length === 0
        ? <p className="admin-muted">{t("admin.noEditors")}</p>
        : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>{t("admin.colIp")}</th>
                    <th>{t("admin.colCountry")}</th>
                    <th className="admin-num">{t("admin.colEdits")}</th>
                    <th>{t("admin.colFirst")}</th>
                    <th>{t("admin.colLast")}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.editors.map((editor) => (
                    <tr key={editor.ip}>
                      <td><Address ip={editor.ip} onFilter={onFilter} /></td>
                      <td><Country code={editor.country} onFilter={onFilter} /></td>
                      <td className="admin-num">{count.format(editor.edits)}</td>
                      <td title={stamp(editor.firstAt)}>{ago(editor.firstAt)}</td>
                      <td title={stamp(editor.lastAt)}>{ago(editor.lastAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
    </div>
  );
}
