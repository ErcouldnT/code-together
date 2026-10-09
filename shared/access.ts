/**
 * Who may open a document and who may change it — the HTTP half of the wire
 * contract, next to `events.ts` for the socket half.
 *
 * Runtime code, unlike `events.ts`, but no imports: the client is built in a
 * Docker stage that has only `client/node_modules`, so anything this file
 * pulled in would resolve on a laptop and fail in the image. `slugify` is
 * therefore handed in by whichever side is calling.
 */

/**
 * What a password guards.
 *
 *  - "view": nobody without it sees anything, the address included;
 *  - "edit": everyone can read, only the password holder can write.
 *
 * A document with no password has neither and is what every document was
 * before this existed: whoever has the address reads and writes.
 */
export type Protection = "view" | "edit";

/** `GET /api/documents/:id/access` */
export interface AccessInfo {
  protect: Protection | null;
  read: boolean;
  write: boolean;
  /** epoch ms when the document deletes itself, or null if it does not */
  expiresAt: number | null;
  /** the document at this address expired and was deleted */
  expired?: boolean;
}

/**
 * How long a document may be set to live, in ms. A short fixed list rather
 * than any number: it is what the menus offer, and the server refusing
 * anything else means a hand-made request cannot set a document to vanish in
 * a second, or in a century.
 */
export const EXPIRY_CHOICES = [
  60 * 60 * 1000,
  24 * 60 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000,
  30 * 24 * 60 * 60 * 1000,
] as const;

export function isExpiryChoice(value: unknown): value is (typeof EXPIRY_CHOICES)[number] {
  return typeof value === "number" && (EXPIRY_CHOICES as readonly number[]).includes(value);
}

/** `POST /api/documents/:id/expiry` — null keeps the document until deleted. */
export interface SetExpiryRequest {
  expiresIn: number | null;
}

/** `POST /api/documents` */
export interface CreateDocumentRequest {
  name: string;
  /** empty or missing for a public document */
  password?: string;
  /** ignored without a password */
  protect?: Protection;
  /** one of `EXPIRY_CHOICES`, or missing to keep the document */
  expiresIn?: number;
}

export type CreateDocumentError = "bad-name" | "taken" | "bad-password" | "bad-expiry";

export const MIN_PASSWORD_LENGTH = 4;
export const MAX_PASSWORD_LENGTH = 200;

/**
 * Names the server already answers at the top level. A document called
 * `healthz` would be shadowed by the health check and never open, and one
 * called `admin` by the admin screen.
 */
const RESERVED = new Set(["admin", "api", "assets", "healthz", "socket.io", "uploads"]);

type Slugify = (
  input: string,
  options: { lower: boolean; strict: boolean; locale: string; trim: boolean },
) => string;

/**
 * The address a name becomes: "Toplantı Notları" → `toplanti-notlari`.
 *
 * Turkish locale so ı and İ fold to i rather than vanishing, strict so the
 * result always fits the server's room-id pattern, and cut to that pattern's
 * 64 characters without leaving a dash dangling at the end. Empty when nothing
 * usable is left, which the caller treats as "pick another name".
 */
export function slugOf(name: string, slugify: Slugify): string {
  const slug = slugify(name, { lower: true, strict: true, locale: "tr", trim: true })
    .slice(0, 64)
    .replace(/-+$/, "");
  return RESERVED.has(slug) ? "" : slug;
}
