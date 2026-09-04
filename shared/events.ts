/**
 * Wire contract shared by the Express/Socket.io server and the React client.
 * Types only — this module emits no runtime code.
 */

/** A single operation inside a Quill delta. */
export interface DeltaOp {
  insert?: string | Record<string, unknown>;
  delete?: number;
  retain?: number;
  attributes?: Record<string, unknown>;
}

/** The contents of a document, i.e. a Quill delta. */
export interface DocumentData {
  ops: DeltaOp[];
}

export interface ServerToClientEvents {
  "load-document": (data: DocumentData) => void;
  "receive-changes": (delta: DeltaOp[] | DocumentData) => void;
}

export interface ClientToServerEvents {
  "get-document": (documentId: string) => void;
  "send-changes": (delta: DeltaOp[] | DocumentData) => void;
  "save-document": (data: DocumentData) => void;
}
