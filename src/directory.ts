import { and, asc, count, desc, eq, inArray, isNotNull, isNull, sql, sum, type SQL } from "drizzle-orm";
import * as Y from "yjs";
import {
  DIRECTORY_PAGE,
  type AdminStats,
  type DirectoryPage,
  type DirectoryProtection,
  type DirectorySort,
  type DocumentDetail,
} from "../shared/admin.js";
import { TEXT_KEY } from "../shared/ydoc.js";
import { db } from "./db/index.js";
import { documentAttachments, documentEditors, documents, documentSnapshots } from "./db/schema.js";
import { peekRoom, roomMembers } from "./rooms.js";

/**
 * Every document on the server, a page at a time, for the admin screen to
 * link to — and what can be said about all of them together.
 *
 * Searched by title or address and filtered by password and by where it was
 * made or changed from. The contents are never read for a list, so listing
 * costs the same whatever the documents hold; only the one document opened
 * for detail is decoded.
 */

const DAY = 24 * 60 * 60 * 1000;

/** `%`, `_` and the escape itself, made literal inside a LIKE pattern. */
function likeEscape(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface DirectoryQuery {
  query?: string;
  sort?: DirectorySort;
  openOnly?: boolean;
  protection?: DirectoryProtection;
  /** the start of an address, so `85.105.` finds a whole block */
  ip?: string;
  country?: string;
  offset?: number;
}

function filtersFor(options: DirectoryQuery, open: string[]): SQL | undefined {
  const filters: SQL[] = [];
  const text = options.query?.trim();
  if (text) {
    const pattern = `%${likeEscape(text)}%`;
    filters.push(sql`(${documents.title} LIKE ${pattern} ESCAPE '\\' OR ${documents.id} LIKE ${pattern} ESCAPE '\\')`);
  }
  // nothing open is an empty IN, which SQLite reads as false — as it should
  if (options.openOnly) filters.push(inArray(documents.id, open));

  switch (options.protection) {
    case "none": filters.push(isNull(documents.passwordHash)); break;
    case "locked": filters.push(isNotNull(documents.passwordHash)); break;
    case "view": filters.push(and(isNotNull(documents.passwordHash), eq(documents.protect, "view"))!); break;
    case "edit": filters.push(and(isNotNull(documents.passwordHash), eq(documents.protect, "edit"))!); break;
    default: break;
  }

  const ip = options.ip?.trim();
  if (ip) {
    const prefix = `${likeEscape(ip)}%`;
    filters.push(sql`(${documents.createdIp} LIKE ${prefix} ESCAPE '\\' OR EXISTS (
      SELECT 1 FROM ${documentEditors} WHERE ${documentEditors.documentId} = ${documents.id}
      AND ${documentEditors.ip} LIKE ${prefix} ESCAPE '\\'))`);
  }
  const country = options.country?.trim().toUpperCase();
  if (country) {
    filters.push(sql`(${documents.createdCountry} = ${country} OR EXISTS (
      SELECT 1 FROM ${documentEditors} WHERE ${documentEditors.documentId} = ${documents.id}
      AND ${documentEditors.country} = ${country}))`);
  }
  return filters.length ? and(...filters) : undefined;
}

/** Every country anything was made or changed from. */
function knownCountries(): string[] {
  const rows = db.all<{ country: string }>(sql`
    SELECT created_country AS country FROM documents WHERE created_country IS NOT NULL
    UNION SELECT country FROM document_editors WHERE country IS NOT NULL
    ORDER BY country`);
  return rows.map((row) => row.country);
}

export function listDocuments(options: DirectoryQuery): DirectoryPage {
  const sort = options.sort ?? "updated";
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const members = roomMembers();
  const where = filtersFor(options, [...members.keys()]);

  const size = sql<number>`coalesce(length(${documents.ystate}), 0)`;
  const lastChange = sql`coalesce(${documents.editedAt}, ${documents.updatedAt})`;
  const order = sort === "created"
    ? [desc(documents.createdAt), asc(documents.id)]
    : sort === "size"
      ? [desc(size), asc(documents.id)]
      : [desc(lastChange), asc(documents.id)];

  const total = db.select({ n: count() }).from(documents).where(where).get()?.n ?? 0;
  const rows = db
    .select({
      id: documents.id,
      title: documents.title,
      createdAt: documents.createdAt,
      updatedAt: documents.updatedAt,
      protect: documents.protect,
      passwordHash: documents.passwordHash,
      expiresAt: documents.expiresAt,
      bytes: size,
      createdIp: documents.createdIp,
      createdCountry: documents.createdCountry,
      editedIp: documents.editedIp,
      editedCountry: documents.editedCountry,
      editedAt: documents.editedAt,
    })
    .from(documents)
    .where(where)
    .orderBy(...order)
    .limit(DIRECTORY_PAGE)
    .offset(offset)
    .all();

  return {
    total,
    offset,
    countries: knownCountries(),
    documents: rows.map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
      protect: row.passwordHash ? row.protect : null,
      expiresAt: row.expiresAt?.getTime() ?? null,
      bytes: row.bytes,
      editors: members.get(row.id) ?? 0,
      createdIp: row.createdIp,
      createdCountry: row.createdCountry,
      editedIp: row.editedIp,
      editedCountry: row.editedCountry,
      editedAt: row.editedAt?.getTime() ?? null,
    })),
  };
}

