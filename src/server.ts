import { createServer } from "node:http";
import { resolve } from "node:path";
import { toNodeHandler } from "better-auth/node";
import express from "express";
import rateLimit from "express-rate-limit";
import { pinoHttp } from "pino-http";
import { accessRoutes, allowed } from "./access.js";
import { adminRoutes } from "./admin.js";
import { auth, clientIpHeader, ensureAdmin, resolveAdmin } from "./auth.js";
import { attachmentRoutes } from "./attachments.js";
import { closeDatabase, runMigrations } from "./db/index.js";
import { automaticCleanup } from "./cleanup.js";
import { contentsOf, referencedUploads, storedContents } from "./documents.js";
import { env, isProduction } from "./env.js";
import { expireDue, expiryRoutes, pruneTombstones } from "./expiry.js";
import { toHtmlDocument, toMarkdown } from "./export.js";
import { closeAllRooms, peekRoom, ROOM_ID, roomStats } from "./rooms.js";
import { limits } from "./settings.js";
import { listSnapshots, snapshotContents } from "./snapshots.js";
import { attachSockets, roomEvents } from "./sockets.js";
import { noteStored, storageRoom } from "./storage.js";
import { mimeForStoredName, pathForStoredName, storeUpload, sweepUploads } from "./uploads.js";

runMigrations();
await ensureAdmin();

const clientDist = resolve(import.meta.dirname, "../../client/dist");

const app = express();
app.disable("x-powered-by");
// Coolify runs us behind its Traefik proxy.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    // The health check runs every 30 s forever; logging it drowns everything
    // that matters. Static assets are the proxy's business, not ours.
    autoLogging: {
      ignore: (req: { url?: string }) =>
        req.url === "/healthz" || req.url?.startsWith("/assets/") === true,
    },
    level: isProduction ? "info" : "debug",
  }),
);

/**
 * Liveness, and enough to tell a quiet process from a stuck one.
 *
 * Everything here is read out of memory — a health check that queries the
 * database is a health check that reports the database's problems as its own,
 * and this one runs every thirty seconds forever.
 */
app.get("/healthz", (_req, res) => {
  const { heapUsed, rss } = process.memoryUsage();
  res.json({
    ok: true,
    uptime: process.uptime(),
    ...roomStats(),
    memory: { rss, heapUsed },
  });
});

// The document itself travels over the socket, so this only guards the HTML and
// the asset requests around it — enough to stop a crawler walking the room-id
// space and creating a database row per hit.
app.use(
  rateLimit({
    windowMs: 60_000,
    // read per request, so the admin screen changes it without a restart
    limit: () => limits().requestsPerMinute,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  }),
);

/**
 * Pictures pasted or dropped into a document.
 *
 * The body is the raw file, not a multipart form. Multipart exists to carry a
 * filename and a declared type alongside the bytes, and this endpoint uses
 * neither: the name is the content hash and the type is sniffed from the
 * bytes, precisely because a client's claim about either cannot be trusted.
 * Raw bodies also mean express enforces the size limit before the bytes are
 * buffered, and no parser dependency joins the tree.
 */
app.post(
  "/api/uploads",
  (req, res, next) => {
    // Refused before a byte is read when the disk budget is already spent.
    const declared = Number(req.headers["content-length"]) || 0;
    if (declared > storageRoom()) {
      res.set("connection", "close").status(507).json({ error: "quota" });
      return;
    }
    // A parser per request, because its size limit is fixed at creation and
    // this one can change from the admin screen.
    express.raw({ type: "*/*", limit: limits().maxUploadBytes })(req, res, next);
  },
  (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "empty" });
      return;
    }
    const stored = storeUpload(req.body);
    if ("error" in stored) {
      // Says what it is rather than what it is not: an SVG and a mislabelled
      // HTML file both land here, and both are refused for the same reason.
      res.status(415).json({ error: "not-an-image" });
      return;
    }
    noteStored("pictures", stored.bytes);
    res.json({ url: stored.url, bytes: stored.bytes });
  },
);

app.get("/uploads/:name", (req, res) => {
  const name = req.params.name;
  const path = pathForStoredName(name);
  const mime = path && mimeForStoredName(name);
  if (!path || !mime) {
    res.sendStatus(404);
    return;
  }
  res.sendFile(path, {
    headers: {
      "content-type": mime,
      // The type is ours, from the bytes — do not let a browser reconsider it.
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
      // Nothing in a picture should be able to reach anything.
      "content-security-policy": "default-src 'none'",
      // The name is the hash of the contents, so the contents cannot change.
      "cache-control": "public, max-age=31536000, immutable",
    },
  }, (error) => {
    if (error) res.sendStatus(404);
  });
});

// Signing in and out, and everything else Better Auth answers. Ahead of any
// body parser: the handler reads the body itself.
app.all("/api/auth/{*any}", clientIpHeader, toNodeHandler(auth));

// Whether this request is the admin's, once, for every API route below. Not
// for pages and assets: nothing there asks, and it would cost the admin a
// session lookup per file.
app.use("/api", resolveAdmin);

// Making a named document, and unlocking one with a password.
app.use(accessRoutes());

