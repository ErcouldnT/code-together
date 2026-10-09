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
import { accessFor } from "./access.js";
import { isAdminRequest } from "./auth.js";
import { env } from "./env.js";
import { expireDocument, isOverdue, isTombstoned, type ExpiryEvents } from "./expiry.js";
import { limits } from "./settings.js";
import { originOf, type Origin } from "./geo.js";
import { joinRoom, leaveRoom, noteEdit, ROOM_ID, whenSaved, type Room } from "./rooms.js";

interface SocketData {
  room?: Room;
  /**
   * Whether this socket may change the room it is in. Decided at join from the
   * handshake's cookies, which is why unlocking means reconnecting.
   */
  canWrite: boolean;
  /**
   * The Yjs client ids this socket has announced. Kept so a disconnect can
   * clear exactly this person's cursor and nobody else's — without it, a
   * closed tab leaves a ghost sitting in the document forever.
   */
  awarenessClients: Set<number>;
  /** a signed-in admin, who may open every document — decided at the handshake */
  admin: boolean;
  /** the address and country this socket connected from */
  origin: Origin;
  /** fixed-window counter behind the `updateBurst` limit */
  updates: number;
  windowStart: number;
}

export type IoServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

function withinRate(socket: AppSocket): boolean {
  const now = Date.now();
  const { updateBurst, updateWindowMs } = limits();
  if (now - socket.data.windowStart >= updateWindowMs) {
    socket.data.windowStart = now;
    socket.data.updates = 0;
  }
  socket.data.updates += 1;
  return socket.data.updates <= updateBurst;
}

/**
 * Apply one update and pass it on.
 *
 * The bytes are relayed exactly as they arrived rather than re-encoded from the
 * server's document. Yjs updates are idempotent and commutative, so every peer
 * converges on the same state whichever order they land in, and re-encoding
 * would only cost CPU and risk sending back more than the sender needs.
 */
function ingest(socket: AppSocket, update: unknown, ack?: () => void): void {
  const room = socket.data.room;
  const reject = (reason: UpdateRejection): void => {
    socket.emit("update-rejected", reason);
  };
  if (!room) return reject("not-joined");
  if (!ArrayBuffer.isView(update)) return;

  const bytes = new Uint8Array(update.buffer, update.byteOffset, update.byteLength);
  if (!socket.data.canWrite) {
    // Every join answers the server's state vector with an update, and for a
    // reader that update is empty. Acknowledge that one: refusing it would
    // leave the reader's tab believing it holds unsaved work it never wrote.
    if (ack && isEmptyUpdate(bytes)) return ack();
    return reject("read-only");
  }
  if (bytes.byteLength > env.maxUpdateBytes) return reject("too-large");
  if (!withinRate(socket)) return reject("too-fast");
  if (room.bytes > limits().maxDocumentBytes) return reject("document-full");

  // Whether it changed anything: every join sends an update, usually empty,
  // and only a real change counts as an edit for the admin screen.
  let changed = false;
  const mark = () => {
    changed = true;
  };
  room.doc.on("update", mark);
  try {
    Y.applyUpdate(room.doc, bytes, socket.id);
  }
  catch {
    // a malformed update is a broken or hostile client, not a server error
    return reject("too-large");
  }
  finally {
    room.doc.off("update", mark);
  }
  if (changed) noteEdit(room, socket.data.origin);
  socket.broadcast.to(room.id).emit("update", bytes);
  // Only once it is on disk. A refused update is never acknowledged at all:
  // the client is meant to go on considering it unsaved, because it is.
  if (ack) whenSaved(room, ack);
}

export function attachSockets(httpServer: HttpServer): IoServer {
  const io: IoServer = new Server(httpServer, {
    // Coolify's Traefik terminates TLS in front of us and upgrades websockets fine,
    // but keep polling as a fallback for clients behind hostile proxies.
    transports: ["websocket", "polling"],
    maxHttpBufferSize: env.maxUpdateBytes + 1024,
  });

  // The session lookup is asynchronous and the join is not, so it happens
  // once, here, for the life of the connection — as the cookies do.
  io.use((socket, next) => {
    void isAdminRequest(socket.handshake.headers).then((admin) => {
      socket.data.admin = admin;
      next();
    });
  });

  io.on("connection", (socket) => {
    socket.data.awarenessClients = new Set();
    socket.data.canWrite = false;
    socket.data.updates = 0;
    socket.data.windowStart = Date.now();
    socket.data.origin = originOf(socket.handshake.headers, socket.handshake.address);

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

      // An address whose document expired is refused outright — a browser
      // holding a copy would otherwise upload it straight back. One that is
      // overdue but not yet swept is expired here and now.
      if (isTombstoned(documentId) || (isOverdue(documentId) && expireDocument(documentId, roomEvents(io)))) {
        socket.emit("join-error", "expired");
        return;
      }

      const access = accessFor(documentId, socket.handshake.headers.cookie, socket.data.admin);
      if (!access.read) {
        socket.emit("join-error", "locked");
        return;
      }
      socket.data.canWrite = access.write;

      const room = joinRoom(documentId, socket.id, socket.data.origin);
      if (room.bytes > limits().maxDocumentBytes) {
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

    socket.on("sync-step-2", (update, ack) => ingest(socket, update, ack));
    socket.on("update", (update, ack) => ingest(socket, update, ack));

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

/**
 * What happens to a room when its document's expiry moves or arrives.
 *
 * An expired room is told first and closed a moment later. The client puts
 * its document away on hearing it, which disconnects it anyway; the server
 * closing the sockets is the backstop for a client that does not, and the
 * delay lets the message get out ahead of the close.
 */
export function roomEvents(io: IoServer): ExpiryEvents {
  return {
    expired: (documentId) => {
      io.to(documentId).emit("join-error", "expired");
      setTimeout(() => io.in(documentId).disconnectSockets(true), 1000).unref();
    },
    changed: (documentId, expiresAt) => {
      io.to(documentId).emit("expiry-changed", expiresAt);
    },
  };
}

/** An update that changes nothing: no new items and nothing deleted. */
function isEmptyUpdate(bytes: Uint8Array): boolean {
  try {
    const { structs, ds } = Y.decodeUpdate(bytes);
    return structs.length === 0 && ds.clients.size === 0;
  }
  catch {
    return false;
  }
}

/** Socket.io hands binary over as a Buffer; Yjs wants a plain view of it. */
function asStateVector(value: unknown): Uint8Array | undefined {
  if (!ArrayBuffer.isView(value)) return undefined;
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}
