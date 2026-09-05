import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { env } from "./env.js";

/**
 * A content-addressed store for pictures pasted or dropped into a document.
 *
 * The point of it is what does *not* end up in the document. Quill's own image
 * handling embeds the picture as `data:image/png;base64,…` inside the text, so
 * an 8 MB photo becomes ~10.7 MB of characters that are then carried in every
 * Yjs update to every person in the room, and written to SQLite on every save.
 * Here the document holds a thirty-byte address instead.
 */

interface Signature {
  ext: string;
  mime: string;
  matches: (bytes: Buffer) => boolean;
}

const ascii = (bytes: Buffer, from: number, to: number): string =>
  bytes.subarray(from, to).toString("latin1");

/**
 * Types are decided by the bytes, never by the request's `Content-Type`.
 *
 * These files are later served from the same origin as the app, so a document
 * that says it is a PNG and is actually HTML would be stored XSS. There is no
 * SVG entry and there will not be one: SVG runs script, and the only way to
 * accept it safely is to sanitise it, which is a larger promise than this
 * feature needs to make.
 */
const SIGNATURES: Signature[] = [
  {
    ext: "png",
    mime: "image/png",
    matches: (b) => b.length > 8 && ascii(b, 0, 8) === "\x89PNG\r\n\x1a\n",
  },
  {
    ext: "jpg",
    mime: "image/jpeg",
    matches: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    ext: "gif",
    mime: "image/gif",
    matches: (b) => b.length > 6 && ascii(b, 0, 4) === "GIF8",
  },
  {
    ext: "webp",
    mime: "image/webp",
    matches: (b) => b.length > 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP",
  },
  {
    ext: "avif",
    mime: "image/avif",
    matches: (b) =>
      b.length > 12 && ascii(b, 4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(b, 8, 12)),
  },
];

export function sniff(bytes: Buffer): Signature | null {
  return SIGNATURES.find((signature) => signature.matches(bytes)) ?? null;
}

/** `<64 hex>.<ext>` and nothing else — the only shape a served name may take. */
const STORED_NAME = new RegExp(`^[0-9a-f]{64}\\.(?:${SIGNATURES.map((s) => s.ext).join("|")})$`);

function uploadRoot(): string {
  const root = resolve(env.uploadDir);
  mkdirSync(root, { recursive: true });
  return root;
}

/**
 * Where a stored name lives on disk, or null if the name is not one of ours.
 *
 * The two-character fan-out is derived here rather than carried in the URL, so
 * the request never contributes a path segment. A name that does not match
 * `STORED_NAME` gets no path at all, which is why `..%2f` and friends have
 * nowhere to go.
 */
export function pathForStoredName(name: string): string | null {
  if (!STORED_NAME.test(name)) return null;
  return join(uploadRoot(), name.slice(0, 2), name);
}

export function mimeForStoredName(name: string): string | null {
  const ext = name.split(".").pop();
  return SIGNATURES.find((signature) => signature.ext === ext)?.mime ?? null;
}

export type StoreResult = { name: string; url: string; bytes: number } | { error: "not-an-image" };

/**
 * Write the bytes under their own sha256, and hand back the address.
 *
 * The same picture stored twice is one file and one address. The cost of that
 * is that a file can never be deleted by looking at one document — which is
 * what `sweepUploads` is for.
 */
export function storeUpload(bytes: Buffer): StoreResult {
  const signature = sniff(bytes);
  if (!signature) return { error: "not-an-image" };

  const hash = createHash("sha256").update(bytes).digest("hex");
  const name = `${hash}.${signature.ext}`;
  const target = join(uploadRoot(), hash.slice(0, 2), name);

  if (!existsSync(target)) {
    mkdirSync(join(uploadRoot(), hash.slice(0, 2)), { recursive: true });
    // Written beside the target and moved into place, so a crash mid-write
    // cannot leave a truncated file sitting at an address that, being a hash,
    // everyone will happily believe is complete.
    const temporary = `${target}.${process.pid}.part`;
    writeFileSync(temporary, bytes);
    renameSync(temporary, target);
  }

  return { name, url: `/uploads/${name}`, bytes: bytes.length };
}

/** The stored name inside one of our addresses, or null if it is not one. */
export function storedNameIn(url: string): string | null {
  const match = /^\/uploads\/([0-9a-f]{64}\.[a-z]+)$/.exec(url);
  const name = match?.[1];
  return name && STORED_NAME.test(name) ? name : null;
}

/**
 * Delete pictures no document mentions.
 *
 * Reference counting was the alternative and it is worse: in a CRDT, knowing
 * "nobody has this image any more" at the moment of deletion means following
 * every peer's every delete, and one missed event either strands a file
 * forever or removes one that is still on screen.
 *
 * The grace period is not politeness. A file is uploaded seconds before it is
 * referenced, and the document that will reference it may not have been saved
 * yet — without the delay this would delete pictures out from under the person
 * who just added them.
 */
export function sweepUploads(referenced: Set<string>, graceMs = 24 * 60 * 60 * 1000): number {
  const root = uploadRoot();
  const cutoff = Date.now() - graceMs;
  let removed = 0;

  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const path = join(root, dir.name);
    for (const entry of readdirSync(path)) {
      if (referenced.has(entry)) continue;
      const file = join(path, entry);
      if (statSync(file).mtimeMs > cutoff) continue;
      unlinkSync(file);
      removed += 1;
    }
  }
  return removed;
}
