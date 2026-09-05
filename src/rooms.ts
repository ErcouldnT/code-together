import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { loadDocument, saveDocument } from "./documents.js";
import { takeSnapshot } from "./snapshots.js";

/**
 * One `Y.Doc` per room, in memory, shared by everyone in it.
 *
 * The old code had no such thing: each socket carried its own copy of the
 * document and the server only relayed. The registry is what lets the server
 * answer a reconnecting client with "here is what you missed" instead of
 * hoping the client still has it.
 *
 * Rooms are reference counted. The last person to leave takes the room with
 * them, after a final save — a server that keeps every document ever opened in
 * memory is a slow leak, and the document is worthless in memory anyway once
 * nobody is reading it.
 */

/**
 * How often a changing document is written to SQLite.
 *
 * A throttle, not a debounce, and the difference matters: a debounce restarts
 * its timer on every keystroke, so somebody typing steadily is never saved at
 * all. This writes at most once per interval and always within one interval of
 * the last change.
 */
const SAVE_INTERVAL_MS = 2000;

/**
 * Room ids come from `nanoid(5)` but reach us straight out of a URL, so they
 * are arbitrary user input. Bounded, and restricted to characters that cannot
 * mean anything to a path or a query. Shared by the socket handshake and the
 * HTTP routes so the two cannot disagree about what a room is called.
 */
export const ROOM_ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface Room {
  readonly id: string;
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  /** socket ids currently in the room */
  readonly members: Set<string>;
  /** encoded size at the last save — see `env.maxDocumentBytes` */
  bytes: number;
}

interface RoomState extends Room {
  saveTimer: NodeJS.Timeout | null;
  dirty: boolean;
}

const rooms = new Map<string, RoomState>();

function flush(room: RoomState): void {
  if (room.saveTimer) {
    clearTimeout(room.saveTimer);
    room.saveTimer = null;
  }
  if (!room.dirty) return;
  room.dirty = false;
  saveDocument(room.id, room.doc);
  room.bytes = Y.encodeStateAsUpdate(room.doc).byteLength;
  // Hangs off the save rather than a timer of its own: a document nobody is
  // editing is never saved, so it never accumulates identical snapshots.
  takeSnapshot(room.id, room.doc);
}

function scheduleSave(room: RoomState): void {
  room.dirty = true;
  if (room.saveTimer) return;
  room.saveTimer = setTimeout(() => {
    room.saveTimer = null;
    flush(room);
  }, SAVE_INTERVAL_MS);
  // a pending save must not hold the process open at shutdown; `closeAllRooms`
  // is what actually gets the last write out
  room.saveTimer.unref?.();
}

function openRoom(id: string): RoomState {
  const { doc, seeded } = loadDocument(id);
  const room: RoomState = {
    id,
    doc,
    awareness: new Awareness(doc),
    members: new Set(),
    bytes: Y.encodeStateAsUpdate(doc).byteLength,
    saveTimer: null,
    dirty: false,
  };
  // The local awareness state belongs to a browser, not to the server. Left in
  // place, the server would announce itself as a participant with no cursor.
  room.awareness.setLocalState(null);
  doc.on("update", () => scheduleSave(room));
  rooms.set(id, room);
  // A seed is a change to the document that produced no update event, because
  // it happened before this listener existed. Left unsaved it would be redone,
  // differently, on every open — see `LoadedDocument.seeded`.
  if (seeded) scheduleSave(room);
  return room;
}

export function joinRoom(id: string, socketId: string): Room {
  const room = rooms.get(id) ?? openRoom(id);
  room.members.add(socketId);
  return room;
}

export function leaveRoom(id: string, socketId: string): void {
  const room = rooms.get(id);
  if (!room) return;
  room.members.delete(socketId);
  if (room.members.size > 0) return;

  flush(room);
  rooms.delete(id);
  room.awareness.destroy();
  room.doc.destroy();
}

/**
 * The live document for a room, if anyone has it open.
 *
 * Reading this rather than the database is worth it for exports: the database
 * copy is up to one save interval behind, and "I exported it and my last
 * sentence was missing" is a bug report.
 */
export function peekRoom(id: string): Room | undefined {
  return rooms.get(id);
}

/** Present so tests and the shutdown path can see the registry. */
export function activeRooms(): number {
  return rooms.size;
}

/** Final write for every open room. Called on SIGTERM, before the DB closes. */
export function closeAllRooms(): void {
  for (const room of rooms.values()) {
    flush(room);
    room.awareness.destroy();
    room.doc.destroy();
  }
  rooms.clear();
}
