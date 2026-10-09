import { randomUUID } from "node:crypto";
import { createWriteStream, mkdirSync, renameSync, rmSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { and, asc, eq } from "drizzle-orm";
import express, { type Request, type Router } from "express";
import { allowed } from "./access.js";
import { db } from "./db/index.js";
import { documentAttachments, documents } from "./db/schema.js";
import { env } from "./env.js";
import { ROOM_ID } from "./rooms.js";

/**
 * Files attached to a document: any type, up to `env.maxAttachmentBytes`.
 *
 * Unlike the picture store in uploads.ts this is not content-addressed. Each
 * attachment is its own file under a random id, so deleting one can unlink it
 * on the spot — nothing else can be pointing at the same bytes.
 *
 * Accepting any type is safe only because nothing here is ever served inline:
 * every download is `application/octet-stream` with `attachment` disposition,
 * `nosniff`, and a sandboxing CSP. Take any of those away and an uploaded HTML
 * file becomes stored XSS on this origin.
 */

const ATTACHMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface AttachmentInfo {
  id: string;
  name: string;
  size: number;
  addedBy: string | null;
  createdAt: number;
}

function attachmentsRoot(): string {
  return resolve(env.uploadDir, "attachments");
}

/**
 * Where an attachment lives, or null if either id is not one we could have
 * made. Both are checked against strict patterns, so the request never
 * contributes anything to the path that could climb out of it.
 */
export function attachmentPath(documentId: string, attachmentId: string): string | null {
  if (!ROOM_ID.test(documentId) || !ATTACHMENT_ID.test(attachmentId)) return null;
  return join(attachmentsRoot(), documentId, attachmentId);
}

/** A name fit to keep: no path, no control characters, not empty, not huge. */
export function cleanName(raw: unknown): string {
  const name = typeof raw === "string" ? raw : "";
  const cleaned = name
    .replace(/^.*[/\\]/, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 200);
  return cleaned || "file";
}

/**
 * The `Content-Disposition` for a download. The ASCII `filename` is the
 * fallback for old clients and has everything outside a safe set dropped — a
 * quote or newline there would be header injection. `filename*` carries the
 * real name, percent-encoded, so nothing in it can break out either.
 */
export function contentDisposition(name: string): string {
  const ascii = name.normalize("NFKD").replace(/[^\w.\- ]/g, "").trim() || "file";
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function listAttachments(documentId: string): AttachmentInfo[] {
  return db
    .select()
    .from(documentAttachments)
    .where(eq(documentAttachments.documentId, documentId))
    .orderBy(asc(documentAttachments.createdAt))
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      size: row.size,
      addedBy: row.addedBy,
      createdAt: row.createdAt.getTime(),
    }));
}

export function findAttachment(documentId: string, attachmentId: string): AttachmentInfo | null {
  return listAttachments(documentId).find((entry) => entry.id === attachmentId) ?? null;
}

class TooLarge extends Error {}

/**
 * Stream a request body to disk, never holding it in memory.
 *
 * Written beside the target and renamed into place, so a dropped connection or
 * a refusal half way through leaves no partial file behind at a real address.
 */
export async function saveAttachment(
  documentId: string,
  body: NodeJS.ReadableStream,
  meta: { name: string; addedBy: string | null },
): Promise<AttachmentInfo | { error: "too-large" | "no-document" }> {
  const exists = db.select({ id: documents.id }).from(documents).where(eq(documents.id, documentId)).get();
  if (!exists) return { error: "no-document" };

  const id = randomUUID();
  const target = attachmentPath(documentId, id);
  if (!target) return { error: "no-document" };
  mkdirSync(join(attachmentsRoot(), documentId), { recursive: true });
  const temporary = `${target}.part`;

  let size = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length;
      if (size > env.maxAttachmentBytes) done(new TooLarge());
      else done(null, chunk);
    },
  });

  try {
    await pipeline(body, counter, createWriteStream(temporary));
  }
  catch (error) {
    rmSync(temporary, { force: true });
    if (error instanceof TooLarge) return { error: "too-large" };
    throw error;
  }

  renameSync(temporary, target);
  try {
    const row = db
      .insert(documentAttachments)
      .values({ id, documentId, name: meta.name, size, addedBy: meta.addedBy })
      .returning()
      .get();
    return { id, name: row.name, size, addedBy: row.addedBy, createdAt: row.createdAt.getTime() };
  }
  catch (error) {
    // The document was deleted while the bytes were arriving.
    rmSync(target, { force: true });
    throw error;
  }
}

