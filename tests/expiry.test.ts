import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join as joinPath } from "node:path";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { io as connectSocket, type Socket } from "socket.io-client";
import * as Y from "yjs";
import { EXPIRY_CHOICES, type AccessInfo } from "../shared/access.js";
import type { ClientToServerEvents, ServerToClientEvents } from "../shared/events.js";
import { TEXT_KEY } from "../shared/ydoc.js";
import { SocketProvider } from "../client/src/yjs/socketProvider.ts";
import { cleanupDatabase, settle, useTemporaryDatabase } from "./helpers.ts";

/**
 * Documents that delete themselves, end to end: set over HTTP, announced to
 * the room, swept, refused afterwards — including to a browser that still
 * holds a copy and would otherwise upload it straight back.
 */
describe("document expiry", () => {
  let server: Server;
  let base: string;
  let closeAll: () => void;
  let expiry: typeof import("../src/expiry.js");
  let events: import("../src/expiry.js").ExpiryEvents;
  let db: typeof import("../src/db/index.js");
  const sockets: Socket[] = [];
  const providers: SocketProvider[] = [];

  before(async () => {
    const dir = useTemporaryDatabase();
    process.env.UPLOAD_DIR = joinPath(dir, "..", "uploads");
    db = await import("../src/db/index.js");
    db.runMigrations();
    const { accessRoutes } = await import("../src/access.js");
    const { attachSockets, roomEvents } = await import("../src/sockets.js");
    expiry = await import("../src/expiry.js");
    closeAll = (await import("../src/rooms.js")).closeAllRooms;
    const express = (await import("express")).default;

    const app = express();
    app.use(accessRoutes());
    server = createServer(app);
    const io = attachSockets(server);
    events = roomEvents(io);
    app.use(expiry.expiryRoutes(events));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    for (const provider of providers) provider.destroy();
    for (const socket of sockets) socket.disconnect();
    closeAll();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    cleanupDatabase();
  });

  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  const access = async (id: string) =>
    (await (await fetch(`${base}/api/documents/${id}/access`)).json()) as AccessInfo;

  /** Push a document's expiry into the past, as time would. */
  function overdue(id: string): void {
    db.db.update(db.schema.documents).set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(db.schema.documents.id, id)).run();
  }

  function join(id: string, doc?: Y.Doc) {
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = connectSocket(base, {
      transports: ["websocket"],
      forceNew: true,
    });
    sockets.push(socket);
    const problems: string[] = [];
    const expiries: (number | null)[] = [];
    socket.on("expiry-changed", (value) => expiries.push(value));
    let provider!: SocketProvider;
    const synced = new Promise<void>((resolve) => {
      provider = new SocketProvider(socket, id, {
        onStatus: (status) => {
          if (status === "synced") resolve();
        },
        onJoinError: (reason) => {
          problems.push(reason);
          resolve();
        },
      });
      providers.push(provider);
      // a browser's local copy, merged in before the handshake answers
      if (doc) Y.applyUpdate(provider.doc, Y.encodeStateAsUpdate(doc));
    });
    return { provider, problems, expiries, synced };
  }

  it("makes a named document with an expiry, and refuses one not on the list", async () => {
    const before = Date.now();
    const made = await post("/api/documents", { name: "Kısa ömürlü", expiresIn: EXPIRY_CHOICES[0] });
    assert.equal(made.status, 201);
    const info = await access("kisa-omurlu");
    assert.ok(info.expiresAt !== null);
    assert.ok(info.expiresAt >= before + EXPIRY_CHOICES[0] && info.expiresAt <= Date.now() + EXPIRY_CHOICES[0]);

    const odd = await post("/api/documents", { name: "Garip", expiresIn: 1000 });
    assert.equal(odd.status, 400);
    assert.deepEqual(await odd.json(), { error: "bad-expiry" });
  });

  it("sets, tells the room, and clears an expiry", async () => {
    await post("/api/documents", { name: "Toplantı" });
    const member = join("toplanti");
    await member.synced;

    const set = await post("/api/documents/toplanti/expiry", { expiresIn: EXPIRY_CHOICES[1] });
    assert.equal(set.status, 200);
    const { expiresAt } = (await set.json()) as { expiresAt: number };
    await settle();
    assert.deepEqual(member.expiries, [expiresAt]);
    assert.equal((await access("toplanti")).expiresAt, expiresAt);

    const cleared = await post("/api/documents/toplanti/expiry", { expiresIn: null });
    assert.deepEqual(await cleared.json(), { expiresAt: null });
    await settle();
    assert.deepEqual(member.expiries, [expiresAt, null]);

    assert.equal((await post("/api/documents/toplanti/expiry", { expiresIn: 5 })).status, 400);
  });

  it("does not let a reader of an edit-protected document set one", async () => {
    await post("/api/documents", { name: "Kilitli", password: "hunter22", protect: "edit" });
    const response = await post("/api/documents/kilitli/expiry", { expiresIn: EXPIRY_CHOICES[0] });
    assert.equal(response.status, 403);
  });

  it("deletes an expired document, closes its room, and keeps it deleted", async () => {
    await post("/api/documents", { name: "Geçici", expiresIn: EXPIRY_CHOICES[0] });
    const member = join("gecici");
    await member.synced;
    member.provider.doc.getText(TEXT_KEY).insert(0, "soon gone");
    await settle(2500);

    const attachments = joinPath(process.env.UPLOAD_DIR!, "attachments", "gecici");
    mkdirSync(attachments, { recursive: true });
    writeFileSync(joinPath(attachments, "file"), "x");

    // what this browser knew, to try and bring the document back with
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(member.provider.doc));

    overdue("gecici");
    assert.equal(expiry.expireDue(events), 1);
    await settle();
    assert.deepEqual(member.problems, ["expired"]);
    assert.equal(existsSync(attachments), false);
    assert.deepEqual(await access("gecici"), { protect: null, read: false, write: false, expiresAt: null, expired: true });

    const returning = join("gecici", copy);
    await returning.synced;
    assert.deepEqual(returning.problems, ["expired"]);
    await settle();
    const row = db.db.select().from(db.schema.documents).all().find((entry) => entry.id === "gecici");
    assert.equal(row, undefined, "a returning copy must not recreate the document");
  });

  it("refuses an overdue document at join even before the sweep has run", async () => {
    await post("/api/documents", { name: "Gecikmiş", expiresIn: EXPIRY_CHOICES[0] });
    overdue("gecikmis");
    const late = join("gecikmis");
    await late.synced;
    assert.deepEqual(late.problems, ["expired"]);
    assert.equal(expiry.isTombstoned("gecikmis"), true);
  });

  it("frees an expired address for a named document made there on purpose", async () => {
    await post("/api/documents", { name: "Tekrar", expiresIn: EXPIRY_CHOICES[0] });
    overdue("tekrar");
    expiry.expireDue(events);
    assert.equal((await access("tekrar")).expired, true);

    const again = await post("/api/documents", { name: "Tekrar" });
    assert.equal(again.status, 201);
    assert.deepEqual(await access("tekrar"), { protect: null, read: true, write: true, expiresAt: null });
  });

  it("lets tombstones go after a month", () => {
    assert.ok(expiry.isTombstoned("gecici"));
    expiry.pruneTombstones(Date.now() + 31 * 24 * 60 * 60 * 1000);
    assert.equal(expiry.isTombstoned("gecici"), false);
  });
});
