import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  assertSameYjsAsProvider,
  cleanupDatabase,
  ClientY as Y,
  connectClient,
  settle,
  startServer,
  type TestServer,
} from "./helpers.ts";

/**
 * Where an uploaded picture lands.
 *
 * An upload takes a second or two, and the caret index it started from is a
 * fact about a document other people are still editing. If somebody types
 * before that point while the upload is in flight, the index no longer names
 * the place the caret was — the picture drops into the middle of their
 * sentence. It is the kind of bug you cannot find by clicking, because it
 * needs a second person typing during the upload.
 *
 * `createInserter` therefore holds a Yjs relative position, which is anchored
 * to the character rather than to a count. This exercises that property
 * directly, over a real socket, with a real second client.
 */
describe("inserting a picture while somebody else is typing", () => {
  let server: TestServer;

  before(async () => {
    server = await startServer();
  });

  after(async () => {
    await server.close();
    cleanupDatabase();
  });

  it("lands where the caret was, not where the index now points", async () => {
    const a = await connectClient(server.url, "pos1");
    const b = await connectClient(server.url, "pos1");
    assertSameYjsAsProvider(a, Y.Doc);

    a.text.insert(0, "hello world");
    await settle();
    assert.equal(b.text.toString(), "hello world");

    // The caret sits after "hello". The upload starts here.
    const caret = 5;
    const anchor = Y.createRelativePositionFromTypeIndex(a.text, caret);

    // While it is in flight, the other person types at the very beginning.
    b.text.insert(0, "XYZ");
    await settle();
    assert.equal(a.text.toString(), "XYZhello world");

    // The upload finishes.
    const at = Y.createAbsolutePositionFromRelativePosition(anchor, a.provider.doc);
    assert.ok(at, "the anchor should still resolve");
    assert.equal(at.index, caret + 3, "the anchor moved with the text, as it must");

    a.text.insertEmbed(at.index, { image: "/uploads/" + "a".repeat(64) + ".png" });
    await settle();

    const ops = a.text.toDelta() as { insert?: unknown }[];
    const rendered = ops.map((op) => (typeof op.insert === "string" ? op.insert : "*")).join("");

    // The picture sits between "hello" and " world", where the caret was.
    // A plain index would have put it at 5, inside the other person's "XYZhe".
    assert.equal(rendered, "XYZhello* world");
    assert.equal(b.text.toDelta().length, a.text.toDelta().length);

    a.destroy();
    b.destroy();
  });

  it("keeps the update small, which is the whole point of uploading", async () => {
    const a = await connectClient(server.url, "pos2");
    await settle();

    const before = Y.encodeStateVector(a.provider.doc);
    a.text.insertEmbed(0, { image: "/uploads/" + "b".repeat(64) + ".webp" });
    const update = Y.encodeStateAsUpdate(a.provider.doc, before);

    // A base64 screenshot in the document would make this tens of thousands of
    // bytes, and every keystroke afterwards would carry it to everyone in the
    // room. If this assertion ever fails, the pictures are back in the text.
    assert.ok(update.byteLength < 300, `update was ${update.byteLength} bytes`);

    a.destroy();
  });
});
