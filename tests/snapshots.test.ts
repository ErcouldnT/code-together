import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import * as Y from "yjs";
import { cleanupDatabase, useTemporaryDatabase } from "./helpers.ts";

describe("version history", () => {
  let snapshots: typeof import("../src/snapshots.js");
  let db: typeof import("../src/db/index.js")["db"];
  let schema: typeof import("../src/db/index.js")["schema"];

  before(async () => {
    useTemporaryDatabase();
    const dbModule = await import("../src/db/index.js");
    dbModule.runMigrations();
    db = dbModule.db;
    schema = dbModule.schema;
    snapshots = await import("../src/snapshots.js");
  });

  after(() => cleanupDatabase());

  function room(id: string) {
    db.insert(schema.documents).values({ id, data: { ops: [] } }).onConflictDoNothing().run();
    return new Y.Doc();
  }

  it("keeps at most one snapshot per interval", () => {
    const doc = room("throttle");
    const start = Date.UTC(2026, 0, 1);

    doc.getText("quill").insert(0, "first");
    assert.equal(snapshots.takeSnapshot("throttle", doc, start), true);

    // A minute later, more typing. Saving happens every two seconds; making a
    // snapshot every time would be a snapshot every two seconds.
    doc.getText("quill").insert(5, " second");
    assert.equal(snapshots.takeSnapshot("throttle", doc, start + 60_000), false);

    // Eleven minutes later it is time again.
    assert.equal(snapshots.takeSnapshot("throttle", doc, start + 11 * 60_000), true);
    assert.equal(snapshots.listSnapshots("throttle").length, 2);
  });

  it("does not record a document that has not changed", () => {
    const doc = room("unchanged");
    const start = Date.UTC(2026, 0, 2);
    doc.getText("quill").insert(0, "same");

    assert.equal(snapshots.takeSnapshot("unchanged", doc, start), true);
    // Long enough that the interval is not what stops it.
    assert.equal(snapshots.takeSnapshot("unchanged", doc, start + 60 * 60_000), false);
    assert.equal(snapshots.listSnapshots("unchanged").length, 1);
  });

  it("keeps the newest twenty and drops the rest", () => {
    const doc = room("pruned");
    const start = Date.UTC(2026, 0, 3);
    for (let i = 0; i < 25; i++) {
      doc.getText("quill").insert(0, `${i} `);
      snapshots.takeSnapshot("pruned", doc, start + i * 11 * 60_000);
    }

    const kept = snapshots.listSnapshots("pruned");
    assert.equal(kept.length, 20);
    // newest first, and the oldest five are gone
    assert.equal(kept[0]?.createdAt, start + 24 * 11 * 60_000);
    assert.equal(kept[19]?.createdAt, start + 5 * 11 * 60_000);
  });

  it("hands back a snapshot as a delta, not as Yjs state", () => {
    const doc = room("contents");
    const start = Date.UTC(2026, 0, 4);
    doc.getText("quill").insert(0, "before");
    snapshots.takeSnapshot("contents", doc, start);

    // the document moves on
    doc.getText("quill").insert(0, "way ");
    const [saved] = snapshots.listSnapshots("contents");
    assert.ok(saved);

    const contents = snapshots.snapshotContents("contents", saved.id);
    // A delta is what the client can diff against the live document to work
    // out the edit that restores it. Yjs state would only allow a reset.
    assert.deepEqual(contents?.ops, [{ insert: "before" }]);
    assert.equal(contents?.createdAt, start);
  });

  it("refuses a snapshot id that belongs to a different document", () => {
    const [saved] = snapshots.listSnapshots("contents");
    assert.ok(saved);
    // Guessing an id from another room must not read that room's history.
    assert.equal(snapshots.snapshotContents("throttle", saved.id), null);
  });

  it("takes the history with the document when the document is deleted", () => {
    const doc = room("doomed");
    doc.getText("quill").insert(0, "temporary");
    snapshots.takeSnapshot("doomed", doc, Date.UTC(2026, 0, 5));
    assert.equal(snapshots.listSnapshots("doomed").length, 1);

    db.delete(schema.documents).where(eq(schema.documents.id, "doomed")).run();
    // The cascade is the database's job, and it only happens because
    // `foreign_keys = ON` is set when the connection opens.
    assert.equal(snapshots.listSnapshots("doomed").length, 0);
  });
});
