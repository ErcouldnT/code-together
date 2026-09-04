/**
 * Wire contract shared by the Express/Socket.io server and the React client.
 * Types only — this module emits no runtime code.
 *
 * The document itself is a Yjs CRDT. What crosses the wire is never the text,
 * always an encoded Yjs update: a binary, idempotent, commutative patch. That
 * is what makes reconnection and re-delivery safe — applying the same update
 * twice, or out of order, lands on the same document either way.
 *
 * The sync handshake is Yjs's standard two-step, written out as named events
 * rather than lib0-framed messages. The framing buys nothing here (we are not
 * speaking the y-websocket protocol to anyone else) and costs readability:
 * every message below can be read in a network panel and typed here, so a
 * mismatch between the two sides breaks the build instead of the document.
 */

/** A single operation inside a Quill delta. Legacy: see `LegacyDocumentData`. */
export interface DeltaOp {
  insert?: string | Record<string, unknown>;
  delete?: number;
  retain?: number;
  attributes?: Record<string, unknown>;
}

/**
 * A Quill delta, which is how documents were stored before Yjs.
 * Still read (never written) so existing rooms survive the migration.
 */
export interface LegacyDocumentData {
  ops: DeltaOp[];
}

/** Why the server refused to open a room, in a form the client can show. */
export type JoinErrorReason = "bad-id" | "too-large";

/** Why the server dropped an update instead of applying it. */
export type UpdateRejection = "too-large" | "too-fast" | "document-full" | "not-joined";

export interface ServerToClientEvents {
  /** Step 1: what the server has. The client answers with `sync-step-2`. */
  "sync-step-1": (stateVector: Uint8Array) => void;
  /** Step 2: everything the client was missing, as one update. */
  "sync-step-2": (update: Uint8Array) => void;
  /** Someone else changed the document. */
  "update": (update: Uint8Array) => void;
  /** Presence: who is here, where their cursor is. */
  "awareness": (update: Uint8Array) => void;
  /** The room could not be opened at all. */
  "join-error": (reason: JoinErrorReason) => void;
  /**
   * An update was refused. The client is now behind the server and must say so
   * — silence here is exactly the failure this rewrite exists to remove.
   */
  "update-rejected": (reason: UpdateRejection) => void;
}

export interface ClientToServerEvents {
  /**
   * Open a room. Carries the client's state vector so the server can answer
   * with the difference rather than the whole document — a reconnecting client
   * with a warm document downloads almost nothing.
   */
  "join": (documentId: string, stateVector: Uint8Array) => void;
  /** The client's half of the handshake, and its answer to `sync-step-1`. */
  "sync-step-2": (update: Uint8Array) => void;
  /** A local change. */
  "update": (update: Uint8Array) => void;
  /** Local presence. */
  "awareness": (update: Uint8Array) => void;
}
