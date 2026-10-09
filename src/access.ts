import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import express, { type Request, type Response, type Router } from "express";
import rateLimit from "express-rate-limit";
import slugify from "slugify";
import * as Y from "yjs";
import {
  isExpiryChoice,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  slugOf,
  type AccessInfo,
  type CreateDocumentError,
  type Protection,
} from "../shared/access.js";
import type { LegacyDocumentData } from "../shared/events.js";
import { META_KEY } from "../shared/ydoc.js";
import { db } from "./db/index.js";
import { documents } from "./db/schema.js";
import { isProduction } from "./env.js";
import { clearTombstone, isTombstoned } from "./expiry.js";
import { ROOM_ID } from "./rooms.js";

/**
 * Passwords on documents, and what a browser that knows one is allowed to do.
 *
 * There are no accounts, so "knows the password" has to survive a reload
 * without the password itself being kept anywhere. Unlocking sets a cookie
 * whose value is an HMAC of the document id keyed by the stored password
 * hash: unforgeable without the hash, which never leaves the server, and void
 * the moment the password changes — no session table, no server secret to
 * configure and rotate.
 *
 * The cookie is what the socket handshake carries too, which is why it is a
 * cookie at all and not a header the client would have to remember to send.
 * A handshake's cookies are fixed for the life of the connection, so a tab
 * that unlocks has to reconnect before the socket sees it; the client reloads.
 */

const SCRYPT_KEYLEN = 32;
const COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = scryptSync(password, Buffer.from(salt, "base64url"), expected.length);
  return timingSafeEqual(actual, expected);
}

function cookieName(documentId: string): string {
  return `ct_${documentId}`;
}

function cookieValue(documentId: string, passwordHash: string): string {
  return createHmac("sha256", passwordHash).update(`access:${documentId}`).digest("base64url");
}

