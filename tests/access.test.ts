import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { io as connectSocket, type Socket } from "socket.io-client";
import type { AccessInfo } from "../shared/access.js";
import type { ClientToServerEvents, ServerToClientEvents } from "../shared/events.js";
import { META_KEY, TEXT_KEY } from "../shared/ydoc.js";
import { SocketProvider } from "../client/src/yjs/socketProvider.ts";
import { cleanupDatabase, settle, useTemporaryDatabase } from "./helpers.ts";

/**
 * Passwords, over the same HTTP routes and the same socket the browser uses.
 * The cookie is the whole mechanism, so every request here carries it — or
 * pointedly does not — by hand.
 */
describe("document passwords", () => {
  let server: Server;
  let base: string;
  let closeAll: () => void;
  const sockets: Socket[] = [];
  const providers: SocketProvider[] = [];

  before(async () => {
    useTemporaryDatabase();
    const { runMigrations } = await import("../src/db/index.js");
    runMigrations();
    const { accessRoutes } = await import("../src/access.js");
    const { attachmentRoutes } = await import("../src/attachments.js");
    const { attachSockets } = await import("../src/sockets.js");
    closeAll = (await import("../src/rooms.js")).closeAllRooms;
    const express = (await import("express")).default;

    const app = express();
    app.use(accessRoutes());
    app.use(attachmentRoutes(() => {}));
    server = createServer(app);
    attachSockets(server);
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

  const create = (body: Record<string, unknown>) =>
    fetch(`${base}/api/documents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  const access = async (id: string, cookie?: string) =>
    (await (await fetch(`${base}/api/documents/${id}/access`, { headers: cookie ? { cookie } : {} })).json()) as AccessInfo;

  /** `name=value` out of a Set-Cookie header, which is what a browser would send back. */
  const cookieOf = (response: Response): string => (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

  /** The real client provider, with or without the cookie on its handshake. */
  function join(id: string, cookie?: string) {
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = connectSocket(base, {
      transports: ["websocket"],
      forceNew: true,
      extraHeaders: cookie ? { cookie } : {},
    });
    sockets.push(socket);
    const problems: string[] = [];
    const synced = new Promise<void>((resolve) => {
      const provider = new SocketProvider(socket, id, {
        onStatus: (status) => {
          if (status === "synced") resolve();
        },
        onJoinError: (reason) => {
          problems.push(reason);
          resolve();
        },
        onRejected: (reason) => problems.push(reason),
      });
      providers.push(provider);
    });
    return { provider: providers.at(-1)!, problems, synced };
  }

  it("turns the name into the address and the title, and refuses it twice", async () => {
    const response = await create({ name: "Toplantı Notları" });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { id: "toplanti-notlari" });
    assert.equal(response.headers.get("set-cookie"), null);
    assert.deepEqual(await access("toplanti-notlari"), { protect: null, read: true, write: true, expiresAt: null });

    const client = join("toplanti-notlari");
    await client.synced;
    assert.equal(client.provider.doc.getMap(META_KEY).get("title"), "Toplantı Notları");

    const again = await create({ name: "toplanti notlari" });
    assert.equal(again.status, 409);
    assert.deepEqual(await again.json(), { error: "taken" });
  });

  it("refuses names that leave no address, or one the server already answers", async () => {
    for (const name of ["!!!", "   ", "healthz"]) {
      const response = await create({ name });
      assert.equal(response.status, 400, name);
      assert.deepEqual(await response.json(), { error: "bad-name" });
    }
    const short = await create({ name: "short pw", password: "abc" });
    assert.deepEqual(await short.json(), { error: "bad-password" });
  });

  it("keeps a view-protected document out of reach until the password is given", async () => {
    const response = await create({ name: "Gizli", password: "hunter22", protect: "view" });
    assert.equal(response.status, 201);
    const creator = cookieOf(response);
    assert.match(creator, /^ct_gizli=/);
    assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/i);

    assert.deepEqual(await access("gizli"), { protect: "view", read: false, write: false, expiresAt: null });
    assert.deepEqual(await access("gizli", creator), { protect: "view", read: true, write: true, expiresAt: null });
    assert.equal((await fetch(`${base}/api/documents/gizli/attachments`)).status, 404);

    const stranger = join("gizli");
    await stranger.synced;
    assert.deepEqual(stranger.problems, ["locked"]);
    assert.equal(stranger.provider.doc.getMap(META_KEY).get("title"), undefined);

    const wrong = await fetch(`${base}/api/documents/gizli/unlock`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "hunter2" }),
    });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.headers.get("set-cookie"), null);

    const right = await fetch(`${base}/api/documents/gizli/unlock`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "hunter22" }),
    });
    assert.equal(right.status, 204);
    assert.equal(cookieOf(right), creator);
    assert.equal((await fetch(`${base}/api/documents/gizli/attachments`, { headers: { cookie: creator } })).status, 200);
  });

  it("does not accept a cookie made for another document", async () => {
    const response = await create({ name: "Bir", password: "hunter22", protect: "view" });
    const [name, value] = cookieOf(response).split("=");
    await create({ name: "Iki", password: "hunter22", protect: "view" });
    assert.equal(name, "ct_bir");
    assert.equal((await access("iki", `ct_iki=${value}`)).read, false);
  });

  it("lets anyone read an edit-protected document and only the password holder write", async () => {
    const response = await create({ name: "Duyuru", password: "hunter22", protect: "edit" });
    const owner = cookieOf(response);

    assert.deepEqual(await access("duyuru"), { protect: "edit", read: true, write: false, expiresAt: null });
    assert.equal((await fetch(`${base}/api/documents/duyuru/attachments`)).status, 200);
    const upload = await fetch(`${base}/api/documents/duyuru/attachments?name=x.txt`, { method: "POST", body: "x" });
    assert.equal(upload.status, 403);

    const writer = join("duyuru", owner);
    const reader = join("duyuru");
    await Promise.all([writer.synced, reader.synced]);
    // joining sends an empty update up; a reader must not be left holding it
    // as "unsaved", nor be told off for it
    await settle(300);
    assert.equal(reader.provider.unsaved, false);
    assert.deepEqual(reader.problems, []);

    writer.provider.doc.getText(TEXT_KEY).insert(0, "from the owner");
    await settle();
    assert.equal(reader.provider.doc.getText(TEXT_KEY).toString(), "from the owner");

    reader.provider.doc.getText(TEXT_KEY).insert(0, "vandal ");
    await settle();
    assert.deepEqual(reader.problems, ["read-only"]);
    assert.equal(writer.provider.doc.getText(TEXT_KEY).toString(), "from the owner");
  });
});
