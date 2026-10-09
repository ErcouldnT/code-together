import { useCallback, useEffect, useState } from "react";
import type { AdminStats } from "@shared/admin";
import { language, t } from "../i18n";
import { ago, shortDay, stamp } from "./format";
import { Address, Country, type OriginFilter } from "./Origin";

/**
 * Everything the server can say about its documents taken together: how
 * they are protected, how many are made a day, and where they are made and
 * changed from. A country or address is a button that shows its documents
 * in the list below.
 */

const count = new Intl.NumberFormat(language);
const days = new Intl.NumberFormat(language, { style: "unit", unit: "day", unitDisplay: "long" });

function Total({ name, value, title }: { name: string; value: string; title?: string }) {
  return (
    <div className="admin-stat" title={title}>
      <dt className="admin-stat-name">{name}</dt>
      <dd className="admin-stat-value">{value}</dd>
    </div>
  );
}

/** One bar per day, tallest is full height; the count is in each bar's label. */
function PerDay({ data }: { data: AdminStats["createdPerDay"] }) {
  const top = Math.max(1, ...data.map((d) => d.count));
  const first = data[0];
  const last = data.at(-1);
  return (
    <figure className="admin-chart">
      <div className="admin-chart-bars" role="img" aria-label={t("admin.createdPerDay")}>
        {data.map((d) => (
          <div key={d.day} className="admin-chart-bar" title={`${shortDay(d.day)}: ${count.format(d.count)}`}>
            <div className="admin-chart-fill" style={{ height: `${(d.count / top) * 100}%` }} />
          </div>
        ))}
      </div>
      <figcaption className="admin-chart-axis">
        <span>{first && shortDay(first.day)}</span>
        <span>{t("admin.chartPeak", { count: count.format(top) })}</span>
        <span>{last && shortDay(last.day)}</span>
      </figcaption>
    </figure>
  );
}

/** A share of the whole as a bar, for the password breakdown. */
function Share({ label, value, total }: { label: string; value: number; total: number }) {
  const percent = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="admin-share">
      <div className="admin-share-label">
        <span>{label}</span>
        <span className="admin-num">{count.format(value)} · %{percent}</span>
      </div>
      <div className="admin-share-track"><div className="admin-share-fill" style={{ width: `${percent}%` }} /></div>
    </div>
  );
}

export default function StatsCard({ onFilter }: { onFilter: (filter: OriginFilter) => void }) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/stats");
      if (!response.ok) throw new Error(String(response.status));
      setStats((await response.json()) as AdminStats);
      setFailed(false);
    }
    catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const total = stats ? stats.protection.open + stats.protection.view + stats.protection.edit : 0;

  return (
    <section className="admin-card">
      <div className="admin-card-head">
        <h2 className="admin-heading">{t("admin.stats")}</h2>
        <button type="button" className="menu-button" onClick={() => void load()}>{t("admin.refresh")}</button>
      </div>
      <p className="admin-muted">{t("admin.statsNote")}</p>
      {failed && <p className="dialog-error" role="alert">{t("common.noServer")}</p>}
      {!stats && !failed && <p className="admin-muted">{t("common.loading")}</p>}

      {stats && (
        <>
          <dl className="admin-stats">
            <Total name={t("admin.totalCountries")} value={count.format(stats.totals.countries)} />
            <Total name={t("admin.totalIps")} value={count.format(stats.totals.ips)} />
            <Total name={t("admin.totalEdits")} value={count.format(stats.totals.edits)} />
            <Total name={t("admin.totalUnknown")} value={count.format(stats.totals.unknownOrigin)} />
            {stats.ages.oldest !== null && (
              <Total name={t("admin.oldest")} value={ago(stats.ages.oldest)} title={stamp(stats.ages.oldest)} />
            )}
            {stats.ages.newest !== null && (
              <Total name={t("admin.newest")} value={ago(stats.ages.newest)} title={stamp(stats.ages.newest)} />
            )}
            {stats.ages.medianDays !== null && <Total name={t("admin.median")} value={days.format(stats.ages.medianDays)} />}
            {stats.ages.lastEdit !== null && (
              <Total name={t("admin.lastActivity")} value={ago(stats.ages.lastEdit)} title={stamp(stats.ages.lastEdit)} />
            )}
          </dl>

          <div className="admin-stats-grid">
            <div>
              <h3 className="admin-subheading">{t("admin.createdPerDay")}</h3>
              <PerDay data={stats.createdPerDay} />
            </div>
            <div>
              <h3 className="admin-subheading">{t("admin.byProtection")}</h3>
              <Share label={t("admin.protection.none")} value={stats.protection.open} total={total} />
              <Share label={t("admin.protection.view")} value={stats.protection.view} total={total} />
              <Share label={t("admin.protection.edit")} value={stats.protection.edit} total={total} />
            </div>
          </div>

          <h3 className="admin-subheading admin-gap">{t("admin.byCountry")}</h3>
          {stats.countries.length === 0
            ? <p className="admin-muted">{t("admin.noActivity")}</p>
            : (
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>{t("admin.colCountry")}</th>
                        <th className="admin-num">{t("admin.colCreated")}</th>
                        <th className="admin-num">{t("admin.colDocuments")}</th>
                        <th className="admin-num">{t("admin.colEdits")}</th>
                        <th className="admin-num">{t("admin.colAddresses")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.countries.map((row) => (
                        <tr key={row.country ?? "-"}>
                          <td><Country code={row.country} onFilter={row.country ? onFilter : undefined} /></td>
                          <td className="admin-num">{count.format(row.created)}</td>
                          <td className="admin-num">{count.format(row.documents)}</td>
                          <td className="admin-num">{count.format(row.edits)}</td>
                          <td className="admin-num">{count.format(row.ips)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

          <h3 className="admin-subheading admin-gap">{t("admin.byIp")}</h3>
          {stats.ips.length === 0
            ? <p className="admin-muted">{t("admin.noActivity")}</p>
            : (
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>{t("admin.colIp")}</th>
                        <th>{t("admin.colCountry")}</th>
                        <th className="admin-num">{t("admin.colCreated")}</th>
                        <th className="admin-num">{t("admin.colDocuments")}</th>
                        <th className="admin-num">{t("admin.colEdits")}</th>
                        <th>{t("admin.colLast")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.ips.map((row) => (
                        <tr key={row.ip}>
                          <td><Address ip={row.ip} onFilter={onFilter} /></td>
                          <td><Country code={row.country} /></td>
                          <td className="admin-num">{count.format(row.created)}</td>
                          <td className="admin-num">{count.format(row.documents)}</td>
                          <td className="admin-num">{count.format(row.edits)}</td>
                          <td title={row.lastAt ? stamp(row.lastAt) : undefined}>{row.lastAt ? ago(row.lastAt) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
        </>
      )}
    </section>
  );
}
