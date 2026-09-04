import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Delta from "quill-delta";
import * as Y from "yjs";

/**
 * What the old server actually did, in eleven lines, so the bug cannot come
 * back by accident.
 *
 * The convergence tests drive the new protocol and so cannot be run against the
 * old one — the wire format is entirely different. This is the honest
 * substitute: it reproduces the old *algorithm* on plain Quill deltas and shows
 * it diverging, next to Yjs doing the same edits and not.
 *
 * The old code's whole collaboration layer was
 *   `socket.broadcast.to(room).emit("receive-changes", delta)`
 * with the receiver calling `quill.updateContents(delta)`. No transformation
 * against concurrent edits anywhere — which is fine until two people type at
 * once, and silently wrong from then on.
 */
describe("the algorithm this replaced", () => {
  it("diverges when two deltas are rebroadcast untransformed", () => {
    const start = new Delta().insert("hello");

    // Each person types three characters at index 5, at the same moment.
    const fromA = new Delta().retain(5).insert("AAA");
    const fromB = new Delta().retain(5).insert("BBB");

    // Each applies their own edit, then receives the other's verbatim.
    const onA = start.compose(fromA).compose(fromB);
    const onB = start.compose(fromB).compose(fromA);

    assert.notDeepEqual(
      onA.ops,
      onB.ops,
      "if this ever passes, the old bug has been reintroduced",
    );
    assert.equal(onA.filter((op) => typeof op.insert === "string").map((op) => op.insert).join(""), "helloBBBAAA");
    assert.equal(onB.filter((op) => typeof op.insert === "string").map((op) => op.insert).join(""), "helloAAABBB");
  });

  it("converges on the same edits once the document is a CRDT", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    a.getText("quill").insert(0, "hello");
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    // the same simultaneous edit, neither having seen the other
    a.getText("quill").insert(5, "AAA");
    b.getText("quill").insert(5, "BBB");

    // and now they exchange, in whichever order
    const fromA = Y.encodeStateAsUpdate(a);
    const fromB = Y.encodeStateAsUpdate(b);
    Y.applyUpdate(a, fromB);
    Y.applyUpdate(b, fromA);

    assert.equal(a.getText("quill").toString(), b.getText("quill").toString());
    assert.equal(a.getText("quill").toString().length, 11);
  });
});
