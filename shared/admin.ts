/**
 * The admin screen's half of the wire contract: which limits it may change,
 * in what range, and what it is told about the server.
 *
 * Runtime code with no imports, like `access.ts`, so both builds can use it.
 * The ranges live here rather than only on the server so the form can say
 * what is allowed before anything is sent — the server checks them again.
 */

export type LimitUnit = "count" | "bytes" | "ms" | "hours" | "days";

export interface LimitSpec {
  unit: LimitUnit;
  min: number;
  max: number;
  /**
   * What 0 means, where it is allowed below `min`: "unlimited" for a quota,
   * "off" for an automatic job.
   */
  zero?: "unlimited" | "off";
}

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;

export const LIMITS = {
  // rate limits
  requestsPerMinute: { unit: "count", min: 10, max: 100_000 },
  unlockAttemptsPerMinute: { unit: "count", min: 1, max: 1000 },
  documentCreationsPerMinute: { unit: "count", min: 1, max: 10_000 },
  updateBurst: { unit: "count", min: 10, max: 100_000 },
  updateWindowMs: { unit: "ms", min: 1000, max: 10 * 60 * 1000 },
  // sizes and quotas
  maxDocumentBytes: { unit: "bytes", min: 64 * KB, max: GB },
  maxUploadBytes: { unit: "bytes", min: 64 * KB, max: GB },
  maxAttachmentBytes: { unit: "bytes", min: 64 * KB, max: 100 * GB },
  attachmentQuotaBytes: { unit: "bytes", min: 0, max: 1024 * GB, zero: "unlimited" },
  storageQuotaBytes: { unit: "bytes", min: 0, max: 100 * 1024 * GB, zero: "unlimited" },
  // automatic cleanup, run hourly
  emptyDocumentHours: { unit: "hours", min: 1, max: 24 * 365, zero: "off" },
  abandonedDocumentDays: { unit: "days", min: 1, max: 3650, zero: "off" },
} as const satisfies Record<string, LimitSpec>;

export type LimitKey = keyof typeof LIMITS;
export type Limits = Record<LimitKey, number>;

export const RATE_LIMIT_KEYS: LimitKey[] = [
  "requestsPerMinute",
  "unlockAttemptsPerMinute",
  "documentCreationsPerMinute",
  "updateBurst",
  "updateWindowMs",
];

export const SIZE_LIMIT_KEYS: LimitKey[] = [
  "maxDocumentBytes",
  "maxUploadBytes",
  "maxAttachmentBytes",
  "attachmentQuotaBytes",
  "storageQuotaBytes",
];

export const CLEANUP_KEYS: LimitKey[] = ["emptyDocumentHours", "abandonedDocumentDays"];

export function isLimitKey(value: string): value is LimitKey {
  return Object.hasOwn(LIMITS, value);
}

/** Whole numbers inside the range, or zero where zero means unlimited or off. */
export function validLimit(key: LimitKey, value: unknown): value is number {
  const spec: LimitSpec = LIMITS[key];
  if (typeof value !== "number" || !Number.isInteger(value)) return false;
  if (value === 0 && spec.zero) return true;
  return value >= spec.min && value <= spec.max;
}

/** `GET /api/admin/overview` */
export interface AdminOverview {
  limits: Limits;
  /** what each limit is when nobody has changed it, from the environment */
  defaults: Limits;
  stats: {
    documents: number;
    expiring: number;
    tombstones: number;
    openRooms: number;
    editors: number;
    pictures: { files: number; bytes: number };
    attachments: { files: number; bytes: number };
    databaseBytes: number;
  };
}

/** One document as the cleanup preview lists it. */
export interface CleanupEntry {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
}

/** `GET /api/admin/cleanup?days=N` */
export interface CleanupPreview {
  empty: { count: number; sample: CleanupEntry[]; olderThanHours: number };
  abandoned: { count: number; sample: CleanupEntry[]; days: number };
}

/** `POST /api/admin/cleanup` */
export type CleanupRequest = { kind: "empty" } | { kind: "abandoned"; days: number };

/** Days the abandoned-document preview offers. */
export const ABANDONED_CHOICES = [30, 90, 180, 365] as const;

/** One document as the admin screen's directory lists it. */
export interface DirectoryEntry {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  /** what a password guards, or null for an open document */
  protect: "view" | "edit" | null;
  expiresAt: number | null;
  /** the stored Yjs state, which is near enough the document's size */
  bytes: number;
  /** people in the room right now */
  editors: number;
  /** where it was made from; null for documents older than the record */
  createdIp: string | null;
  createdCountry: string | null;
  /** where the latest change came from, and when */
  editedIp: string | null;
  editedCountry: string | null;
  editedAt: number | null;
}

export const DIRECTORY_SORTS = ["updated", "created", "size"] as const;
export type DirectorySort = (typeof DIRECTORY_SORTS)[number];

/**
 * none: no password; locked: any password; view: a password to read it;
 * edit: anyone reads, only the password writes — read-only to visitors.
 */
export const DIRECTORY_PROTECTIONS = ["all", "none", "locked", "view", "edit"] as const;
export type DirectoryProtection = (typeof DIRECTORY_PROTECTIONS)[number];

export const DIRECTORY_PAGE = 25;

/** `GET /api/admin/documents?q=&sort=&open=&protection=&ip=&country=&offset=` */
export interface DirectoryPage {
  total: number;
  offset: number;
  documents: DirectoryEntry[];
  /** every country anything was made or changed from, for the filter */
  countries: string[];
}

/** One address that has changed a document. */
export interface EditorEntry {
  ip: string;
  country: string | null;
  edits: number;
  firstAt: number;
  lastAt: number;
}

/** `GET /api/admin/documents/:id` */
export interface DocumentDetail {
  editors: EditorEntry[];
  characters: number;
  words: number;
  snapshots: number;
  attachments: { files: number; bytes: number };
}

/** `GET /api/admin/stats` */
export interface AdminStats {
  protection: { open: number; view: number; edit: number };
  /** the last 30 days, oldest first, every day present */
  createdPerDay: { day: string; count: number }[];
  /** per country, most active first; null is a private or unknown address */
  countries: { country: string | null; created: number; documents: number; edits: number; ips: number }[];
  ips: { ip: string; country: string | null; created: number; documents: number; edits: number; lastAt: number | null }[];
  totals: { ips: number; countries: number; edits: number; unknownOrigin: number };
  ages: { oldest: number | null; newest: number | null; medianDays: number | null; lastEdit: number | null };
}

/** `PUT /api/admin/limits` — a subset; null puts a limit back to its default. */
export type LimitsUpdate = Partial<Record<LimitKey, number | null>>;