/** Remove one attachment, row and bytes, now. */
export function deleteAttachment(documentId: string, attachmentId: string): boolean {
  const path = attachmentPath(documentId, attachmentId);
  if (!path) return false;
  const removed = db
    .delete(documentAttachments)
    .where(and(eq(documentAttachments.documentId, documentId), eq(documentAttachments.id, attachmentId)))
    .run().changes;
  if (removed === 0) return false;
  try {
    unlinkSync(path);
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return true;
}

/** The bytes of every attachment a document had. The rows go by cascade. */
export function deleteAttachmentFiles(documentId: string): void {
  if (!ROOM_ID.test(documentId)) return;
  rmSync(join(attachmentsRoot(), documentId), { recursive: true, force: true });
}

/**
 * The HTTP side. `notify` tells everyone in the room the list changed; it is
 * passed in rather than imported so the routes can be mounted without a
 * socket server, which is how the tests drive them.
 */
export function attachmentRoutes(notify: (documentId: string) => void): Router {
  const router = express.Router();

  const documentId = (req: Request): string | null => {
    const id = req.params.id;
    return typeof id === "string" && ROOM_ID.test(id) ? id : null;
  };

  router.get("/api/documents/:id/attachments", (req, res) => {
    const id = documentId(req);
    if (!id) {
      res.status(400).json({ error: "bad-id" });
      return;
    }
    if (!allowed(req, res, id, "read")) return;
    res.json({ attachments: listAttachments(id), maxBytes: env.maxAttachmentBytes });
  });

  /**
   * The body is the raw file, streamed. The name travels in the query string
   * because there is no multipart form to carry it — and multipart would mean
   * a parser dependency and, for most of them, a trip through memory.
   */
  router.post("/api/documents/:id/attachments", async (req, res, next) => {
    const id = documentId(req);
    if (!id) {
      res.status(400).json({ error: "bad-id" });
      return;
    }
    if (!allowed(req, res, id, "write")) return;
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > env.maxAttachmentBytes) {
      res.set("connection", "close").status(413).json({ error: "too-large" });
      return;
    }
    try {
      const saved = await saveAttachment(id, req, {
        name: cleanName(req.query.name),
        addedBy: typeof req.query.by === "string" ? req.query.by.slice(0, 80) : null,
      });
      if ("error" in saved) {
        const status = saved.error === "too-large" ? 413 : 404;
        res.set("connection", "close").status(status).json(saved);
        return;
      }
      notify(id);
      res.status(201).json(saved);
    }
    catch (error) {
      next(error);
    }
  });

  router.get("/api/documents/:id/attachments/:attachmentId", (req, res) => {
    const id = documentId(req);
    if (id && !allowed(req, res, id, "read")) return;
    const attachment = id ? findAttachment(id, req.params.attachmentId) : null;
    const path = id && attachment ? attachmentPath(id, attachment.id) : null;
    if (!attachment || !path) {
      res.sendStatus(404);
      return;
    }
    res.sendFile(path, {
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": contentDisposition(attachment.name),
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "cache-control": "private, no-store",
      },
    }, (error) => {
      if (error && !res.headersSent) res.sendStatus(404);
    });
  });

  router.delete("/api/documents/:id/attachments/:attachmentId", (req, res) => {
    const id = documentId(req);
    if (id && !allowed(req, res, id, "write")) return;
    if (!id || !deleteAttachment(id, req.params.attachmentId)) {
      res.sendStatus(404);
      return;
    }
    notify(id);
    res.sendStatus(204);
  });

  return router;
}
