/**
 * The admin screen's half of the wire contract: which limits it may change,
 * in what range, and what it is told about the server.
 *
 * Runtime code with no imports, like `access.ts`, so both builds can use it.
 * The ranges live here rather than only on the server so the form can say
 * what is allowed before anything is sent — the server checks them again.
 */

export type LimitUnit = "count" | "bytes" | "ms";

export interface LimitSpec {
  unit: LimitUnit;
  min: number;
  max: number;
  /** 0 means "no limit" rather than "nothing allowed" */
  zeroIsUnlimited?: boolean;
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
  attachmentQuotaBytes: { unit: "bytes", min: 0, max: 1024 * GB, zeroIsUnlimited: true },
  storageQuotaBytes: { unit: "bytes", min: 0, max: 100 * 1024 * GB, zeroIsUnlimited: true },
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

export function isLimitKey(value: string): value is LimitKey {
  return Object.hasOwn(LIMITS, value);
}

/** Whole numbers inside the range, or zero where zero means unlimited. */
export function validLimit(key: LimitKey, value: unknown): value is number {
  const spec: LimitSpec = LIMITS[key];
  if (typeof value !== "number" || !Number.isInteger(value)) return false;
  if (value === 0 && spec.zeroIsUnlimited) return true;
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

/** `PUT /api/admin/limits` — a subset; null puts a limit back to its default. */
export type LimitsUpdate = Partial<Record<LimitKey, number | null>>;
