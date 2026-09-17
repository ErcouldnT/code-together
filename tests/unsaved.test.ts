import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupDatabase, connectClient, settle, startServer, type TestServer } from "./helpers.ts";

/**
 * Whether the client can tell that its work is safe.
 *
 * This is the flag the tab-close warning is built on, so the failure that
 * matters is the cheerful one: a client reporting "saved" for something the
 * server has not written. Every wait here is therefore longer than the save
 * interval — the point is that the flag clears because a save happened, not
 * because enough time passed.
 */

/** Comfortably past rooms.ts's SAVE_INTERVAL_MS. */
const AFTER_A_SAVE = 2600;

describe("unsaved work", () => {
  let server: TestServer;

  before(async () => {
    server = await startServer();
  });

  after(async () => {
    await server.close();
    cleanupDatabase();
  });

  it("is not saved until the server has written it", async () => {
    const a = await connectClient(server.url, "unsaved1");
    a.text.insert(0, "typed just now");

    // Sent, received, broadcast to the room — and still not on disk. Anything
    // that acknowledged here would be acknowledging a crash away from loss.
    await settle();
    assert.equal(a.provider.unsaved, true);

    await settle(AFTER_A_SAVE);
    assert.equal(a.provider.unsaved, false);
    a.destroy();
  });

  it("counts edits made while disconnected, and clears them on reconnect", async () => {
    const a = await connectClient(server.url, "unsaved2");
    await settle(AFTER_A_SAVE);
    assert.equal(a.provider.unsaved, false);

    await a.disconnect();
    a.text.insert(0, "written with the connection down");
    assert.equal(a.provider.unsaved, true);

    await a.reconnect();
    await settle(AFTER_A_SAVE);
    assert.equal(a.provider.unsaved, false);

    // and it really did arrive, rather than merely stopping being counted
    const b = await connectClient(server.url, "unsaved2");
    await settle();
    assert.equal(b.text.toString(), "written with the connection down");
    a.destroy();
    b.destroy();
  });

  it("goes on counting an update the server refused", async () => {
    const a = await connectClient(server.url, "unsaved3");
    await settle(AFTER_A_SAVE);

    // Past maxUpdateBytes, so the server drops it instead of applying it. The
    // client is now ahead of the server and must keep saying so.
    a.text.insert(0, "x".repeat(1024 * 1024 + 1));
    await settle(AFTER_A_SAVE);

    assert.deepEqual(a.rejections, ["too-large"]);
    assert.equal(a.provider.unsaved, true);
    a.destroy();
  });
});
