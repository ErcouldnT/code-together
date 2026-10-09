import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join as joinPath } from "node:path";
import { after, before, describe, it } from "node:test";
import type { DirectoryPage } from "../shared/admin.js";
import { adminCookieOf, cleanupDatabase, connectClient, useTemporaryDatabase, type TestClient } from "./helpers.ts";

/**
 * The admin screen's list of every document: searching, sorting, paging,
 * and saying who is in which one.
 */
describe("document directory", () => {
  let server: Server;
  let base: string;
  let cookie = "";
  let closeAll: () => void;
  let io: import("../src/sockets.js").IoServer;
  const open: TestClient[] = [];

  before(async () => {
    const dir = useTemporaryDatabase();
    process.env.UPLOAD_DIR = joinPath(dir, "..", "uploads-directory");
    process.env.ADMIN_TOKEN = "list";
    const db = await import("../src/db/index.js");
    db.runMigrations();
    const { adminRoutes } = await import("../src/admin.js");
    const { attachSockets } = await import("../src/sockets.js");
    closeAll = (await import("../src/rooms.js")).closeAllRooms;
    const express = (await import("express")).default;

    const now = Date.now();
    const rows = [
      { id: "alpha", title: "Meeting notes", age: 3, bytes: 10 },
      { id: "beta", title: "100% done_ish", age: 2, bytes: 500 },
      { id: "gamma", title: null, age: 1, bytes: 50 },
    ];
    for (const row of rows) {
      db.db.insert(db.schema.documents).values({
        id: row.id,
        data: { ops: [] },
        ystate: Buffer.alloc(row.bytes),
        title: row.title,
        passwordHash: row.id === "alpha" ? "scrypt$x$y" : null,
        protect: row.id === "alpha" ? "edit" : null,
        createdAt: new Date(now - row.age * 1000),
        updatedAt: new Date(now - (4 - row.age) * 1000),
      }).run();
    }
    for (let i = 0; i < 30; i += 1) {
      db.db.insert(db.schema.documents).values({ id: `bulk-${i}`, data: { ops: [] }, createdAt: new Date(now - 60_000), updatedAt: new Date(now - 60_000) }).run();
    }

    const app = express();
    app.use(adminRoutes());
    server = createServer(app);
    io = attachSockets(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;

    const login = await fetch(`${base}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "list" }),
    });
    cookie = adminCookieOf(login);
    open.push(await connectClient(base, "gamma"));
  });

  after(async () => {
    for (const client of open) client.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      void io.close(() => resolve());
    });
    closeAll();
    cleanupDatabase();
  });

  const list = async (query = "") =>
    (await (await fetch(`${base}/api/admin/documents${query}`, { headers: { cookie } })).json()) as DirectoryPage;

  it("is only for the signed in", async () => {
    assert.equal((await fetch(`${base}/api/admin/documents`)).status, 401);
  });

  it("pages through everything, most recently changed first", async () => {
    const first = await list();
    assert.equal(first.total, 33);
    assert.equal(first.documents.length, 25);
    assert.deepEqual(first.documents.slice(0, 3).map((d) => d.id), ["alpha", "beta", "gamma"]);
    const second = await list("?offset=25");
    assert.equal(second.documents.length, 8);
    assert.equal(second.offset, 25);
  });

  it("sorts by when made and by size", async () => {
    assert.equal((await list("?sort=created")).documents[0]?.id, "gamma");
    assert.deepEqual((await list("?sort=size")).documents.slice(0, 3).map((d) => d.id), ["beta", "gamma", "alpha"]);
  });

  it("searches titles and addresses, taking % and _ literally", async () => {
    assert.deepEqual((await list("?q=meeting")).documents.map((d) => d.id), ["alpha"]);
    assert.deepEqual((await list("?q=gam")).documents.map((d) => d.id), ["gamma"]);
    assert.deepEqual((await list(`?q=${encodeURIComponent("0% d")}`)).documents.map((d) => d.id), ["beta"]);
    assert.equal((await list(`?q=${encodeURIComponent("%")}`)).total, 1);
    assert.equal((await list(`?q=${encodeURIComponent("_")}`)).total, 1, "not a wildcard for every address");
  });

  it("says who is in a document, and can show only those", async () => {
    const page = await list("?open=1");
    assert.deepEqual(page.documents.map((d) => [d.id, d.editors]), [["gamma", 1]]);
    const alpha = (await list("?q=alpha")).documents[0];
    assert.equal(alpha?.protect, "edit");
    assert.equal(alpha?.editors, 0);
  });
});
