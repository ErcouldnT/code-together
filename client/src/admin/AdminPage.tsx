import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  LIMITS,
  RATE_LIMIT_KEYS,
  SIZE_LIMIT_KEYS,
  type AdminOverview,
  type LimitKey,
  type Limits,
  type LimitsUpdate,
  type LimitSpec,
} from "@shared/admin";
import { language, t } from "../i18n";

/**
 * /admin: how the server is doing, and the limits it enforces.
 *
 * Every limit is shown in the unit a person thinks in — megabytes, seconds,
 * per minute — and converted on the way in and out. The form holds strings,
 * not numbers, so a half-typed "1." is not snapped to "1" under the cursor.
 */

type Phase =
  | { kind: "loading" }
  | { kind: "off" }
  | { kind: "signed-out" }
  | { kind: "failed" }
  | { kind: "ready"; overview: AdminOverview };

const MB = 1024 * 1024;

/** "1.5 GB", "340 MB", "12 KB" — Intl names the unit in the page's language. */
export function formatBytes(bytes: number): string {
  const units = [
    ["terabyte", 1024 ** 4],
    ["gigabyte", 1024 ** 3],
    ["megabyte", 1024 ** 2],
    ["kilobyte", 1024],
  ] as const;
  for (const [unit, size] of units) {
    if (bytes >= size) {
      return new Intl.NumberFormat(language, { style: "unit", unit, maximumFractionDigits: 1 }).format(bytes / size);
    }
  }
  return new Intl.NumberFormat(language, { style: "unit", unit: "byte" }).format(bytes);
}

const number = new Intl.NumberFormat(language);

/** A limit as the form shows it. */
function toField(key: LimitKey, value: number): string {
  const spec: LimitSpec = LIMITS[key];
  if (spec.unit === "bytes") return String(Math.round((value / MB) * 100) / 100);
  if (spec.unit === "ms") return String(value / 1000);
  return String(value);
}

/** The form's text back into the server's unit; NaN for nonsense. */
function fromField(key: LimitKey, text: string): number {
  const value = Number(text.replace(",", "."));
  if (!text.trim() || !Number.isFinite(value)) return Number.NaN;
  const spec: LimitSpec = LIMITS[key];
  if (spec.unit === "bytes") return Math.round(value * MB);
  if (spec.unit === "ms") return Math.round(value * 1000);
  return Math.round(value);
}

/** A limit as a reader would say it: "300 / min", "25 MB", "No limit". */
function describe(key: LimitKey, value: number): string {
  const spec: LimitSpec = LIMITS[key];
  if (value === 0 && spec.zeroIsUnlimited) return t("admin.unlimited");
  if (spec.unit === "bytes") return formatBytes(value);
  if (spec.unit === "ms") return `${number.format(value / 1000)} ${t("admin.seconds")}`;
  return number.format(value);
}

const label = (key: LimitKey) => t(`admin.limit.${key}` as Parameters<typeof t>[0]);

function suffix(key: LimitKey): string {
  const unit = LIMITS[key].unit;
  if (unit === "bytes") return t("admin.megabytes");
  if (unit === "ms") return t("admin.seconds");
  return key === "updateBurst" ? "" : t("admin.perMinute");
}

async function load(): Promise<Phase> {
  const response = await fetch("/api/admin/overview");
  if (response.status === 404) return { kind: "off" };
  if (response.status === 401) return { kind: "signed-out" };
  if (!response.ok) return { kind: "failed" };
  return { kind: "ready", overview: (await response.json()) as AdminOverview };
}

