import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupDatabase, connectClient, settle, startServer, type TestServer } from "./helpers.ts";

/**
 * The regression this whole rewrite is for.
 *
 * The old server rebroadcast each Quill delta untransformed. Two people typing
 * at the same index produced two different documents that could never merge
 * again, and the next whole-document save silently overwrote one of them. That
 * failure is invisible when you click through by hand, because you have to
 * type in two windows within the same few milliseconds to see it.
 */
describe("concurrent editing", () => {
  let server: TestServer;

  before(async () => {
    server = await startServer();
  });

  after(async () => {
    await server.close();
    cleanupDatabase();
  });

  it("converges when two people type at the same position at the same moment", async () => {
    const a = await connectClient(server.url, "conv1");
    const b = await connectClient(server.url, "conv1");

    a.text.insert(0, "hello");
    await settle();
    assert.equal(b.text.toString(), "hello", "the second client should see the first's text");

    // Both edits happen before either has heard about the other — the exact
    // interleaving the old code could not survive.
    a.text.insert(5, "AAA");
    b.text.insert(5, "BBB");
    await settle();

    assert.equal(a.text.toString(), b.text.toString());
    assert.equal(a.text.toString().length, "hello".length + 6);
    assert.ok(a.text.toString().startsWith("hello"));
    assert.ok(a.text.toString().includes("AAA"));
    assert.ok(a.text.toString().includes("BBB"));

    a.destroy();
    b.destroy();
  });

  it("gives a late arrival the same document the others already have", async () => {
    const a = await connectClient(server.url, "conv2");
    const b = await connectClient(server.url, "conv2");
    a.text.insert(0, "shared ");
    b.text.insert(0, "state ");
    await settle();

    // A third client reads the server's own copy: if the server had diverged
    // from the two of them, this is where it would show.
    const c = await connectClient(server.url, "conv2");
    await settle();
    assert.equal(c.text.toString(), a.text.toString());
    assert.equal(c.text.toString(), b.text.toString());

    a.destroy();
    b.destroy();
    c.destroy();
  });

  it("delivers edits made while disconnected once the connection returns", async () => {
    const a = await connectClient(server.url, "conv3");
    const b = await connectClient(server.url, "conv3");
    a.text.insert(0, "online");
    await settle();

    await b.disconnect();
    // Typing into a document nobody can hear. The old code lost this outright:
    // the reconnect opened a new socket, the client never re-announced itself,
    // and the server had no listeners for it at all.
    b.text.insert(6, " offline");
    a.text.insert(0, "meanwhile ");
    await settle();
    assert.ok(!a.text.toString().includes("offline"), "cannot have arrived yet");

    await b.reconnect();
    await settle(300);

    assert.equal(a.text.toString(), b.text.toString());
    assert.ok(a.text.toString().includes("offline"), "the offline edit must arrive");
    assert.ok(b.text.toString().includes("meanwhile "), "and the missed edits must arrive too");

    a.destroy();
    b.destroy();
  });
});
