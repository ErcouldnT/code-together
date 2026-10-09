import { t } from "../i18n";
import { countryName, flag } from "./format";

/**
 * Where something came from: a country and an address, each a button that
 * narrows the document list to it.
 */
export interface OriginFilter {
  ip?: string;
  country?: string;
}

interface Props {
  ip: string | null;
  country: string | null;
  onFilter?: (filter: OriginFilter) => void;
}

export function Country({ code, onFilter }: { code: string | null; onFilter?: (filter: OriginFilter) => void }) {
  if (!code) return <span className="admin-muted-inline">{t("admin.privateAddress")}</span>;
  const label = `${flag(code)} ${countryName(code)}`;
  if (!onFilter) return <span>{label}</span>;
  return (
    <button type="button" className="admin-chip" title={t("admin.filterBy")} onClick={() => onFilter({ country: code })}>
      {label}
    </button>
  );
}

export function Address({ ip, onFilter }: { ip: string; onFilter?: (filter: OriginFilter) => void }) {
  if (!onFilter) return <code className="admin-ip">{ip}</code>;
  return (
    <button type="button" className="admin-chip admin-ip" title={t("admin.filterBy")} onClick={() => onFilter({ ip })}>
      {ip}
    </button>
  );
}

export default function Origin({ ip, country, onFilter }: Props) {
  if (!ip) return <span className="admin-muted-inline">{t("admin.unknownOrigin")}</span>;
  return (
    <span className="admin-origin">
      <Country code={country} onFilter={onFilter} />
      <Address ip={ip} onFilter={onFilter} />
    </span>
  );
}
