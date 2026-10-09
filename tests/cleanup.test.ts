import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join as joinPath } from "node:path";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import * as Y from "yjs";
import type { CleanupPreview } from "../shared/admin.js";
import { META_KEY, TEXT_KEY } from "../shared/ydoc.js";
import {
  cleanupDatabase,
  connectClient,
  mountAuth,
  sessionCookieOf,
  signIn,
  useAdmin,
  useTemporaryDatabase,
  type TestClient,
} from "./helpers.ts";

/**
 * Finding and deleting empty and abandoned documents — and, as much as
 * anything, not deleting the ones that only look like it.
 */
describe("cleanup", () => {
  let server: Server;
  let base: string;
  let cookie = "";
  let closeAll: () => void;
  let io: import("../src/sockets.js").IoServer;
  let cleanup: typeof import("../src/cleanup.js");
  let db: typeof import("../src/db/index.js");
  const open: TestClient[] = [];

  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  /** A row as the app would have written it, with contents and ages of our choosing. */
  function make(
    id: string,
    options: { text?: string; title?: string; ageMs?: number; idleMs?: number; password?: boolean } = {},
  ): void {
    const { text = "", title = "", ageMs = 2 * HOUR, password = false } = options;
    const idleMs = options.idleMs ?? ageMs;
    const doc = new Y.Doc();
    if (text) doc.getText(TEXT_KEY).insert(0, text);
    if (title) doc.getMap(META_KEY).set("title", title);
    const now = Date.now();
    db.db.insert(db.schema.documents).values({
      id,
      data: { ops: [] },
      ystate: Buffer.from(Y.encodeStateAsUpdate(doc)),
      title: title || null,
      passwordHash: password ? "scrypt$x$y" : null,
      protect: password ? "view" : null,
      createdAt: new Date(now - ageMs),
      updatedAt: new Date(now - idleMs),
    }).run();
    doc.destroy();
  }

  const exists = (id: string) =>
    db.db.select().from(db.schema.documents).where(eq(db.schema.documents.id, id)).get() !== undefined;

  before(async () => {
    const dir = useTemporaryDatabase();
    process.env.UPLOAD_DIR = joinPath(dir, "..", "uploads-cleanup");
    useAdmin();
    db = await import("../src/db/index.js");
    db.runMigrations();
    cleanup = await import("../src/cleanup.js");
    const { adminRoutes } = await import("../src/admin.js");
    const { attachSockets } = await import("../src/sockets.js");
    closeAll = (await import("../src/rooms.js")).closeAllRooms;
    const express = (await import("express")).default;

    const app = express();
    await mountAuth(app);
    app.use(adminRoutes());
    server = createServer(app);
    io = attachSockets(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;

    cookie = sessionCookieOf(await signIn(base));

    make("blank");
    make("blank-new", { ageMs: 5 * 60 * 1000 });
    make("whitespace", { text: "   \n\n " });
    make("has-text", { text: "hello" });
    make("has-title", { title: "Notes" });
    make("has-password", { password: true });
    make("has-file");
    db.db.insert(db.schema.documentAttachments).values({ id: crypto.randomUUID(), documentId: "has-file", name: "a", size: 1 }).run();
    make("old", { text: "kept for a while", ageMs: 200 * DAY, idleMs: 100 * DAY });
    make("older", { text: "older still", ageMs: 400 * DAY, idleMs: 370 * DAY });
    make("open-blank");
    make("open-old", { text: "someone is in here", ageMs: 200 * DAY, idleMs: 100 * DAY });

    // in the room at the moment, which must protect them from both kinds
    open.push(await connectClient(base, "open-blank"), await connectClient(base, "open-old"));
  });

  after(async () => {
    for (const client of open) client.destroy();
    // Keep-alive connections from fetch would hold the HTTP server open, and
    // the upgraded websockets are not the HTTP server's to close — the socket
    // server's own close takes those and the HTTP server down together.
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      void io.close(() => resolve());
    });
    closeAll();
    cleanupDatabase();
  });

  it("calls a document empty only with no text, title, file or password, and not just made", () => {
    const ids = cleanup.findEmpty(1).map((row) => row.id).sort();
    assert.deepEqual(ids, ["blank", "whitespace"]);
  });

  it("finds documents untouched for long enough, oldest first, but not open ones", () => {
    assert.deepEqual(cleanup.findAbandoned(90).map((row) => row.id), ["older", "old"]);
    assert.deepEqual(cleanup.findAbandoned(365).map((row) => row.id), ["older"]);
  });

  it("previews and deletes over the admin API", async () => {
    const preview = (await (await fetch(`${base}/api/admin/cleanup?days=365`, { headers: { cookie } })).json()) as CleanupPreview;
    assert.equal(preview.empty.count, 2);
    assert.equal(preview.abandoned.count, 1);
    assert.equal(preview.abandoned.days, 365);
    assert.equal(preview.abandoned.sample[0]?.id, "older");

    const post = (body: unknown) =>
      fetch(`${base}/api/admin/cleanup`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body),
      });
    assert.equal((await post({ kind: "abandoned", days: 3 })).status, 400, "only the offered ages");
    assert.equal((await fetch(`${base}/api/admin/cleanup`, { method: "POST" })).status, 401);

    assert.deepEqual(await (await post({ kind: "empty" })).json(), { deleted: 2 });
    assert.deepEqual(await (await post({ kind: "abandoned", days: 90 })).json(), { deleted: 2 });

    for (const id of ["blank", "whitespace", "old", "older"]) assert.equal(exists(id), false, id);
    for (const id of ["blank-new", "has-text", "has-title", "has-password", "has-file", "open-blank", "open-old"]) {
      assert.equal(exists(id), true, id);
    }
  });

  it("runs only what is switched on, automatically", () => {
    make("auto-blank");
    make("auto-old", { text: "x", ageMs: 50 * DAY, idleMs: 40 * DAY });
    assert.deepEqual(cleanup.automaticCleanup({ emptyDocumentHours: 0, abandonedDocumentDays: 0 }), { empty: 0, abandoned: 0 });
    assert.deepEqual(cleanup.automaticCleanup({ emptyDocumentHours: 1, abandonedDocumentDays: 30 }), { empty: 1, abandoned: 1 });
  });
});
