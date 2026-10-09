import { eq } from "drizzle-orm";
import { isLimitKey, validLimit, type LimitKey, type Limits, type LimitsUpdate } from "../shared/admin.js";
import { db } from "./db/index.js";
import { settings } from "./db/schema.js";
import { env } from "./env.js";

/**
 * The limits the server enforces, as they stand right now.
 *
 * Each starts as the environment says and can be changed from the admin
 * screen without a restart. Every place that enforces one reads it from here
 * at the moment it is needed — the rate limiters take a function, the socket
 * reads it per update — so a change applies to the very next request.
 *
 * Held in memory and written through: the database is read once at boot and
 * after that only written, because these are consulted on every keystroke.
 */

export function defaultLimits(): Limits {
  return {
    requestsPerMinute: env.requestsPerMinute,
    unlockAttemptsPerMinute: 10,
    documentCreationsPerMinute: 30,
    updateBurst: env.updateBurst,
    updateWindowMs: env.updateWindowMs,
    maxDocumentBytes: env.maxDocumentBytes,
    maxUploadBytes: env.maxUploadBytes,
    maxAttachmentBytes: env.maxAttachmentBytes,
    attachmentQuotaBytes: env.attachmentQuotaBytes,
    storageQuotaBytes: env.storageQuotaBytes,
  };
}

let current: Limits | null = null;

function load(): Limits {
  const limits = defaultLimits();
  for (const row of db.select().from(settings).all()) {
    // A row from a version that had a limit this one does not, or a value
    // that no longer fits the range, is ignored rather than trusted.
    if (isLimitKey(row.key) && validLimit(row.key, row.value)) limits[row.key] = row.value;
  }
  return limits;
}

export function limits(): Limits {
  current ??= load();
  return current;
}

/** Forget the cached copy; the next read comes from the database. For tests. */
export function reloadLimits(): void {
  current = null;
}

export type UpdateResult = { limits: Limits } | { error: "bad-limit"; key: string };

/**
 * Change some limits. All or nothing: one bad value and none are written, so
 * a form submitted with a typo does not leave the server half-changed.
 */
export function updateLimits(update: LimitsUpdate): UpdateResult {
  const entries = Object.entries(update);
  for (const [key, value] of entries) {
    if (!isLimitKey(key)) return { error: "bad-limit", key };
    if (value !== null && !validLimit(key, value)) return { error: "bad-limit", key };
  }

  db.transaction((tx) => {
    for (const [key, value] of entries as [LimitKey, number | null][]) {
      if (value === null) tx.delete(settings).where(eq(settings.key, key)).run();
      else {
        tx.insert(settings)
          .values({ key, value, updatedAt: new Date() })
          .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } })
          .run();
      }
    }
  });
  current = load();
  return { limits: current };
}
