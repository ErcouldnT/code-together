import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { env } from "./env.js";
import { limits } from "./settings.js";

/**
 * How much the stored files take up, for the storage quota and the admin
 * screen.
 *
 * Measured by walking the upload directory, which is cheap at this scale but
 * not free, so the answer is kept for a minute and adjusted by hand as files
 * are added in between. Slightly stale in the safe direction: a deletion is
 * only noticed at the next walk, so for up to a minute the quota thinks there
 * is less room than there is, never more.
 */

export interface Usage {
  pictures: { files: number; bytes: number };
  attachments: { files: number; bytes: number };
}

const FRESH_MS = 60_000;
let cached: { at: number; usage: Usage } | null = null;

function walk(dir: string, into: { files: number; bytes: number }, skip?: string): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  }
  catch {
    return; // not made yet
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (path !== skip) walk(path, into, skip);
    }
    else if (entry.isFile()) {
      try {
        into.bytes += statSync(path).size;
        into.files += 1;
      }
      catch {
        // removed while we looked
      }
    }
  }
}

export function storageUsage(force = false): Usage {
  if (!force && cached && Date.now() - cached.at < FRESH_MS) return cached.usage;
  const root = resolve(env.uploadDir);
  const attachmentsDir = join(root, "attachments");
  const usage: Usage = { pictures: { files: 0, bytes: 0 }, attachments: { files: 0, bytes: 0 } };
  walk(root, usage.pictures, attachmentsDir);
  walk(attachmentsDir, usage.attachments);
  cached = { at: Date.now(), usage };
  return usage;
}

export function totalStored(): number {
  const usage = storageUsage();
  return usage.pictures.bytes + usage.attachments.bytes;
}

/** Count bytes just written, until the next walk counts them properly. */
export function noteStored(kind: keyof Usage, bytes: number): void {
  if (!cached) return;
  cached.usage[kind].bytes += bytes;
  cached.usage[kind].files += 1;
}

/** Room left under the storage quota, or Infinity with no quota set. */
export function storageRoom(): number {
  const quota = limits().storageQuotaBytes;
  return quota > 0 ? Math.max(0, quota - totalStored()) : Infinity;
}
