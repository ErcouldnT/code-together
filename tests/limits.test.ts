// Set before anything loads `src/env.ts`, which reads the environment once at
// import time. Small numbers so the test does not have to send a megabyte.
process.env.MAX_UPDATE_BYTES = "1024";
process.env.UPDATE_BURST = "5";
process.env.UPDATE_WINDOW_MS = "10000";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as Y from "yjs";
import { cleanupDatabase, connectClient, settle, startServer, type TestServer } from "./helpers.ts";

/** A real, applicable Yjs update of roughly the requested size. */
function updateOf(chars: number): Uint8Array {
  const doc = new Y.Doc();
  doc.getText("quill").insert(0, "x".repeat(chars));
  return Y.encodeStateAsUpdate(doc);
}

describe("limits", () => {
  let server: TestServer;

  before(async () => {
    server = await startServer();
  });

  after(async () => {
    await server.close();
    cleanupDatabase();
  });

  it("refuses an update larger than the cap, and says so", async () => {
    const a = await connectClient(server.url, "lim1");
    a.socket.emit("update", updateOf(1500));
    await settle();

    assert.deepEqual(a.rejections, ["too-large"]);
    a.destroy();
  });

  it("drops updates once a socket exceeds its burst", async () => {
    const a = await connectClient(server.url, "lim2");
    for (let i = 0; i < 12; i++) a.socket.emit("update", updateOf(1));
    await settle(300);

    assert.ok(a.rejections.length > 0, "some updates should have been refused");
    assert.ok(
      a.rejections.every((reason) => reason === "too-fast"),
      `expected only rate-limit rejections, got ${a.rejections.join(", ")}`,
    );
    a.destroy();
  });

  it("refuses to open a room whose id is not a room id", async () => {
    const a = await connectClient(server.url, "lim3");
    a.socket.emit("join", "../../etc/passwd", new Uint8Array());
    await settle();

    assert.deepEqual(a.rejections, ["bad-id"]);
    a.destroy();
  });

  it("keeps refusals visible rather than silent", async () => {
    // The point of every case above: the client is told. A server that quietly
    // drops an update leaves the user typing into a document that stopped
    // saving, which is precisely the failure this rewrite removes.
    const a = await connectClient(server.url, "lim4");
    a.socket.emit("update", updateOf(1500));
    await settle();
    assert.equal(a.rejections.length, 1);
    a.destroy();
  });
});
