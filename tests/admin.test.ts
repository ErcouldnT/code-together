import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join as joinPath } from "node:path";
import { after, before, describe, it } from "node:test";
import type { AdminOverview } from "../shared/admin.js";
import { cleanupDatabase, connectClient, settle, useTemporaryDatabase } from "./helpers.ts";

/**
 * The admin screen's API: signing in, reading the overview, and changing
 * limits that then bite on the very next request — no restart.
 */
describe("admin", () => {
  let server: Server;
  let base: string;
  let closeAll: () => void;
  let settings: typeof import("../src/settings.js");

  before(async () => {
    const dir = useTemporaryDatabase();
    process.env.UPLOAD_DIR = joinPath(dir, "..", "uploads-admin");
    process.env.ADMIN_TOKEN = "correct horse battery staple";
    const { runMigrations } = await import("../src/db/index.js");
    runMigrations();
    const { adminRoutes } = await import("../src/admin.js");
    const { accessRoutes } = await import("../src/access.js");
    const { attachmentRoutes } = await import("../src/attachments.js");
    const { attachSockets } = await import("../src/sockets.js");
    settings = await import("../src/settings.js");
    closeAll = (await import("../src/rooms.js")).closeAllRooms;
    const express = (await import("express")).default;

    const app = express();
    app.use(adminRoutes());
    app.use(accessRoutes());
    app.use(attachmentRoutes(() => {}));
    server = createServer(app);
    attachSockets(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    closeAll();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    cleanupDatabase();
  });

  const login = (token: string) =>
    fetch(`${base}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });

  let cookie = "";
  const put = (body: unknown) =>
    fetch(`${base}/api/admin/limits`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    });

  it("refuses the wrong token and anyone not signed in", async () => {
    assert.equal((await login("guess")).status, 403);
    assert.equal((await fetch(`${base}/api/admin/overview`)).status, 401);
    assert.equal((await put({ requestsPerMinute: 50 })).status, 401);
  });

  it("signs in with the token and shows the overview", async () => {
    const response = await login("correct horse battery staple");
    assert.equal(response.status, 204);
    const setCookie = response.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /Path=\/api\/admin/i);
    cookie = setCookie.split(";")[0] ?? "";

    const overview = (await (await fetch(`${base}/api/admin/overview`, { headers: { cookie } })).json()) as AdminOverview;
    assert.equal(overview.limits.requestsPerMinute, 300);
    assert.deepEqual(overview.limits, overview.defaults);
    assert.equal(typeof overview.stats.documents, "number");
    assert.equal(typeof overview.stats.databaseBytes, "number");
  });

  it("changes limits all at once or not at all, and puts one back on null", async () => {
    const bad = await put({ requestsPerMinute: 50, unlockAttemptsPerMinute: 0 });
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: "bad-limit", key: "unlockAttemptsPerMinute" });
    assert.equal(settings.limits().requestsPerMinute, 300, "nothing from a refused update is applied");

    assert.equal((await put({ nonsense: 5 })).status, 400);

    const good = await put({ requestsPerMinute: 50 });
    assert.equal(good.status, 200);
    assert.equal(settings.limits().requestsPerMinute, 50);

    // survives a reload from the database, as it would a restart
    settings.reloadLimits();
    assert.equal(settings.limits().requestsPerMinute, 50);

    await put({ requestsPerMinute: null });
    assert.equal(settings.limits().requestsPerMinute, 300);
  });

  it("applies an attachment quota to the next upload", async () => {
    await fetch(`${base}/api/documents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Kota" }),
    });
    assert.equal((await put({ attachmentQuotaBytes: 100 })).status, 200);

    const attach = (bytes: number) =>
      fetch(`${base}/api/documents/kota/attachments?name=a.bin`, { method: "POST", body: "x".repeat(bytes) });
    assert.equal((await attach(60)).status, 201);
    const second = await attach(60);
    assert.equal(second.status, 507);
    assert.deepEqual(await second.json(), { error: "quota" });

    const list = (await (await fetch(`${base}/api/documents/kota/attachments`)).json()) as { maxBytes: number };
    assert.equal(list.maxBytes, 40, "the panel is told how much room is left");

    await put({ attachmentQuotaBytes: null });
    assert.equal((await attach(60)).status, 201);
  });

  it("applies a new edit rate to sockets already connected", async () => {
    const client = await connectClient(base, "rate");
    assert.equal((await put({ updateBurst: 10 })).status, 200);
    for (let i = 0; i < 15; i++) client.text.insert(0, "x");
    await settle(300);
    assert.ok(client.rejections.includes("too-fast"));
    client.destroy();
    await put({ updateBurst: null });
  });
});
