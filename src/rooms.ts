import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { recordEdits, tally, type EditTally } from "./activity.js";
import { loadDocument, saveDocument } from "./documents.js";
import type { Origin } from "./geo.js";
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
  /** who has changed it since the last save — see activity.ts */
  edits: Map<string, EditTally>;
  dirty: boolean;
  /** callers waiting for the next write to disk — see `whenSaved` */
  waiting: (() => void)[];
}

const rooms = new Map<string, RoomState>();

function flush(room: RoomState): void {
  if (room.saveTimer) {
    clearTimeout(room.saveTimer);
    room.saveTimer = null;
  }
  if (!room.dirty) {
    release(room);
    return;
  }
  room.dirty = false;
  saveDocument(room.id, room.doc);
  if (room.edits.size > 0) {
    recordEdits(room.id, room.edits);
    room.edits.clear();
  }
  room.bytes = Y.encodeStateAsUpdate(room.doc).byteLength;
  // Hangs off the save rather than a timer of its own: a document nobody is
  // editing is never saved, so it never accumulates identical snapshots.
  takeSnapshot(room.id, room.doc);
  release(room);
}

/** Everyone who was waiting for this write now has it. */
function release(room: RoomState): void {
  const waiting = room.waiting.splice(0);
  for (const done of waiting) done();
}

/**
 * Call back once the document has been written to disk.
 *
 * The client uses this to know whether closing the tab would lose anything, so
 * it has to mean *saved*, not *received*: a room is dirty for up to
 * `SAVE_INTERVAL_MS` after an update lands, and a crash inside that window
 * loses it. If nothing is pending the callback runs immediately.
 */
export function whenSaved(room: Room, done: () => void): void {
  const state = rooms.get(room.id);
  if (!state || !state.dirty) {
    done();
    return;
  }
  state.waiting.push(done);
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

function openRoom(id: string, opener?: Origin): RoomState {
  const { doc, seeded } = loadDocument(id, opener);
  const room: RoomState = {
    id,
    doc,
    awareness: new Awareness(doc),
    members: new Set(),
    bytes: Y.encodeStateAsUpdate(doc).byteLength,
    saveTimer: null,
    edits: new Map(),
    dirty: false,
    waiting: [],
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

export function joinRoom(id: string, socketId: string, origin?: Origin): Room {
  const room = rooms.get(id) ?? openRoom(id, origin);
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
 * Drop a room from memory without saving it — for a document that has just
 * been deleted. A final flush here would write the text back into a row that
 * is gone (a no-op) and a snapshot that refers to it (a foreign-key failure).
 * Whoever was waiting for a save is released: there will not be one.
 */
export function discardRoom(id: string): void {
  const room = rooms.get(id);
  if (!room) return;
  if (room.saveTimer) clearTimeout(room.saveTimer);
  room.dirty = false;
  rooms.delete(id);
  release(room);
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

/** Count one change from `origin`, to be written with the next save. */
export function noteEdit(room: Room, origin: Origin): void {
  const state = rooms.get(room.id);
  if (state) tally(state.edits, origin);
}

/** Who is in each open room, by room id. */
export function roomMembers(): Map<string, number> {
  return new Map([...rooms.values()].map((room) => [room.id, room.members.size]));
}

/** Present so tests and the shutdown path can see the registry. */
export function activeRooms(): number {
  return rooms.size;
}

/**
 * What the registry is holding, for the health check.
 *
 * Rooms and editors are the two numbers that say whether this process is busy
 * or wedged; `unsaved` is the one that says whether it is *behind*, and a
 * number that does not fall back to zero is the first sign the save path has
 * stopped running.
 */
export function roomStats(): { rooms: number; editors: number; unsaved: number } {
  let editors = 0;
  let unsaved = 0;
  for (const room of rooms.values()) {
    editors += room.members.size;
    if (room.dirty) unsaved += 1;
  }
  return { rooms: rooms.size, editors, unsaved };
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
