import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { removeLinksTo } from "../client/src/attachments.ts";
import { ClientY } from "./helpers.ts";

const URL_A = "/api/documents/room/attachments/aaaaaaaa-0000-4000-8000-000000000000";
const URL_B = "/api/documents/room/attachments/bbbbbbbb-0000-4000-8000-000000000000";

describe("removing links to a deleted attachment", () => {
  it("takes out every link to that file and the space after it, and nothing else", () => {
    const doc = new ClientY.Doc();
    const text = doc.getText("quill");
    text.insert(0, "See ");
    text.insert(4, "📎 a.pdf", { link: URL_A });
    text.insert(text.length, " and ", { link: null });
    text.insert(text.length, "📎 b.pdf", { link: URL_B });
    text.insert(text.length, " then ", { link: null });
    // one link split into two differently formatted runs
    text.insert(text.length, "📎 ", { link: URL_A });
    text.insert(text.length, "a.pdf", { link: URL_A, bold: true });
    text.insert(text.length, " end", { link: null, bold: null });

    assert.equal(removeLinksTo(text, URL_A), 2);
    assert.equal(text.toString(), "See and 📎 b.pdf then end");
  });

  it("leaves the space after an attached link outside the link", () => {
    // what attach() inserts; without the explicit null the space is linked too
    const doc = new ClientY.Doc();
    const text = doc.getText("quill");
    text.insert(0, "📎 a.pdf", { link: URL_A });
    text.insert(text.length, " ", { link: null });
    const last = (text.toDelta() as Array<{ attributes?: object }>).at(-1);
    assert.equal(last?.attributes, undefined);
  });

  it("is a no-op when the file was never linked", () => {
    const doc = new ClientY.Doc();
    const text = doc.getText("quill");
    text.insert(0, "plain");
    assert.equal(removeLinksTo(text, URL_A), 0);
    assert.equal(text.toString(), "plain");
  });

  it("reaches everyone in the room as an ordinary edit", () => {
    const a = new ClientY.Doc();
    const b = new ClientY.Doc();
    a.getText("quill").insert(0, "x ");
    a.getText("quill").insert(2, "📎 a.pdf", { link: URL_A });
    ClientY.applyUpdate(b, ClientY.encodeStateAsUpdate(a));
    const before = ClientY.encodeStateVector(b);
    removeLinksTo(a.getText("quill"), URL_A);
    ClientY.applyUpdate(b, ClientY.encodeStateAsUpdate(a, before));
    assert.equal(b.getText("quill").toString(), "x ");
  });
});
