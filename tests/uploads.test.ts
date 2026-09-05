import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { cleanupDatabase, useTemporaryDatabase } from "./helpers.ts";

process.env.UPLOAD_DIR = mkdtempSync(join(tmpdir(), "together-uploads-"));

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082",
  "hex",
);
const GIF = Buffer.from("47494638396101000100800000ffffff00000021f90401000000002c00000000010001000002024401003b", "hex");
const NOT_AN_IMAGE = Buffer.from("<!doctype html><script>alert(1)</script>", "utf8");
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "utf8");

describe("the upload store", () => {
  let uploads: typeof import("../src/uploads.js");

  before(async () => {
    useTemporaryDatabase();
    uploads = await import("../src/uploads.js");
  });

  after(() => cleanupDatabase());

  it("decides the type from the bytes, not from what it is told", () => {
    // The request could have called this image/png; nothing here ever asked.
    assert.equal(uploads.sniff(NOT_AN_IMAGE), null);
    assert.equal(uploads.sniff(PNG)?.mime, "image/png");
    assert.equal(uploads.sniff(GIF)?.mime, "image/gif");
  });

  it("refuses SVG, which is a document that runs script", () => {
    assert.equal(uploads.sniff(SVG), null);
    assert.deepEqual(uploads.storeUpload(SVG), { error: "not-an-image" });
  });

  it("stores the same picture once, at one address", () => {
    const first = uploads.storeUpload(PNG);
    const second = uploads.storeUpload(Buffer.from(PNG));
    assert.ok(!("error" in first) && !("error" in second));
    assert.equal(first.url, second.url);

    const path = uploads.pathForStoredName(first.name);
    assert.ok(path && existsSync(path));
    assert.deepEqual(readFileSync(path), PNG);
  });

  it("gives a path only to names it could have written", () => {
    for (const name of [
      "../../../etc/passwd",
      "..%2f..%2fetc%2fpasswd",
      "g".repeat(64) + ".png", // not hex
      "deadbeef.png", // too short
      "0".repeat(64) + ".svg", // not a type we store
      "0".repeat(64) + ".png/../../x",
      "0".repeat(63) + ".png",
    ]) {
      assert.equal(uploads.pathForStoredName(name), null, `${name} must not resolve`);
    }

    // A well-formed name for a file we never wrote does resolve, and that is
    // correct: the guard is about the *shape* of the name, because that is
    // what keeps a request from contributing a path segment. Whether the file
    // exists is the file system's answer, and a miss is a plain 404.
    const missing = uploads.pathForStoredName("0".repeat(64) + ".png");
    assert.ok(missing);
    assert.ok(!existsSync(missing));

    const stored = uploads.storeUpload(GIF);
    assert.ok(!("error" in stored));
    assert.ok(uploads.pathForStoredName(stored.name));
  });

  it("recognises its own addresses and nobody else's", () => {
    const stored = uploads.storeUpload(PNG);
    assert.ok(!("error" in stored));
    assert.equal(uploads.storedNameIn(stored.url), stored.name);
    assert.equal(uploads.storedNameIn("https://example.com/cat.png"), null);
    assert.equal(uploads.storedNameIn("/uploads/../../etc/passwd"), null);
    assert.equal(uploads.storedNameIn("data:image/png;base64,AAAA"), null);
  });

  it("sweeps what no document mentions, but not what was just uploaded", () => {
    const kept = uploads.storeUpload(PNG);
    const doomed = uploads.storeUpload(GIF);
    assert.ok(!("error" in kept) && !("error" in doomed));

    // A file uploaded moments ago is not yet in any saved document. Deleting
    // it here is deleting a picture out from under the person adding it.
    assert.equal(uploads.sweepUploads(new Set()), 0, "nothing is old enough yet");

    // Age both past the grace period.
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    for (const name of [kept.name, doomed.name]) {
      const path = uploads.pathForStoredName(name)!;
      utimesSync(path, old, old);
    }

    assert.equal(uploads.sweepUploads(new Set([kept.name])), 1);
    assert.ok(existsSync(uploads.pathForStoredName(kept.name)!), "the referenced one stays");
    assert.ok(!existsSync(uploads.pathForStoredName(doomed.name)!), "the orphan goes");
  });
});

describe("legacy documents with pictures embedded in them", () => {
  let documents: typeof import("../src/documents.js");
  let uploads: typeof import("../src/uploads.js");

  before(async () => {
    useTemporaryDatabase();
    const { runMigrations } = await import("../src/db/index.js");
    runMigrations();
    documents = await import("../src/documents.js");
    uploads = await import("../src/uploads.js");
  });

  after(() => cleanupDatabase());

  it("moves base64 out of the delta as the room is seeded", async () => {
    const { db } = await import("../src/db/index.js");
    const { schema } = await import("../src/db/index.js");

    db.insert(schema.documents)
      .values({
        id: "embedded",
        data: {
          ops: [
            { insert: "before " },
            { insert: { image: `data:image/png;base64,${PNG.toString("base64")}` } },
            { insert: " after\n" },
          ],
        },
      })
      .run();

    const { doc, seeded } = documents.loadDocument("embedded");
    assert.equal(seeded, true);

    const ops = doc.getText("quill").toDelta() as { insert?: unknown }[];
    const image = ops
      .map((op) => (op.insert as { image?: unknown } | undefined)?.image)
      .find((value): value is string => typeof value === "string");

    assert.ok(image, "the picture should still be in the document");
    assert.ok(!image.startsWith("data:"), "but not as base64");
    assert.ok(uploads.storedNameIn(image), "it should be one of ours now");
    assert.ok(existsSync(uploads.pathForStoredName(uploads.storedNameIn(image)!)!));

    documents.saveDocument("embedded", doc);
    assert.ok(
      documents.referencedUploads().has(uploads.storedNameIn(image)!),
      "and the sweep must be able to see that it is in use",
    );
  });

  it("leaves a picture it cannot store exactly where it found it", async () => {
    const { db, schema } = await import("../src/db/index.js");
    const svg = `data:image/svg+xml;base64,${SVG.toString("base64")}`;
    db.insert(schema.documents)
      .values({ id: "unstorable", data: { ops: [{ insert: { image: svg } }, { insert: "\n" }] } })
      .run();

    const { doc } = documents.loadDocument("unstorable");
    const ops = doc.getText("quill").toDelta() as { insert?: unknown }[];
    const image = ops
      .map((op) => (op.insert as { image?: unknown } | undefined)?.image)
      .find((value): value is string => typeof value === "string");

    // Somebody's document. A broken picture beats a disappeared one.
    assert.equal(image, svg);
  });
});

describe("the sweep when a document cannot be read", () => {
  let documents: typeof import("../src/documents.js");

  before(async () => {
    useTemporaryDatabase();
    const { runMigrations } = await import("../src/db/index.js");
    runMigrations();
    documents = await import("../src/documents.js");
  });

  after(() => cleanupDatabase());

  it("refuses to answer at all rather than answer incompletely", async () => {
    const { db, schema } = await import("../src/db/index.js");
    db.insert(schema.documents)
      .values({ id: "corrupt", data: { ops: [] }, ystate: Buffer.from("not a yjs update") })
      .run();

    // The caller deletes everything absent from the answer, so half an answer
    // would delete pictures that are still on screen.
    assert.throws(() => documents.referencedUploads(), /corrupt/);
  });
});
