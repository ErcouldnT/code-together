import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { cleanupDatabase, useTemporaryDatabase } from "./helpers.ts";

process.env.UPLOAD_DIR = mkdtempSync(join(tmpdir(), "together-attachments-"));
process.env.MAX_ATTACHMENT_BYTES = "1024";

const HTML = Buffer.from("<!doctype html><script>alert(1)</script>", "utf8");

describe("document attachments", () => {
  let attachments: typeof import("../src/attachments.js");
  let documents: typeof import("../src/documents.js");
  let server: Server;
  let base: string;
  const notified: string[] = [];

  before(async () => {
    useTemporaryDatabase();
    const { runMigrations } = await import("../src/db/index.js");
    runMigrations();
    attachments = await import("../src/attachments.js");
    documents = await import("../src/documents.js");
    const express = (await import("express")).default;

    documents.loadDocument("room-a");
    documents.loadDocument("room-b");

    const app = express();
    app.use(attachments.attachmentRoutes((id) => notified.push(id)));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    cleanupDatabase();
  });

  const upload = (room: string, body: Buffer, name: string) =>
    fetch(`${base}/api/documents/${room}/attachments?name=${encodeURIComponent(name)}`, {
      method: "POST",
      body: new Uint8Array(body),
    });

  it("stores any kind of file and serves it only as a download", async () => {
    const response = await upload("room-a", HTML, 'evil"\r\nset-cookie: x.html');
    assert.equal(response.status, 201);
    const saved = (await response.json()) as { id: string; size: number };
    assert.equal(saved.size, HTML.length);
    assert.deepEqual(notified, ["room-a"]);

    const download = await fetch(`${base}/api/documents/room-a/attachments/${saved.id}`);
    assert.equal(download.status, 200);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), HTML);
    assert.equal(download.headers.get("content-type"), "application/octet-stream");
    assert.equal(download.headers.get("x-content-type-options"), "nosniff");
    assert.match(download.headers.get("content-security-policy") ?? "", /sandbox/);
    const disposition = download.headers.get("content-disposition") ?? "";
    assert.match(disposition, /^attachment;/);
    assert.equal(download.headers.get("set-cookie"), null);
    assert.doesNotMatch(disposition, /[\r\n]/);
  });

  it("keeps a non-ASCII name intact in the download", () => {
    assert.match(attachments.contentDisposition("rapor ğüş.pdf"), /filename\*=UTF-8''rapor%20%C4%9F%C3%BC%C5%9F\.pdf/);
  });

  it("refuses a file over the limit and leaves nothing on disk", async () => {
    const response = await upload("room-b", Buffer.alloc(2048), "big.bin");
    assert.equal(response.status, 413);
    const dir = join(process.env.UPLOAD_DIR!, "attachments", "room-b");
    assert.deepEqual(existsSync(dir) ? readdirSync(dir) : [], []);
    const list = (await (await fetch(`${base}/api/documents/room-b/attachments`)).json()) as { attachments: unknown[] };
    assert.equal(list.attachments.length, 0);
  });

  it("stops a body that grows past the limit without saying its length", async () => {
    // chunked, so the Content-Length check cannot catch it — the stream counter must
    const body = new ReadableStream({
      start(controller) {
        for (let i = 0; i < 4; i++) controller.enqueue(new Uint8Array(512));
        controller.close();
      },
    });
    const response = await fetch(`${base}/api/documents/room-b/attachments?name=big.bin`, {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit);
    assert.equal(response.status, 413);
    const dir = join(process.env.UPLOAD_DIR!, "attachments", "room-b");
    assert.deepEqual(existsSync(dir) ? readdirSync(dir) : [], []);
  });

  it("deletes the file from disk at once", async () => {
    const saved = (await (await upload("room-b", Buffer.from("hello"), "a.txt")).json()) as { id: string };
    const path = attachments.attachmentPath("room-b", saved.id)!;
    assert.ok(existsSync(path));

    const response = await fetch(`${base}/api/documents/room-b/attachments/${saved.id}`, { method: "DELETE" });
    assert.equal(response.status, 204);
    assert.ok(!existsSync(path));
    assert.equal((await fetch(`${base}/api/documents/room-b/attachments/${saved.id}`)).status, 404);
  });

  it("does not reach another document's files or climb out of its own", async () => {
    const saved = (await (await upload("room-a", Buffer.from("secret"), "s.txt")).json()) as { id: string };
    assert.equal((await fetch(`${base}/api/documents/room-b/attachments/${saved.id}`)).status, 404);
    assert.equal(
      (await fetch(`${base}/api/documents/room-b/attachments/${saved.id}`, { method: "DELETE" })).status,
      404,
    );
    assert.equal(attachments.attachmentPath("..", saved.id), null);
    assert.equal(attachments.attachmentPath("room-a", "../../etc/passwd"), null);
    assert.equal((await upload("no-such-room", Buffer.from("x"), "x")).status, 404);
  });

  it("removes a document's files when the document is pruned", async () => {
    const dir = join(process.env.UPLOAD_DIR!, "attachments", "room-a");
    assert.ok(readdirSync(dir).length > 0);
    // two days from now, everything here is more than a day untouched
    const cleanup = await import("../src/cleanup.js");
    const later = Date.now() + 2 * 24 * 60 * 60 * 1000;
    cleanup.deleteDocuments(cleanup.findAbandoned(1, later).map((row) => row.id));
    assert.ok(!existsSync(dir));
    assert.deepEqual(attachments.listAttachments("room-a"), []);
  });
});
