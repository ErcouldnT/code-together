import {
  applyAwarenessUpdate,
  Awareness,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import * as Y from "yjs";
import type { JoinErrorReason, UpdateRejection } from "@shared/events";
import type { AppSocket } from "../socket";

/**
 * Binds a `Y.Doc` and its awareness to the Socket.io connection the app already
 * has. Everything about reconnection lives here.
 *
 * Why not `y-websocket`: its version 3 no longer ships a server, and the server
 * that replaced it depends on a Yjs 14 prerelease while `y-quill` wants Yjs 13.
 * Carrying updates over the existing socket keeps one Yjs in the tree, keeps a
 * single websocket path through Cloudflare and Traefik — the one already proven
 * to work — and adds no second endpoint to operate.
 */

export type ProviderStatus = "connecting" | "syncing" | "synced" | "offline";

export interface ProviderEvents {
  onStatus?: (status: ProviderStatus) => void;
  /** true while this browser holds changes the server has not saved */
  onUnsaved?: (unsaved: boolean) => void;
  onJoinError?: (reason: JoinErrorReason) => void;
  onRejected?: (reason: UpdateRejection) => void;
}

export class SocketProvider {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;

  #socket: AppSocket;
  #documentId: string;
  #events: ProviderEvents;
  #destroyed = false;
  /** local updates emitted but not yet acknowledged as saved */
  #inFlight = 0;
  /** edits made with the socket down, which are not even on their way */
  #offline = false;
  #unsaved = false;

  constructor(socket: AppSocket, documentId: string, events: ProviderEvents = {}) {
    this.#socket = socket;
    this.#documentId = documentId;
    this.#events = events;
    this.doc = new Y.Doc();
    this.awareness = new Awareness(this.doc);

    socket.on("connect", this.#onConnect);
    socket.on("disconnect", this.#onDisconnect);
    socket.on("sync-step-1", this.#onSyncStep1);
    socket.on("sync-step-2", this.#onSyncStep2);
    socket.on("update", this.#onRemoteUpdate);
    socket.on("awareness", this.#onRemoteAwareness);
    socket.on("join-error", this.#onJoinError);
    socket.on("update-rejected", this.#onRejected);

    this.doc.on("update", this.#onLocalUpdate);
    this.awareness.on("update", this.#onLocalAwareness);

    this.#status(socket.connected ? "syncing" : "connecting");
    if (socket.connected) this.#join();
  }

  #status(status: ProviderStatus): void {
    this.#events.onStatus?.(status);
  }

  /** Is there work in this tab that closing it would lose? */
  get unsaved(): boolean {
    return this.#unsaved;
  }

  #settle(): void {
    const unsaved = this.#offline || this.#inFlight > 0;
    if (unsaved === this.#unsaved) return;
    this.#unsaved = unsaved;
    this.#events.onUnsaved?.(unsaved);
  }

  /**
   * Ask for the difference, not the document.
   *
   * The state vector says what we already have, so a reconnect after a dropped
   * wifi downloads only what changed while we were gone — and, just as
   * importantly, the reply is what tells us what to send *up*.
   */
  #join(): void {
    this.#status("syncing");
    this.#socket.emit("join", this.#documentId, Y.encodeStateVector(this.doc));
  }

  #onConnect = (): void => {
    this.#join();
  };

  #onDisconnect = (): void => {
    this.#status("offline");
    // Acknowledgements for anything still in flight died with the socket, so
    // those changes go back to being unsaved until the next handshake lands.
    if (this.#inFlight > 0) this.#offline = true;
    this.#inFlight = 0;
    this.#settle();
    // Remote cursors belong to people we can no longer hear from. Left on
    // screen they are a lie that gets worse the longer the outage lasts.
    const remote = [...this.awareness.getStates().keys()].filter(
      (id) => id !== this.doc.clientID,
    );
    removeAwarenessStates(this.awareness, remote, this);
  };

  #onSyncStep1 = (stateVector: Uint8Array): void => {
    // What the server is missing, which after an offline stretch is every edit
    // made while disconnected, merged into one update.
    // This one update carries everything written while offline, so its
    // acknowledgement is what clears the offline backlog.
    this.#inFlight += 1;
    this.#settle();
    this.#socket.emit(
      "sync-step-2",
      Y.encodeStateAsUpdate(this.doc, new Uint8Array(stateVector)),
      () => {
        this.#offline = false;
        this.#inFlight = Math.max(0, this.#inFlight - 1);
        this.#settle();
      },
    );
  };

  #onSyncStep2 = (update: Uint8Array): void => {
    Y.applyUpdate(this.doc, new Uint8Array(update), this);
    this.#status("synced");
  };

  #onRemoteUpdate = (update: Uint8Array): void => {
    Y.applyUpdate(this.doc, new Uint8Array(update), this);
  };

  #onRemoteAwareness = (update: Uint8Array): void => {
    applyAwarenessUpdate(this.awareness, new Uint8Array(update), this);
  };

  #onJoinError = (reason: JoinErrorReason): void => {
    this.#events.onJoinError?.(reason);
  };

  #onRejected = (reason: UpdateRejection): void => {
    this.#events.onRejected?.(reason);
  };

  /**
   * `origin === this` means the change arrived from the network and is already
   * everywhere; echoing it back would be a loop.
   *
   * While disconnected nothing is emitted at all. Socket.io would happily
   * buffer the emits and replay them on reconnect, but the `join` handshake
   * already carries those edits as one merged update — buffering would send
   * the same work twice, in more packets.
   */
  #onLocalUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === this) return;
    if (!this.#socket.connected) {
      this.#offline = true;
      this.#settle();
      return;
    }
    this.#inFlight += 1;
    this.#settle();
    this.#socket.emit("update", update, () => {
      this.#inFlight = Math.max(0, this.#inFlight - 1);
      this.#settle();
    });
  };

  #onLocalAwareness = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    if (origin === this || !this.#socket.connected) return;
    const changed = [...added, ...updated, ...removed];
    if (changed.length === 0) return;
    this.#socket.emit("awareness", encodeAwarenessUpdate(this.awareness, changed));
  };

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;

    // Say goodbye while the socket is still open, so the others drop this
    // cursor now rather than 30 seconds from now when awareness times it out.
    if (this.#socket.connected) {
      this.awareness.setLocalState(null);
    }

    this.#socket.off("connect", this.#onConnect);
    this.#socket.off("disconnect", this.#onDisconnect);
    this.#socket.off("sync-step-1", this.#onSyncStep1);
    this.#socket.off("sync-step-2", this.#onSyncStep2);
    this.#socket.off("update", this.#onRemoteUpdate);
    this.#socket.off("awareness", this.#onRemoteAwareness);
    this.#socket.off("join-error", this.#onJoinError);
    this.#socket.off("update-rejected", this.#onRejected);

    this.doc.off("update", this.#onLocalUpdate);
    this.awareness.off("update", this.#onLocalAwareness);

    this.awareness.destroy();
    this.doc.destroy();
  }
}
