import { createServer } from "node:http";
import { resolve } from "node:path";
import express from "express";
import rateLimit from "express-rate-limit";
import { pinoHttp } from "pino-http";
import { closeDatabase, runMigrations } from "./db/index.js";
import { deleteStaleDocuments } from "./documents.js";
import { env, isProduction } from "./env.js";
import { closeAllRooms } from "./rooms.js";
import { attachSockets } from "./sockets.js";

runMigrations();

const clientDist = resolve(import.meta.dirname, "../../client/dist");

const app = express();
app.disable("x-powered-by");
// Coolify runs us behind its Traefik proxy.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    // The health check runs every 30 s forever; logging it drowns everything
    // that matters. Static assets are the proxy's business, not ours.
    autoLogging: {
      ignore: (req: { url?: string }) =>
        req.url === "/healthz" || req.url?.startsWith("/assets/") === true,
    },
    level: isProduction ? "info" : "debug",
  }),
);

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// The document itself travels over the socket, so this only guards the HTML and
// the asset requests around it — enough to stop a crawler walking the room-id
// space and creating a database row per hit.
app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  }),
);

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
      // Rooms hold the only up-to-date copy of a document that changed within
      // the last save interval. Flushing before the database closes is the
      // difference between a clean redeploy and losing the last two seconds of
      // everyone's typing.
      closeAllRooms();
      closeDatabase();
      process.exit(0);
    });
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