// The admin screen's API — absent unless ADMIN_EMAIL and ADMIN_PASSWORD are set.
app.use(adminRoutes());

// Documents that delete themselves. The events reach the socket server
// lazily, as the attachment notifications below do.
app.use(expiryRoutes({
  expired: (id) => roomEvents(io).expired(id),
  changed: (id, expiresAt) => roomEvents(io).changed(id, expiresAt),
}));

// Files attached to a document. Everyone in the room is told when the list
// changes, so a second tab never shows a file that is already gone.
app.use(attachmentRoutes((documentId) => io.to(documentId).emit("attachments-changed")));

/**
 * Take the document away as a file.
 *
 * PDF is deliberately not here: the print stylesheet already lays the document
 * out on paper, so the browser's own "save as PDF" does it with no renderer to
 * ship, no fonts to embed and nothing to keep working.
 */
app.get("/api/documents/:id/export", (req, res) => {
  const id = req.params.id;
  if (!ROOM_ID.test(id)) {
    res.status(400).json({ error: "bad-id" });
    return;
  }
  if (!allowed(req, res, id, "read")) return;

  const format = req.query.format === "md" ? "md" : "html";
  // The live copy when somebody has the room open, because the stored one is
  // up to a save interval behind and "my last sentence is missing" is a bug.
  const live = peekRoom(id);
  const contents = live ? contentsOf(id, live.doc) : storedContents(id);
  if (!contents) {
    res.sendStatus(404);
    return;
  }

  const body = format === "md"
    ? toMarkdown(contents.ops)
    : toHtmlDocument(contents.title, contents.ops);

  res.setHeader("content-type", format === "md" ? "text/markdown; charset=utf-8" : "text/html; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="${filename(contents.title, id, format)}"`);
  res.send(body);
});

app.get("/api/documents/:id/snapshots", (req, res) => {
  const id = req.params.id;
  if (!ROOM_ID.test(id)) {
    res.status(400).json({ error: "bad-id" });
    return;
  }
  if (!allowed(req, res, id, "read")) return;
  res.json({ snapshots: listSnapshots(id) });
});

app.get("/api/documents/:id/snapshots/:snapshotId", (req, res) => {
  const id = req.params.id;
  if (!ROOM_ID.test(id)) {
    res.status(400).json({ error: "bad-id" });
    return;
  }
  if (!allowed(req, res, id, "read")) return;
  const contents = snapshotContents(id, req.params.snapshotId);
  if (!contents) {
    res.sendStatus(404);
    return;
  }
  res.json(contents);
});

app.use(express.static(clientDist));

// Every other path is a document room; the SPA router resolves it.
app.use((_req, res) => {
  res.sendFile(resolve(clientDist, "index.html"));
});

const httpServer = createServer(app);
const io = attachSockets(httpServer);

/*
 * Expiry is checked twice a minute rather than hourly with the rest: "delete
 * in an hour" that happens at some point in the following hour is not what
 * anyone was promised. A document that comes due between sweeps is refused at
 * join anyway, so the gap is only ever about when the bytes leave the disk.
 */
const expirySweep = setInterval(() => {
  try {
    const expired = expireDue(roomEvents(io));
    if (expired > 0) console.log(`Expired ${expired} document(s).`);
  }
  catch (error) {
    console.error("Expiry sweep failed:", error);
  }
}, 30_000);
expirySweep.unref();

const cleanup = setInterval(() => {
  pruneTombstones();
  // Whatever the admin screen has switched on; DOCUMENT_TTL_DAYS still
  // switches on the abandoned half, as it did before there was a screen.
  const { empty, abandoned } = automaticCleanup(limits());
  if (empty + abandoned > 0) console.log(`Cleaned up ${empty} empty and ${abandoned} abandoned document(s).`);
  // Runs whether or not documents are pruned: a picture also becomes
  // unreferenced by being deleted out of a document that stays.
  try {
    const swept = sweepUploads(referencedUploads());
    if (swept > 0) console.log(`Removed ${swept} unreferenced upload(s).`);
  }
  catch (error) {
    // Deliberately does not fall back to sweeping with what it has: see
    // referencedUploads. Nothing is deleted this hour, and it tries again.
    console.error("Upload sweep skipped, nothing deleted:", error);
  }
}, 60 * 60 * 1000);
cleanup.unref();

httpServer.listen(env.port, () => {
  console.log(`Listening on port ${env.port} (${env.nodeEnv})`);
});

/**
 * A download name from a title people can type anything into.
 *
 * Everything outside a small safe set is dropped rather than escaped, because
 * this string ends up inside a quoted `Content-Disposition` header: a stray
 * quote or newline there is header injection, not a cosmetic problem.
 */
function filename(title: string, id: string, format: string): string {
  const stem = title
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${stem || id}.${format}`;
}

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down.`);

  clearInterval(cleanup);
  clearInterval(expirySweep);
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();

  void io.close(() => {
    httpServer.close(() => {
      // Rooms hold the only up-to-date copy of a document that changed within
      // the last save interval. Flushing before the database closes is the
      // difference between a clean redeploy and losing the last two seconds of
      // everyone's typing.
      closeAllRooms();
      closeDatabase();
      process.exit(0);
    });
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
