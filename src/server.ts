import { createServer } from "node:http";
import { resolve } from "node:path";
import express from "express";
import { closeDatabase, runMigrations } from "./db/index.js";
import { deleteStaleDocuments } from "./documents.js";
import { env } from "./env.js";
import { attachSockets } from "./sockets.js";

runMigrations();

const clientDist = resolve(import.meta.dirname, "../../client/dist");

const app = express();
app.disable("x-powered-by");
// Coolify runs us behind its Traefik proxy.
app.set("trust proxy", 1);

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.use(express.static(clientDist));

// Every other path is a document room; the SPA router resolves it.
app.use((_req, res) => {
  res.sendFile(resolve(clientDist, "index.html"));
});

const httpServer = createServer(app);
const io = attachSockets(httpServer);

const cleanup = env.documentTtlDays > 0
  ? setInterval(() => {
      const removed = deleteStaleDocuments(env.documentTtlDays);
      if (removed > 0) console.log(`Pruned ${removed} stale document(s).`);
    }, 60 * 60 * 1000)
  : undefined;
cleanup?.unref();

httpServer.listen(env.port, () => {
  console.log(`Listening on port ${env.port} (${env.nodeEnv})`);
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down.`);

  if (cleanup) clearInterval(cleanup);
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();

  void io.close(() => {
    httpServer.close(() => {
      closeDatabase();
      process.exit(0);
    });
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