/** Everything about one document: who changed it, how long it is, what hangs off it. */
export function documentDetail(id: string): DocumentDetail | null {
  const row = db.select({ ystate: documents.ystate }).from(documents).where(eq(documents.id, id)).get();
  if (!row) return null;

  // the open room is up to one save ahead of the row
  let text = "";
  const live = peekRoom(id);
  if (live) text = live.doc.getText(TEXT_KEY).toString();
  else if (row.ystate && row.ystate.length > 0) {
    const doc = new Y.Doc();
    try {
      Y.applyUpdate(doc, new Uint8Array(row.ystate));
      text = doc.getText(TEXT_KEY).toString();
    }
    catch {
      // unreadable is shown as empty; the size in the list still tells the truth
    }
    finally {
      doc.destroy();
    }
  }

  const editors = db.select().from(documentEditors).where(eq(documentEditors.documentId, id))
    .orderBy(desc(documentEditors.lastAt)).all();
  const files = db.select({ n: count(), bytes: sum(documentAttachments.size) }).from(documentAttachments)
    .where(eq(documentAttachments.documentId, id)).get();
  const snapshots = db.select({ n: count() }).from(documentSnapshots)
    .where(eq(documentSnapshots.documentId, id)).get()?.n ?? 0;

  const visible = text.replace(/\n$/, "");
  return {
    editors: editors.map((e) => ({
      ip: e.ip,
      country: e.country,
      edits: e.edits,
      firstAt: e.firstAt.getTime(),
      lastAt: e.lastAt.getTime(),
    })),
    characters: [...visible].length,
    words: visible.split(/\s+/u).filter(Boolean).length,
    snapshots,
    attachments: { files: files?.n ?? 0, bytes: Number(files?.bytes ?? 0) },
  };
}

