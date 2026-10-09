import { and, asc, desc, inArray, sql, type SQL } from "drizzle-orm";
import { DIRECTORY_PAGE, type DirectoryPage, type DirectorySort } from "../shared/admin.js";
import { db } from "./db/index.js";
import { documents } from "./db/schema.js";
import { roomMembers } from "./rooms.js";

/**
 * Every document on the server, a page at a time, for the admin screen to
 * link to. Searched by title or address; the contents are never read here,
 * so listing costs the same whatever the documents hold.
 */

/** `%`, `_` and the escape itself, made literal inside a LIKE pattern. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function listDocuments(options: {
  query?: string;
  sort?: DirectorySort;
  openOnly?: boolean;
  offset?: number;
}): DirectoryPage {
  const { query = "", sort = "updated", openOnly = false } = options;
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const members = roomMembers();

  const filters: SQL[] = [];
  const text = query.trim();
  if (text) {
    const pattern = likePattern(text);
    filters.push(sql`(${documents.title} LIKE ${pattern} ESCAPE '\\' OR ${documents.id} LIKE ${pattern} ESCAPE '\\')`);
  }
  if (openOnly) {
    // nothing open is an empty IN, which SQLite reads as false — as it should
    filters.push(inArray(documents.id, [...members.keys()]));
  }
  const where = filters.length ? and(...filters) : undefined;

  const size = sql<number>`coalesce(length(${documents.ystate}), 0)`;
  const order = sort === "created"
    ? [desc(documents.createdAt), asc(documents.id)]
    : sort === "size"
      ? [desc(size), asc(documents.id)]
      : [desc(documents.updatedAt), asc(documents.id)];

  const total = db.select({ n: sql<number>`count(*)` }).from(documents).where(where).get()?.n ?? 0;
  const rows = db
    .select({
      id: documents.id,
      title: documents.title,
      createdAt: documents.createdAt,
      updatedAt: documents.updatedAt,
      protect: documents.protect,
      expiresAt: documents.expiresAt,
      bytes: size,
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
    documents: rows.map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
      protect: row.protect,
      expiresAt: row.expiresAt?.getTime() ?? null,
      bytes: row.bytes,
      editors: members.get(row.id) ?? 0,
    })),
  };
}