export default function AdminPage() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  const refresh = useCallback(async () => {
    try {
      setPhase(await load());
    }
    catch {
      setPhase({ kind: "failed" });
    }
  }, []);

  useEffect(() => {
    document.title = `${t("admin.title")} — Code together!`;
    void refresh();
  }, [refresh]);

  async function signOut() {
    await fetch("/api/admin/logout", { method: "POST" });
    setPhase({ kind: "signed-out" });
  }

  return (
    <div className="admin">
      <header className="admin-bar">
        <h1 className="admin-title">{t("admin.title")}</h1>
        <a className="menu-button" href="/">{t("admin.back")}</a>
        {phase.kind === "ready" && (
          <button type="button" className="menu-button" onClick={() => void signOut()}>{t("admin.signOut")}</button>
        )}
      </header>

      <main className="admin-main">
        {phase.kind === "loading" && <p className="admin-muted">{t("common.loading")}</p>}
        {phase.kind === "failed" && <p className="dialog-error">{t("admin.loadFailed")}</p>}
        {phase.kind === "off" && (
          <section className="admin-card admin-narrow">
            <h2 className="admin-heading">{t("admin.off")}</h2>
            <p className="admin-muted">{t("admin.offNote")}</p>
          </section>
        )}
        {phase.kind === "signed-out" && <SignIn onSignedIn={() => void refresh()} />}
        {phase.kind === "ready" && (
          <Dashboard
            overview={phase.overview}
            onRefresh={() => void refresh()}
            onSaved={(limits) => setPhase({ kind: "ready", overview: { ...phase.overview, limits } })}
          />
        )}
      </main>
    </div>
  );
}

function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (response.ok) onSignedIn();
      else setError(response.status === 429 ? t("unlock.tooMany") : t("admin.wrong"));
    }
    catch {
      setError(t("common.noServer"));
    }
    finally {
      setBusy(false);
    }
  }

  return (
    <form className="admin-card admin-narrow dialog-form" onSubmit={(event) => void submit(event)}>
      <label className="dialog-field">
        <span className="dialog-label">{t("admin.token")}</span>
        <input
          className="dialog-input"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={token}
          onChange={(event) => {
            setToken(event.target.value);
            setError(null);
          }}
        />
      </label>
      {error && <p className="dialog-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="submit" className="menu-button dialog-primary" disabled={busy || !token}>{t("admin.signIn")}</button>
      </div>
    </form>
  );
}

function Stat({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="admin-stat">
      <dt className="admin-stat-name">{name}</dt>
      <dd className="admin-stat-value">{children}</dd>
    </div>
  );
}

interface DashboardProps {
  overview: AdminOverview;
  onRefresh: () => void;
  onSaved: (limits: Limits) => void;
}

function Dashboard({ overview, onRefresh, onSaved }: DashboardProps) {
  const { stats } = overview;
  return (
    <>
      <section className="admin-card">
        <div className="admin-card-head">
          <h2 className="admin-heading">{t("admin.status")}</h2>
          <button type="button" className="menu-button" onClick={onRefresh}>{t("admin.refresh")}</button>
        </div>
        <dl className="admin-stats">
          <Stat name={t("admin.documents")}>{number.format(stats.documents)}</Stat>
          <Stat name={t("admin.rooms")}>
            {t("admin.roomsValue", { rooms: number.format(stats.openRooms), editors: number.format(stats.editors) })}
          </Stat>
          <Stat name={t("admin.expiring")}>{number.format(stats.expiring)}</Stat>
          <Stat name={t("admin.pictures")}>
            {t("admin.filesValue", { files: number.format(stats.pictures.files), size: formatBytes(stats.pictures.bytes) })}
          </Stat>
          <Stat name={t("admin.attachments")}>
            {t("admin.filesValue", { files: number.format(stats.attachments.files), size: formatBytes(stats.attachments.bytes) })}
          </Stat>
          <Stat name={t("admin.database")}>{formatBytes(stats.databaseBytes)}</Stat>
          <Stat name={t("admin.tombstones")}>{number.format(stats.tombstones)}</Stat>
        </dl>
      </section>

      <LimitsForm
        title={t("admin.rateLimits")}
        note={t("admin.rateNote")}
        keys={RATE_LIMIT_KEYS}
        overview={overview}
        onSaved={onSaved}
      />
      <LimitsForm
        title={t("admin.quotas")}
        note={t("admin.quotaNote")}
        keys={SIZE_LIMIT_KEYS}
        overview={overview}
        onSaved={onSaved}
      />
    </>
  );
}

interface LimitsFormProps {
  title: string;
  note: string;
  keys: LimitKey[];
  overview: AdminOverview;
  onSaved: (limits: Limits) => void;
}

