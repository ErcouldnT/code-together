import { statSync } from "node:fs";
import { resolve } from "node:path";
import { count } from "drizzle-orm";
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { ABANDONED_CHOICES, DIRECTORY_PROTECTIONS, DIRECTORY_SORTS, type AdminOverview, type CleanupPreview, type LimitsUpdate } from "../shared/admin.js";
import { adminEnabled, isAdminRequest } from "./auth.js";
import { deleteDocuments, findAbandoned, findEmpty, preview } from "./cleanup.js";
import { db } from "./db/index.js";
import { documents, expiredDocuments } from "./db/schema.js";
import { adminStats, documentDetail, listDocuments } from "./directory.js";
import { env } from "./env.js";
import { countExpiring } from "./expiry.js";
import { ROOM_ID, roomStats } from "./rooms.js";
import { defaultLimits, limits, updateLimits } from "./settings.js";
import { storageUsage } from "./storage.js";

/**
 * The admin screen's routes, for an admin signed in through Better Auth
 * (see auth.ts). With no admin configured none of this exists: every route
 * below answers 404, exactly as an unknown path would.
 */

/** The whole admin surface vanishes without an admin. */
function enabled(_req: Request, res: Response, next: NextFunction): void {
  if (!adminEnabled) res.sendStatus(404);
  else next();
}

async function signedIn(req: Request, res: Response, next: NextFunction): Promise<void> {
  // resolved once per request by `resolveAdmin` when the app mounts it
  const admin = typeof res.locals.admin === "boolean" ? res.locals.admin : await isAdminRequest(req.headers);
  if (!admin) res.status(401).json({ error: "not-signed-in" });
  else next();
}

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  }
  catch {
    return 0;
  }
}

export function overview(): AdminOverview {
  const database = resolve(env.databasePath);
  const { rooms, editors } = roomStats();
  return {
    limits: limits(),
    defaults: defaultLimits(),
    stats: {
      documents: db.select({ n: count() }).from(documents).get()?.n ?? 0,
      expiring: countExpiring(),
      tombstones: db.select({ n: count() }).from(expiredDocuments).get()?.n ?? 0,
      openRooms: rooms,
      editors,
      // walked fresh: this is the one place someone is looking at the number
      ...storageUsage(true),
      databaseBytes: fileSize(database) + fileSize(`${database}-wal`),
    },
  };
}

export function adminRoutes(): Router {
  const router = express.Router();
  router.use("/api/admin", enabled);

  router.get("/api/admin/overview", signedIn, (_req, res) => {
    res.set("cache-control", "no-store").json(overview());
  });

  router.put("/api/admin/limits", signedIn, express.json({ limit: "4kb" }), (req, res) => {
    const body = req.body as unknown;
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      res.status(400).json({ error: "bad-limit" });
      return;
    }
    const result = updateLimits(body as LimitsUpdate);
    if ("error" in result) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  });

  router.get("/api/admin/documents", signedIn, (req, res) => {
    const { q, sort, open, protection, ip, country, offset } = req.query;
    const text = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");
    res.set("cache-control", "no-store").json(listDocuments({
      query: text(q, 200),
      sort: DIRECTORY_SORTS.find((choice) => choice === sort) ?? "updated",
      openOnly: open === "1",
      protection: DIRECTORY_PROTECTIONS.find((choice) => choice === protection) ?? "all",
      ip: text(ip, 64),
      country: /^[A-Za-z]{2}$/.test(text(country, 2)) ? text(country, 2) : "",
      offset: Number(offset) || 0,
    }));
  });

  router.get("/api/admin/documents/:id", signedIn, (req, res) => {
    const id = String(req.params.id);
    const detail = ROOM_ID.test(id) ? documentDetail(id) : null;
    if (!detail) res.sendStatus(404);
    else res.set("cache-control", "no-store").json(detail);
  });

  router.get("/api/admin/stats", signedIn, (_req, res) => {
    res.set("cache-control", "no-store").json(adminStats());
  });

  /*
   * Cleanup: look first, then delete. The preview counts and lists; the
   * delete finds the same documents again rather than trusting a list from
   * the browser, so it cannot be pointed at anything that is not empty or
   * abandoned — and anything opened in between is skipped.
   */
  router.get("/api/admin/cleanup", signedIn, (req, res) => {
    const days = abandonedDays(req.query.days);
    const olderThanHours = emptyAge();
    const result: CleanupPreview = {
      empty: { ...preview(findEmpty(olderThanHours)), olderThanHours },
      abandoned: { ...preview(findAbandoned(days)), days },
    };
    res.set("cache-control", "no-store").json(result);
  });

  router.post("/api/admin/cleanup", signedIn, express.json({ limit: "1kb" }), (req, res) => {
    const body = (req.body ?? {}) as { kind?: unknown; days?: unknown };
    let found;
    if (body.kind === "empty") found = findEmpty(emptyAge());
    else if (body.kind === "abandoned" && ABANDONED_CHOICES.includes(body.days as never)) {
      found = findAbandoned(body.days as number);
    }
    else {
      res.status(400).json({ error: "bad-cleanup" });
      return;
    }
    res.json({ deleted: deleteDocuments(found.map((row) => row.id)) });
  });

  return router;
}

/**
 * How old an empty document must be to count. The automatic setting when it
 * is on; an hour when it is not, which is long enough that nobody is still
 * on their way to typing into it.
 */
function emptyAge(): number {
  return limits().emptyDocumentHours || 1;
}

function abandonedDays(value: unknown): number {
  const days = Number(value);
  return (ABANDONED_CHOICES as readonly number[]).includes(days) ? days : ABANDONED_CHOICES[1];
}