/** UTC calendar day of an epoch-ms time, as `YYYY-MM-DD`. */
function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function adminStats(now = Date.now()): AdminStats {
  const protection = { open: 0, view: 0, edit: 0 };
  for (const row of db.select({ protect: documents.protect, locked: documents.passwordHash, n: count() })
    .from(documents).groupBy(documents.protect, sql`${documents.passwordHash} IS NULL`).all()) {
    if (!row.locked || !row.protect) protection.open += row.n;
    else protection[row.protect] += row.n;
  }

  const since = now - 29 * DAY;
  const start = Date.parse(`${dayOf(since)}T00:00:00Z`);
  const perDay = new Map(db.all<{ day: string; n: number }>(sql`
    SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS day, count(*) AS n
    FROM documents WHERE created_at >= ${start} GROUP BY day`).map((r) => [r.day, r.n]));
  const createdPerDay = Array.from({ length: 30 }, (_, i) => {
    const day = dayOf(start + i * DAY);
    return { day, count: perDay.get(day) ?? 0 };
  });

  // One row per country: documents made there, documents changed from
  // there, the changes, and how many addresses.
  const countries = db.all<{ country: string | null; created: number; documents: number; edits: number; ips: number }>(sql`
    WITH made AS (
      SELECT created_country AS country, count(*) AS created FROM documents
      WHERE created_ip IS NOT NULL GROUP BY created_country
    ), changed AS (
      SELECT country, count(DISTINCT document_id) AS documents, sum(edits) AS edits FROM document_editors GROUP BY country
    ), addresses AS (
      SELECT country, count(DISTINCT ip) AS ips FROM (
        SELECT created_country AS country, created_ip AS ip FROM documents WHERE created_ip IS NOT NULL
        UNION SELECT country, ip FROM document_editors
      ) GROUP BY country
    )
    SELECT a.country AS country, coalesce(m.created, 0) AS created, coalesce(c.documents, 0) AS documents,
      coalesce(c.edits, 0) AS edits, a.ips AS ips
    FROM addresses a
    LEFT JOIN made m ON m.country IS a.country
    LEFT JOIN changed c ON c.country IS a.country
    ORDER BY edits + created DESC, ips DESC
    LIMIT 50`);

  const ips = db.all<{ ip: string; country: string | null; created: number; documents: number; edits: number; lastAt: number | null }>(sql`
    WITH made AS (
      SELECT created_ip AS ip, max(created_country) AS country, count(*) AS created, max(created_at) AS at
      FROM documents WHERE created_ip IS NOT NULL GROUP BY created_ip
    ), changed AS (
      SELECT ip, max(country) AS country, count(*) AS documents, sum(edits) AS edits, max(last_at) AS at
      FROM document_editors GROUP BY ip
    ), every AS (SELECT ip FROM made UNION SELECT ip FROM changed)
    SELECT e.ip AS ip, coalesce(c.country, m.country) AS country, coalesce(m.created, 0) AS created,
      coalesce(c.documents, 0) AS documents, coalesce(c.edits, 0) AS edits, max(coalesce(c.at, 0), coalesce(m.at, 0)) AS lastAt
    FROM every e LEFT JOIN made m ON m.ip = e.ip LEFT JOIN changed c ON c.ip = e.ip
    ORDER BY edits + created DESC, lastAt DESC
    LIMIT 25`);

  const totals = db.get<{ ips: number; countries: number; edits: number | null; unknown: number }>(sql`
    SELECT
      (SELECT count(*) FROM (SELECT created_ip FROM documents WHERE created_ip IS NOT NULL UNION SELECT ip FROM document_editors)) AS ips,
      (SELECT count(*) FROM (SELECT created_country FROM documents WHERE created_country IS NOT NULL UNION SELECT country FROM document_editors WHERE country IS NOT NULL)) AS countries,
      (SELECT sum(edits) FROM document_editors) AS edits,
      (SELECT count(*) FROM documents WHERE created_ip IS NULL) AS "unknown"`);

  const extremes = db.get<{ oldest: number | null; newest: number | null; lastEdit: number | null; n: number }>(sql`
    SELECT min(created_at) AS oldest, max(created_at) AS newest,
      max(coalesce(edited_at, updated_at)) AS lastEdit, count(*) AS n FROM documents`);
  let medianDays: number | null = null;
  if (extremes && extremes.n > 0) {
    const middle = db.get<{ at: number }>(sql`
      SELECT created_at AS at FROM documents ORDER BY created_at LIMIT 1 OFFSET ${Math.floor(extremes.n / 2)}`);
    if (middle) medianDays = Math.floor((now - middle.at) / DAY);
  }

  return {
    protection,
    createdPerDay,
    countries,
    ips: ips.map((row) => ({ ...row, lastAt: row.lastAt || null })),
    totals: {
      ips: totals?.ips ?? 0,
      countries: totals?.countries ?? 0,
      edits: totals?.edits ?? 0,
      unknownOrigin: totals?.unknown ?? 0,
    },
    ages: {
      oldest: extremes?.oldest ?? null,
      newest: extremes?.newest ?? null,
      medianDays,
      lastEdit: extremes?.lastEdit ?? null,
    },
  };
}
