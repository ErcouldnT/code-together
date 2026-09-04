import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "../shared/events.js";
import { findOrCreateDocument, saveDocument } from "./documents.js";

export type IoServer = Server<ClientToServerEvents, ServerToClientEvents>;

export function attachSockets(httpServer: HttpServer): IoServer {
  const io: IoServer = new Server(httpServer, {
    // Coolify's Traefik terminates TLS in front of us and upgrades websockets fine,
    // but keep polling as a fallback for clients behind hostile proxies.
    transports: ["websocket", "polling"],
  });

  io.on("connection", (socket) => {
    socket.on("get-document", (documentId) => {
      if (typeof documentId !== "string" || documentId.length === 0) return;

      const data = findOrCreateDocument(documentId);
      socket.join(documentId);
      socket.emit("load-document", data);

      socket.on("send-changes", (delta) => {
        socket.broadcast.to(documentId).emit("receive-changes", delta);
      });

      socket.on("save-document", (data) => {
        saveDocument(documentId, data);
      });
    });
  });

  return io;
}
