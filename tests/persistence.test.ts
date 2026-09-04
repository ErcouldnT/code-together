import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupDatabase, connectClient, settle, startServer, type TestServer } from "./helpers.ts";

describe("persistence", () => {
  let server: TestServer;

  before(async () => {
    server = await startServer();
  });

  after(async () => {
    await server.close();
    cleanupDatabase();
  });

  it("keeps a document across a restart", async () => {
    const a = await connectClient(server.url, "keep1");
    a.text.insert(0, "written before the restart");
    await settle();
    a.destroy();
    await settle();

    // Drops every in-memory room after flushing, which is what a redeploy does.
    // If the room were only in memory, the next join would find nothing.
    await server.restart();

    const b = await connectClient(server.url, "keep1");
    await settle();
    assert.equal(b.text.toString(), "written before the restart");
    b.destroy();
  });

  it("seeds a pre-Yjs room from its Quill delta the first time it is opened", async () => {
    const { db } = await import("../src/db/index.js");
    const { documents } = await import("../src/db/schema.js");

    // Exactly the shape the old server wrote: a delta, and no ystate.
    db.insert(documents)
      .values({ id: "legacy", data: { ops: [{ insert: "from the old world\n" }] } })
      .run();

    const a = await connectClient(server.url, "legacy");
    await settle();
    assert.equal(a.text.toString(), "from the old world\n");

    // and the seed must survive on its own, not only in this room's memory
    a.text.insert(0, "still here: ");
    await settle();
    a.destroy();
    await settle();
    await server.restart();

    const b = await connectClient(server.url, "legacy");
    await settle();
    assert.equal(b.text.toString(), "still here: from the old world\n");
    b.destroy();
  });

  it("never destroys the legacy delta while seeding", async () => {
    const { db } = await import("../src/db/index.js");
    const { documents } = await import("../src/db/schema.js");
    const { eq } = await import("drizzle-orm");

    const row = db.select().from(documents).where(eq(documents.id, "legacy")).get();
    assert.ok(row?.ystate && row.ystate.length > 0, "the Yjs state should now exist");
    assert.deepEqual(
      row?.data,
      { ops: [{ insert: "from the old world\n" }] },
      "and the only other copy of the contents must still be there",
    );
  });
});
