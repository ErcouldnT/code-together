import { createHmac, timingSafeEqual } from "node:crypto";
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { count } from "drizzle-orm";
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import rateLimit from "express-rate-limit";
import type { AdminOverview, LimitsUpdate } from "../shared/admin.js";
import { db } from "./db/index.js";
import { documents, expiredDocuments } from "./db/schema.js";
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
 * token is changed. With no token configured none of this exists: every
 * route below answers 404, exactly as an unknown path would.
 */

const COOKIE = "ct_admin";
const SESSION_S = 12 * 60 * 60;

function sign(token: string): string {
  return createHmac("sha256", token).update("admin-session").digest("base64url");
}

/** Constant-time, and blind to length: both sides are hashed first. */
function same(a: string, b: string): boolean {
  const x = createHmac("sha256", "compare").update(a).digest();
  const y = createHmac("sha256", "compare").update(b).digest();
  return timingSafeEqual(x, y);
}

function readCookie(header: string | undefined, name: string): string | null {
  for (const part of header?.split(";") ?? []) {
    const at = part.indexOf("=");
    if (at !== -1 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

export function isAdmin(req: Request): boolean {
  if (!env.adminToken) return false;
  const presented = readCookie(req.headers.cookie, COOKIE);
  return presented !== null && same(presented, sign(env.adminToken));
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
    res.cookie(COOKIE, sign(env.adminToken), {
      httpOnly: true,
      sameSite: "strict",
      secure: isProduction,
      path: "/api/admin",
      maxAge: SESSION_S * 1000,
    });
    res.sendStatus(204);
  });

  router.post("/api/admin/logout", (_req, res) => {
    res.clearCookie(COOKIE, { path: "/api/admin" });
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

  return router;
}
