/**
 * The documents you have opened, kept in this browser.
 *
 * Not on the server, and that is a decision rather than an omission: there is
 * no access control here, so a room list the server owns would be a list of
 * everybody's documents handed to everybody. Locally it is only ever a record
 * of rooms you already had the address of.
 */

const STORAGE_KEY = "code-together:recent";
const LIMIT = 12;

export interface RecentDocument {
  id: string;
  title: string;
  /** epoch ms, for ordering */
  at: number;
}

function read(): RecentDocument[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is RecentDocument =>
        typeof entry === "object"
        && entry !== null
        && typeof (entry as RecentDocument).id === "string"
        && typeof (entry as RecentDocument).at === "number",
    );
  }
  catch {
    return [];
  }
}

export function recentDocuments(): RecentDocument[] {
  return read().sort((a, b) => b.at - a.at);
}

/**
 * Record a visit, or update the title of one already recorded.
 *
 * Called again whenever the title changes, so the list shows what a document
 * is now rather than what it was called the first time it was opened.
 */
export function rememberDocument(id: string, title: string): void {
  const entries = read().filter((entry) => entry.id !== id);
  entries.unshift({ id, title, at: Date.now() });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, LIMIT)));
  }
  catch {
    // private mode or a full quota; the list is a convenience, not the data
  }
}

export function forgetDocument(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(read().filter((entry) => entry.id !== id)));
  }
  catch {
    // as above
  }
}
