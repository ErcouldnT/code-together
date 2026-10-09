import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env.js";

/**
 * The admin's signed-in cookie, on its own so the access checks can ask
 * "is this the admin?" without importing the whole admin screen.
 *
 * The cookie is an HMAC of a fixed label keyed by `ADMIN_TOKEN`: nothing to
 * store, nothing to forge without the token, and every session ends the
 * moment the token changes. It is sent with every request to the site, not
 * only the admin API, because the admin opens every document — password or
 * not — and the socket handshake is where that is decided.
 */

export const ADMIN_COOKIE = "ct_admin";

export function adminSignature(token: string): string {
  return createHmac("sha256", token).update("admin-session").digest("base64url");
}

/** Constant-time, and blind to length: both sides are hashed first. */
export function same(a: string, b: string): boolean {
  const x = createHmac("sha256", "compare").update(a).digest();
  const y = createHmac("sha256", "compare").update(b).digest();
  return timingSafeEqual(x, y);
}

export function readCookie(header: string | undefined, name: string): string | null {
  for (const part of header?.split(";") ?? []) {
    const at = part.indexOf("=");
    if (at !== -1 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

export function isAdminCookie(cookieHeader: string | undefined): boolean {
  if (!env.adminToken) return false;
  const presented = readCookie(cookieHeader, ADMIN_COOKIE);
  return presented !== null && same(presented, adminSignature(env.adminToken));
}