function LimitsForm({ title, note, keys, overview, onSaved }: LimitsFormProps) {
  const fields = useCallback(
    () => Object.fromEntries(keys.map((key) => [key, toField(key, overview.limits[key])])) as Record<LimitKey, string>,
    [keys, overview.limits],
  );
  const [values, setValues] = useState(fields);
  /** limits to put back to the environment's value on save */
  const [reset, setReset] = useState<Set<LimitKey>>(new Set());
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" } | { kind: "error"; text: string }>({ kind: "idle" });

  // What the server now says, after a save here or in the other form.
  useEffect(() => {
    setValues(fields());
    setReset(new Set());
  }, [fields]);

  const invalid = (key: LimitKey): boolean => {
    const value = fromField(key, values[key]);
    const spec: LimitSpec = LIMITS[key];
    if (Number.isNaN(value)) return true;
    if (value === 0 && spec.zeroIsUnlimited) return false;
    return value < spec.min || value > spec.max;
  };

  const changed = keys.filter((key) => reset.has(key) || fromField(key, values[key]) !== overview.limits[key]);

  async function save(event: FormEvent) {
    event.preventDefault();
    const bad = keys.find(invalid);
    if (bad) {
      setStatus({ kind: "error", text: t("admin.saveFailed", { field: label(bad) }) });
      return;
    }
    const update: LimitsUpdate = {};
    for (const key of changed) update[key] = reset.has(key) ? null : fromField(key, values[key]);
    setStatus({ kind: "saving" });
    try {
      const response = await fetch("/api/admin/limits", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(update),
      });
      const body = (await response.json()) as { limits: Limits } | { error: string; key: string };
      if (!response.ok || "error" in body) {
        const key = "key" in body && body.key in LIMITS ? label(body.key as LimitKey) : "?";
        setStatus({ kind: "error", text: t("admin.saveFailed", { field: key }) });
        return;
      }
      onSaved(body.limits);
      setStatus({ kind: "saved" });
    }
    catch {
      setStatus({ kind: "error", text: t("common.noServer") });
    }
  }

  return (
    <form className="admin-card" onSubmit={(event) => void save(event)}>
      <h2 className="admin-heading">{title}</h2>
      <p className="admin-muted">{note}</p>

      <div className="admin-limits">
        {keys.map((key) => {
          const spec: LimitSpec = LIMITS[key];
          const fallback = overview.defaults[key];
          const isDefault = !reset.has(key) && overview.limits[key] === fallback && fromField(key, values[key]) === fallback;
          const min = spec.min;
          return (
            <div className="admin-limit" key={key}>
              <label className="admin-limit-label" htmlFor={`limit-${key}`}>{label(key)}</label>
              <div className="admin-limit-input">
                <input
                  id={`limit-${key}`}
                  className="dialog-input"
                  inputMode="decimal"
                  value={values[key]}
                  aria-invalid={invalid(key)}
                  aria-describedby={`limit-${key}-hint`}
                  onChange={(event) => {
                    setValues((was) => ({ ...was, [key]: event.target.value }));
                    setReset((was) => {
                      const next = new Set(was);
                      next.delete(key);
                      return next;
                    });
                    setStatus({ kind: "idle" });
                  }}
                />
                {suffix(key) && <span className="admin-unit">{suffix(key)}</span>}
              </div>
              <p className="admin-limit-hint" id={`limit-${key}-hint`}>
                {t("admin.default", { value: describe(key, fallback) })}
                {" · "}
                {spec.zeroIsUnlimited
                  ? t("admin.allowedUpTo", { max: describe(key, spec.max) })
                  : t("admin.allowed", { min: describe(key, min), max: describe(key, spec.max) })}
                {!isDefault && (
                  <>
                    {" · "}
                    <button
                      type="button"
                      className="admin-link"
                      onClick={() => {
                        setValues((was) => ({ ...was, [key]: toField(key, fallback) }));
                        setReset((was) => new Set(was).add(key));
                        setStatus({ kind: "idle" });
                      }}
                    >
                      {t("admin.reset")}
                    </button>
                  </>
                )}
              </p>
            </div>
          );
        })}
      </div>

      <div className="admin-actions">
        {status.kind === "saved" && <span className="admin-ok" role="status">{t("admin.saved")}</span>}
        {status.kind === "error" && <span className="dialog-error" role="alert">{status.text}</span>}
        <button type="submit" className="menu-button dialog-primary" disabled={changed.length === 0 || status.kind === "saving"}>
          {status.kind === "saving" ? t("admin.saving") : t("admin.save")}
        </button>
      </div>
    </form>
  );
}
