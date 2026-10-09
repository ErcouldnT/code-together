import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join as joinPath } from "node:path";
import { after, before, describe, it } from "node:test";
import type { AdminStats, DirectoryPage, DocumentDetail } from "../shared/admin.js";
import { adminCookieOf, cleanupDatabase, connectClient, settle, useTemporaryDatabase, type TestClient } from "./helpers.ts";

/**
 * The admin screen's list of every document — searching, sorting, paging and
 * filtering it — the record of where documents are made and changed from,
 * and the admin's key to every document.
 */
describe("document directory", () => {
  let server: Server;
  let base: string;
  let cookie = "";
  let closeAll: () => void;
  let io: import("../src/sockets.js").IoServer;
  let db: typeof import("../src/db/index.js");
  const open: TestClient[] = [];

  before(async () => {
    const dir = useTemporaryDatabase();
    process.env.UPLOAD_DIR = joinPath(dir, "..", "uploads-directory");
    process.env.ADMIN_TOKEN = "list";
    db = await import("../src/db/index.js");
    db.runMigrations();
    const { adminRoutes } = await import("../src/admin.js");
    const { accessRoutes } = await import("../src/access.js");
    const { attachSockets } = await import("../src/sockets.js");
    closeAll = (await import("../src/rooms.js")).closeAllRooms;
    const express = (await import("express")).default;

    const now = Date.now();
    const rows = [
      { id: "alpha", title: "Meeting notes", age: 3, bytes: 10, ip: "88.255.1.1", country: "TR" },
      { id: "beta", title: "100% done_ish", age: 2, bytes: 500, ip: "8.8.8.8", country: "US" },
      { id: "gamma", title: null, age: 1, bytes: 50, ip: null, country: null },
    ];
    for (const row of rows) {
      db.db.insert(db.schema.documents).values({
        id: row.id,
        data: { ops: [] },
        ystate: Buffer.alloc(row.bytes),
        title: row.title,
        passwordHash: row.id === "alpha" ? "scrypt$x$y" : row.id === "beta" ? "scrypt$a$b" : null,
        protect: row.id === "alpha" ? "edit" : row.id === "beta" ? "view" : null,
        createdIp: row.ip,
        createdCountry: row.country,
        createdAt: new Date(now - row.age * 1000),
        updatedAt: new Date(now - (4 - row.age) * 1000),
      }).run();
    }
    // somebody in Germany has changed alpha
    db.db.insert(db.schema.documentEditors).values({
      documentId: "alpha", ip: "85.105.9.9", country: "DE", edits: 7, firstAt: new Date(now - 5000), lastAt: new Date(now - 4000),
    }).run();
    for (let i = 0; i < 30; i += 1) {
      db.db.insert(db.schema.documents).values({ id: `bulk-${i}`, data: { ops: [] }, createdAt: new Date(now - 60_000), updatedAt: new Date(now - 60_000) }).run();
    }

    const app = express();
    app.set("trust proxy", 1);
    app.use(adminRoutes());
    app.use(accessRoutes());
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

  const get = async <T>(path: string) =>
    (await (await fetch(`${base}${path}`, { headers: { cookie } })).json()) as T;
  const list = (query = "") => get<DirectoryPage>(`/api/admin/documents${query}`);
  const ids = async (query: string) => (await list(query)).documents.map((d) => d.id);

  it("is only for the signed in", async () => {
    assert.equal((await fetch(`${base}/api/admin/documents`)).status, 401);
    assert.equal((await fetch(`${base}/api/admin/stats`)).status, 401);
    assert.equal((await fetch(`${base}/api/admin/documents/alpha`)).status, 401);
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
    assert.equal((await ids("?sort=created"))[0], "gamma");
    assert.deepEqual((await ids("?sort=size")).slice(0, 3), ["beta", "gamma", "alpha"]);
  });

  it("searches titles and addresses, taking % and _ literally", async () => {
    assert.deepEqual(await ids("?q=meeting"), ["alpha"]);
    assert.deepEqual(await ids("?q=gam"), ["gamma"]);
    assert.deepEqual(await ids(`?q=${encodeURIComponent("0% d")}`), ["beta"]);
    assert.equal((await list(`?q=${encodeURIComponent("%")}`)).total, 1);
    assert.equal((await list(`?q=${encodeURIComponent("_")}`)).total, 1, "not a wildcard for every address");
  });

  it("filters by password: none, any, to view, to edit", async () => {
    assert.equal((await list("?protection=none")).total, 31);
    assert.deepEqual((await ids("?protection=locked")).sort(), ["alpha", "beta"]);
    assert.deepEqual(await ids("?protection=view"), ["beta"]);
    assert.deepEqual(await ids("?protection=edit"), ["alpha"]);
  });

  it("filters by the address and country made or changed from", async () => {
    assert.deepEqual(await ids("?ip=88.255."), ["alpha"], "the maker's address, by its start");
    assert.deepEqual(await ids("?ip=85.105"), ["alpha"], "an editor's address");
    assert.deepEqual(await ids("?ip=8.8"), ["beta"], "a prefix, not anywhere in the address");
    assert.deepEqual(await ids("?country=us"), ["beta"]);
    assert.deepEqual(await ids("?country=DE"), ["alpha"]);
    assert.deepEqual((await list()).countries, ["DE", "TR", "US"]);
    assert.deepEqual(await ids("?country=TR&protection=view"), []);
  });

  it("says who is in a document, and can show only those", async () => {
    const page = await list("?open=1");
    assert.deepEqual(page.documents.map((d) => [d.id, d.editors]), [["gamma", 1]]);
    const alpha = (await list("?q=alpha")).documents[0];
    assert.equal(alpha?.protect, "edit");
    assert.equal(alpha?.createdCountry, "TR");
  });

  it("opens one document's detail", async () => {
    const detail = await get<DocumentDetail>("/api/admin/documents/alpha");
    assert.deepEqual(detail.editors.map((e) => [e.ip, e.country, e.edits]), [["85.105.9.9", "DE", 7]]);
    assert.equal((await fetch(`${base}/api/admin/documents/nope`, { headers: { cookie } })).status, 404);
  });

  it("records where a document is made and changed from", async () => {
    const tr = { "x-forwarded-for": "10.0.0.1, 88.255.1.1" };
    const writer = await connectClient(base, "fresh", tr);
    open.push(writer);
    writer.text.insert(0, "merhaba dünya");
    await settle(2600); // one save interval

    const fresh = (await list("?q=fresh")).documents[0];
    assert.equal(fresh?.createdIp, "88.255.1.1", "the last hop, not what the visitor wrote");
    assert.equal(fresh?.createdCountry, "TR");
    assert.equal(fresh?.editedIp, "88.255.1.1");
    assert.ok(fresh?.editedAt);

    const detail = await get<DocumentDetail>("/api/admin/documents/fresh");
    assert.equal(detail.editors.length, 1);
    assert.ok((detail.editors[0]?.edits ?? 0) >= 1);
    assert.equal(detail.words, 2);
    assert.equal(detail.characters, 13);

    // a reader joining sends an empty update; that is not an edit
    const reader = await connectClient(base, "fresh", { "x-forwarded-for": "8.8.8.8" });
    open.push(reader);
    await settle(2600);
    assert.equal((await get<DocumentDetail>("/api/admin/documents/fresh")).editors.length, 1);

    const made = await fetch(`${base}/api/documents`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "8.8.8.8" },
      body: JSON.stringify({ name: "Named one" }),
    });
    assert.equal(made.status, 201);
    assert.equal((await list("?q=named")).documents[0]?.createdCountry, "US");
  });

  it("adds it all up", async () => {
    const stats = await get<AdminStats>("/api/admin/stats");
    assert.deepEqual(stats.protection, { open: 33, view: 1, edit: 1 });
    assert.equal(stats.createdPerDay.length, 30);
    assert.equal(stats.createdPerDay.at(-1)?.count, 35);
    const tr = stats.countries.find((c) => c.country === "TR");
    assert.equal(tr?.created, 2);
    assert.equal(tr?.documents, 1);
    assert.equal(stats.countries.find((c) => c.country === "DE")?.edits, 7);
    assert.ok(stats.ips.some((row) => row.ip === "85.105.9.9" && row.edits === 7));
    assert.equal(stats.totals.countries, 3);
    assert.ok(stats.ages.oldest !== null && stats.ages.medianDays === 0);
  });
});
