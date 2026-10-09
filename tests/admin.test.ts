import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join as joinPath } from "node:path";
import { after, before, describe, it } from "node:test";
import type { AccessInfo } from "../shared/access.js";
import type { AdminOverview } from "../shared/admin.js";
import {
  ADMIN_EMAIL,
  cleanupDatabase,
  connectClient,
  mountAuth,
  sessionCookieOf,
  settle,
  signIn,
  useAdmin,
  useTemporaryDatabase,
} from "./helpers.ts";

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
    useAdmin();
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
    app.set("trust proxy", 1);
    await mountAuth(app);
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

  let cookie = "";
  const put = (body: unknown) =>
    fetch(`${base}/api/admin/limits`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    });

  it("refuses a wrong password, anyone not signed in, and anyone signing up", async () => {
    assert.equal((await signIn(base, ADMIN_EMAIL, "not the password at all")).status, 401);
    assert.equal((await signIn(base, "someone@example.test", "not the password at all")).status, 401);
    const signUp = await fetch(`${base}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ email: "new@example.test", password: "a long enough password", name: "New" }),
    });
    assert.ok(signUp.status >= 400, "sign-up is closed");
    assert.equal((await fetch(`${base}/api/admin/overview`)).status, 401);
    assert.equal((await put({ requestsPerMinute: 50 })).status, 401);
  });

  it("signs in with the admin's email and password and shows the overview", async () => {
    const response = await signIn(base);
    assert.equal(response.status, 200);
    const setCookie = response.headers.getSetCookie().find((line) => /session_token=[^;]/.test(line)) ?? "";
    assert.match(setCookie, /HttpOnly/i);
    // site-wide, because it is also what opens every document
    assert.match(setCookie, /Path=\/(;|$)/i);
    assert.match(setCookie, /SameSite=Lax/i);
    cookie = sessionCookieOf(response);

    const overview = (await (await fetch(`${base}/api/admin/overview`, { headers: { cookie } })).json()) as AdminOverview;
    assert.equal(overview.limits.requestsPerMinute, 300);
    assert.deepEqual(overview.limits, overview.defaults);
    assert.equal(typeof overview.stats.documents, "number");
    assert.equal(typeof overview.stats.databaseBytes, "number");
  });

  it("opens every document, password or not, and only for the admin", async () => {
    const made = await fetch(`${base}/api/documents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Locked away", password: "hunter22", protect: "view" }),
    });
    const { id } = (await made.json()) as { id: string };
    const access = async (headers: Record<string, string>) =>
      (await (await fetch(`${base}/api/documents/${id}/access`, { headers })).json()) as AccessInfo;

    assert.equal((await access({})).read, false);
    assert.equal((await access({ cookie: "better-auth.session_token=forged.value" })).read, false);
    const admin = await access({ cookie });
    assert.equal(admin.read, true);
    assert.equal(admin.write, true);

    // and over the socket, which is where reading and writing happen
    const inside = await connectClient(base, id, { cookie });
    inside.text.insert(0, "x");
    await settle(300);
    assert.deepEqual(inside.rejections, []);
    inside.destroy();
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