/** One cookie out of a raw `Cookie` header, without a parser dependency for it. */
function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at === -1) continue;
    if (part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

function unlocked(documentId: string, passwordHash: string, cookieHeader: string | undefined): boolean {
  const presented = readCookie(cookieHeader, cookieName(documentId));
  if (!presented) return false;
  const expected = Buffer.from(cookieValue(documentId, passwordHash));
  const actual = Buffer.from(presented);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * What the holder of this `Cookie` header may do to a document.
 *
 * A document that does not exist yet is open: visiting an address is still
 * how a public room gets made, exactly as before passwords existed.
 */
export function accessFor(documentId: string, cookieHeader: string | undefined): AccessInfo {
  const row = db
    .select({ passwordHash: documents.passwordHash, protect: documents.protect, expiresAt: documents.expiresAt })
    .from(documents)
    .where(eq(documents.id, documentId))
    .get();
  const expiresAt = row?.expiresAt?.getTime() ?? null;
  // Gone, or due to go and waiting only for the sweep: either way there is
  // nothing to open, and saying so beats an empty page that fills back up.
  if ((!row && isTombstoned(documentId)) || (expiresAt !== null && expiresAt <= Date.now())) {
    return { protect: null, read: false, write: false, expiresAt: null, expired: true };
  }
  if (!row?.passwordHash || !row.protect) return { protect: null, read: true, write: true, expiresAt };

  const known = unlocked(documentId, row.passwordHash, cookieHeader);
  return {
    protect: row.protect,
    read: row.protect === "edit" || known,
    write: known,
    expiresAt,
  };
}

function setAccessCookie(res: Response, documentId: string, passwordHash: string): void {
  res.cookie(cookieName(documentId), cookieValue(documentId, passwordHash), {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
    maxAge: COOKIE_MAX_AGE_S * 1000,
  });
}

/**
 * Guard for a route about one document: answers the request itself and
 * returns false when this browser may not do `level` to it. Called first thing
 * in a handler rather than mounted as middleware, because a middleware in the
 * chain costs every handler after it Express's typing of its route params.
 *
 * A locked document answers 404 rather than 403 to a reader without the
 * password, so the routes say nothing about what is behind it; the access
 * endpoint is the one place that admits a password exists.
 */
export function allowed(req: Request, res: Response, documentId: string, level: "read" | "write"): boolean {
  const access = accessFor(documentId, req.headers.cookie);
  if (!access.read) {
    res.sendStatus(404);
    return false;
  }
  if (level === "write" && !access.write) {
    // A refused upload's body is still on its way; closing is cheaper than
    // reading a gigabyte only to throw it away.
    res.set("connection", "close").status(403).json({ error: "read-only" });
    return false;
  }
  return true;
}

function isProtection(value: unknown): value is Protection {
  return value === "view" || value === "edit";
}

/**
 * A new, named document, with its title already set to the name it was made
 * from — written straight into the Yjs state, so the title box shows it on
 * the first sync like any title somebody typed.
 */
function createDocument(
  name: string,
  password: string,
  protect: Protection,
  expiresIn: number | null,
): { id: string; passwordHash: string | null } | { error: CreateDocumentError } {
  const id = slugOf(name, slugify);
  if (!id || !ROOM_ID.test(id)) return { error: "bad-name" };
  if (password && (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH)) {
    return { error: "bad-password" };
  }
  if (expiresIn !== null && !isExpiryChoice(expiresIn)) return { error: "bad-expiry" };

  const doc = new Y.Doc();
  doc.getMap(META_KEY).set("title", name.trim().slice(0, 120));
  const ystate = Buffer.from(Y.encodeStateAsUpdate(doc));
  doc.destroy();

  const passwordHash = password ? hashPassword(password) : null;
  const inserted = db
    .insert(documents)
    .values({
      id,
      ystate,
      data: { ops: [] } satisfies LegacyDocumentData,
      title: name.trim().slice(0, 200),
      passwordHash,
      protect: password ? protect : null,
      expiresAt: expiresIn === null ? null : new Date(Date.now() + expiresIn),
    })
    .onConflictDoNothing({ target: documents.id })
    .run();
  if (inserted.changes === 0) return { error: "taken" };
  // Making a document at an address that once expired is asking for it back,
  // on purpose and new; the refusal that protected the old one is lifted.
  clearTombstone(id);
  return { id, passwordHash };
}

export function accessRoutes(): Router {
  const router = express.Router();

  // Every guess at a password goes through here, so it gets a budget of its
  // own far below the app-wide one. Per address, per minute.
  const guesses = rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  });

  // Not a guess, but every one is a row that never goes away on its own.
  const creations = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  });

  router.post("/api/documents", creations, express.json({ limit: "4kb" }), (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name : "";
    const password = typeof body.password === "string" ? body.password : "";
    const protect = isProtection(body.protect) ? body.protect : "view";
    const expiresIn = body.expiresIn === undefined || body.expiresIn === null ? null : Number(body.expiresIn);

    const created = createDocument(name, password, protect, expiresIn);
    if ("error" in created) {
      res.status(created.error === "taken" ? 409 : 400).json(created);
      return;
    }
    // The person who set the password should not be asked for it a second
    // later on the page they are sent to.
    if (created.passwordHash) setAccessCookie(res, created.id, created.passwordHash);
    res.status(201).json({ id: created.id });
  });

  router.get("/api/documents/:id/access", (req, res) => {
    const id = req.params.id;
    if (!ROOM_ID.test(id)) {
      res.status(400).json({ error: "bad-id" });
      return;
    }
    res.set("cache-control", "no-store").json(accessFor(id, req.headers.cookie));
  });

  router.post("/api/documents/:id/unlock", guesses, express.json({ limit: "4kb" }), (req, res) => {
    const id = req.params.id;
    if (typeof id !== "string" || !ROOM_ID.test(id)) {
      res.status(400).json({ error: "bad-id" });
      return;
    }
    const password = (req.body as { password?: unknown } | undefined)?.password;
    const row = db
      .select({ passwordHash: documents.passwordHash })
      .from(documents)
      .where(eq(documents.id, id))
      .get();
    if (!row?.passwordHash || typeof password !== "string" || !verifyPassword(password, row.passwordHash)) {
      res.status(403).json({ error: "wrong-password" });
      return;
    }
    setAccessCookie(res, id, row.passwordHash);
    res.sendStatus(204);
  });

  return router;
}
