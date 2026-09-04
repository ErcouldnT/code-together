import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import {
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import * as Y from "yjs";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  UpdateRejection,
} from "../shared/events.js";
import { env } from "./env.js";
import { joinRoom, leaveRoom, type Room } from "./rooms.js";

/**
 * Room ids come from `nanoid(5)` but reach us straight out of the URL, so they
 * are arbitrary user input. Bounded and restricted to characters that cannot
 * mean anything to a path or a query.
 */
const ROOM_ID = /^[A-Za-z0-9_-]{1,64}$/;

interface SocketData {
  room?: Room;
  /**
   * The Yjs client ids this socket has announced. Kept so a disconnect can
   * clear exactly this person's cursor and nobody else's — without it, a
   * closed tab leaves a ghost sitting in the document forever.
   */
  awarenessClients: Set<number>;
  /** fixed-window counter behind `env.updateBurst` */
  updates: number;
  windowStart: number;
}

export type IoServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

function withinRate(socket: AppSocket): boolean {
  const now = Date.now();
  if (now - socket.data.windowStart >= env.updateWindowMs) {
    socket.data.windowStart = now;
    socket.data.updates = 0;
  }
  socket.data.updates += 1;
  return socket.data.updates <= env.updateBurst;
}

/**
 * Apply one update and pass it on.
 *
 * The bytes are relayed exactly as they arrived rather than re-encoded from the
 * server's document. Yjs updates are idempotent and commutative, so every peer
 * converges on the same state whichever order they land in, and re-encoding
 * would only cost CPU and risk sending back more than the sender needs.
 */
function ingest(socket: AppSocket, update: unknown): void {
  const room = socket.data.room;
  const reject = (reason: UpdateRejection): void => {
    socket.emit("update-rejected", reason);
  };
  if (!room) return reject("not-joined");
  if (!ArrayBuffer.isView(update)) return;

  const bytes = new Uint8Array(update.buffer, update.byteOffset, update.byteLength);
  if (bytes.byteLength > env.maxUpdateBytes) return reject("too-large");
  if (!withinRate(socket)) return reject("too-fast");
  if (room.bytes > env.maxDocumentBytes) return reject("document-full");

  try {
    Y.applyUpdate(room.doc, bytes, socket.id);
  }
  catch {
    // a malformed update is a broken or hostile client, not a server error
    return reject("too-large");
  }
  socket.broadcast.to(room.id).emit("update", bytes);
}

export function attachSockets(httpServer: HttpServer): IoServer {
  const io: IoServer = new Server(httpServer, {
    // Coolify's Traefik terminates TLS in front of us and upgrades websockets fine,
    // but keep polling as a fallback for clients behind hostile proxies.
    transports: ["websocket", "polling"],
    maxHttpBufferSize: env.maxUpdateBytes + 1024,
  });

  io.on("connection", (socket) => {
    socket.data.awarenessClients = new Set();
    socket.data.updates = 0;
    socket.data.windowStart = Date.now();

    /**
     * Remembers which awareness client ids belong to this socket.
     *
     * Registered per socket on a shared object, so it has to come off again on
     * disconnect — that is what `detach` below is for.
     */
    let detachAwareness: (() => void) | null = null;

    // Every listener is registered here, once, for the lifetime of the socket.
    // The bug this replaces registered `send-changes` and `save-document`
    // *inside* the join handler: a reconnecting client got a fresh socket, never
    // re-sent `get-document`, and so had no listeners at all. It kept typing and
    // nothing left the machine, silently.
    socket.on("join", (documentId, stateVector) => {
      if (typeof documentId !== "string" || !ROOM_ID.test(documentId)) {
        socket.emit("join-error", "bad-id");
        return;
      }
      if (socket.data.room) {
        if (socket.data.room.id === documentId) return;
        leaveSocketRoom(socket);
      }

      const room = joinRoom(documentId, socket.id);
      if (room.bytes > env.maxDocumentBytes) {
        leaveRoom(documentId, socket.id);
        socket.emit("join-error", "too-large");
        return;
      }

      socket.data.room = room;
      void socket.join(documentId);

      const track = (
        { added, removed }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        if (origin !== socket.id) return;
        for (const id of added) socket.data.awarenessClients.add(id);
        for (const id of removed) socket.data.awarenessClients.delete(id);
      };
      room.awareness.on("update", track);
      detachAwareness = () => room.awareness.off("update", track);

      // Two-way sync in one round trip: here is what you are missing, and here
      // is what I have so you can tell me what I am missing.
      let missing: Uint8Array;
      try {
        missing = Y.encodeStateAsUpdate(room.doc, asStateVector(stateVector));
      }
      catch {
        // an unreadable state vector means "assume they have nothing"
        missing = Y.encodeStateAsUpdate(room.doc);
      }
      socket.emit("sync-step-2", missing);
      socket.emit("sync-step-1", Y.encodeStateVector(room.doc));

      const present = [...room.awareness.getStates().keys()];
      if (present.length > 0) {
        socket.emit("awareness", encodeAwarenessUpdate(room.awareness, present));
      }
    });

    socket.on("sync-step-2", (update) => ingest(socket, update));
    socket.on("update", (update) => ingest(socket, update));

    socket.on("awareness", (update) => {
      const room = socket.data.room;
      if (!room || !ArrayBuffer.isView(update)) return;
      const bytes = new Uint8Array(update.buffer, update.byteOffset, update.byteLength);
      if (bytes.byteLength > env.maxUpdateBytes) return;
      try {
        applyAwarenessUpdate(room.awareness, bytes, socket.id);
      }
      catch {
        return;
      }
      socket.broadcast.to(room.id).emit("awareness", bytes);
    });

    function leaveSocketRoom(s: AppSocket): void {
      const room = s.data.room;
      if (!room) return;
      detachAwareness?.();
      detachAwareness = null;

      const ids = [...s.data.awarenessClients];
      if (ids.length > 0) {
        // Clear the cursor first, then tell the room — encoded *after* removal,
        // which is what makes it a "this client is gone" message rather than a
        // repeat of their last position.
        removeAwarenessStates(room.awareness, ids, null);
        io.to(room.id).emit("awareness", encodeAwarenessUpdate(room.awareness, ids));
        s.data.awarenessClients.clear();
      }
      s.data.room = undefined;
      leaveRoom(room.id, s.id);
    }

    socket.on("disconnect", () => leaveSocketRoom(socket));
  });

  return io;
}

/** Socket.io hands binary over as a Buffer; Yjs wants a plain view of it. */
function asStateVector(value: unknown): Uint8Array | undefined {
  if (!ArrayBuffer.isView(value)) return undefined;
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}
