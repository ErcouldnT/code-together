import { statSync } from "node:fs";
import { resolve } from "node:path";
import { count } from "drizzle-orm";
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import rateLimit from "express-rate-limit";
import { ABANDONED_CHOICES, DIRECTORY_SORTS, type AdminOverview, type CleanupPreview, type LimitsUpdate } from "../shared/admin.js";
import { ADMIN_COOKIE, adminSignature, isAdminCookie, same } from "./admin-session.js";
import { deleteDocuments, findAbandoned, findEmpty, preview } from "./cleanup.js";
import { db } from "./db/index.js";
import { documents, expiredDocuments } from "./db/schema.js";
import { listDocuments } from "./directory.js";
import { env, isProduction } from "./env.js";
import { countExpiring } from "./expiry.js";
import { roomStats } from "./rooms.js";
import { defaultLimits, limits, updateLimits } from "./settings.js";
import { storageUsage } from "./storage.js";

/**
 * The admin screen's routes, behind `ADMIN_TOKEN`.
 *
 * Signing in sets an HttpOnly cookie holding an HMAC of a fixed label keyed
 * by the token — the same trick as document passwords: nothing to store,
 * nothing to forge without the token, and every session ends the moment the
 * token is changed. The same cookie opens every document, password or not
 * (see admin-session.ts). With no token configured none of this exists: every
 * route below answers 404, exactly as an unknown path would.
 */

const SESSION_S = 12 * 60 * 60;

export function isAdmin(req: Request): boolean {
  return isAdminCookie(req.headers.cookie);
}

/** The whole admin surface vanishes without a token. */
function enabled(_req: Request, res: Response, next: NextFunction): void {
  if (!env.adminToken) res.sendStatus(404);
  else next();
}

function signedIn(req: Request, res: Response, next: NextFunction): void {
  if (!isAdmin(req)) res.status(401).json({ error: "not-signed-in" });
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

  // Ten guesses a minute per address, whatever the limits are set to: this
  // one is not on the admin screen, because the admin screen is behind it.
  const guesses = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false });

  router.post("/api/admin/login", guesses, express.json({ limit: "1kb" }), (req, res) => {
    const token = (req.body as { token?: unknown } | undefined)?.token;
    if (typeof token !== "string" || !same(token, env.adminToken)) {
      res.status(403).json({ error: "wrong-token" });
      return;
    }
    // The old cookie, scoped to the admin API alone, would sit beside the new
    // one and outlive a sign-out.
    res.clearCookie(ADMIN_COOKIE, { path: "/api/admin" });
    // Lax rather than strict: a document opened from the admin screen in a new
    // tab is a top-level navigation, and strict would leave the cookie behind.
    res.cookie(ADMIN_COOKIE, adminSignature(env.adminToken), {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
      path: "/",
      maxAge: SESSION_S * 1000,
    });
    res.sendStatus(204);
  });

  router.post("/api/admin/logout", (_req, res) => {
    res.clearCookie(ADMIN_COOKIE, { path: "/" });
    res.clearCookie(ADMIN_COOKIE, { path: "/api/admin" });
    res.sendStatus(204);
  });

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
    const { q, sort, open, offset } = req.query;
    res.set("cache-control", "no-store").json(listDocuments({
      query: typeof q === "string" ? q.slice(0, 200) : "",
      sort: DIRECTORY_SORTS.find((choice) => choice === sort) ?? "updated",
      openOnly: open === "1",
      offset: Number(offset) || 0,
    }));
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
