import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { io as connectSocket, type Socket } from "socket.io-client";
import * as Y from "yjs";
import type { ClientToServerEvents, ServerToClientEvents } from "../shared/events.js";
import { TEXT_KEY } from "../shared/ydoc.js";
import { SocketProvider } from "../client/src/yjs/socketProvider.ts";

/**
 * The tests drive the real client provider against the real server over a real
 * socket. Nothing here is a mock: the bugs this suite exists for — divergence
 * under concurrent edits, and a reconnect that silently stops sending — only
 * exist in the interaction between the two halves, so a stubbed half would
 * prove nothing.
 *
 * `client/src/yjs/socketProvider.ts` is importable from Node because every one
 * of its browser-side imports is `import type`, and those are erased.
 *
 * Yjs prints "Yjs was already imported" when this suite runs, and that is
 * correct rather than a problem: the provider resolves `yjs` from
 * `client/node_modules` and the server from the root one, so two copies are
 * loaded. They are the same version and they only ever exchange encoded bytes
 * — which is exactly the arrangement in production, a browser copy talking to a
 * server copy. Sharing one instance here would make the test *less* faithful.
 */

let dbDir: string | undefined;

/**
 * Must run before anything imports the database module, which opens the file at
 * import time. Node's test runner gives each file its own process, so one call
 * per file is right.
 */
export function useTemporaryDatabase(): string {
  dbDir ??= mkdtempSync(join(tmpdir(), "together-test-"));
  process.env.DATABASE_PATH = join(dbDir, "test.db");
  return process.env.DATABASE_PATH;
}

export interface TestServer {
  url: string;
  /** Drop every in-memory room, flushing to SQLite — what a restart does. */
  restart: () => Promise<void>;
  close: () => Promise<void>;
}

export async function startServer(): Promise<TestServer> {
  useTemporaryDatabase();
  const { runMigrations } = await import("../src/db/index.js");
  runMigrations();
  const { attachSockets } = await import("../src/sockets.js");
  const { closeAllRooms } = await import("../src/rooms.js");

  let http: HttpServer = createServer();
  let io = attachSockets(http);
  await new Promise<void>((resolve) => http.listen(0, resolve));
  const port = (http.address() as AddressInfo).port;

  async function stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      void io.close(() => http.close(() => resolve()));
    });
    closeAllRooms();
  }

  return {
    url: `http://localhost:${port}`,
    async restart() {
      await stop();
      http = createServer();
      io = attachSockets(http);
      // the same port, so clients reconnect to the server they were talking to
      await new Promise<void>((resolve) => http.listen(port, resolve));
    },
    close: stop,
  };
}

export interface TestClient {
  provider: SocketProvider;
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  text: Y.Text;
  rejections: string[];
  disconnect: () => Promise<void>;
  reconnect: () => Promise<void>;
  destroy: () => void;
}

/** A connected, fully synced participant. */
export async function connectClient(url: string, room: string): Promise<TestClient> {
  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = connectSocket(url, {
    transports: ["websocket"],
    forceNew: true,
  });
  const rejections: string[] = [];

  let markSynced = (): void => {};
  const synced = new Promise<void>((resolve) => {
    markSynced = resolve;
  });

  const provider = new SocketProvider(socket, room, {
    onStatus: (status) => {
      if (status === "synced") markSynced();
    },
    onRejected: (reason) => rejections.push(reason),
    onJoinError: (reason) => rejections.push(reason),
  });

  await synced;

  return {
    provider,
    socket,
    rejections,
    text: provider.doc.getText(TEXT_KEY),
    disconnect: () =>
      new Promise<void>((resolve) => {
        socket.once("disconnect", () => resolve());
        socket.disconnect();
      }),
    reconnect: () =>
      new Promise<void>((resolve) => {
        socket.once("connect", () => setTimeout(resolve, 150));
        socket.connect();
      }),
    destroy: () => {
      provider.destroy();
      socket.disconnect();
    },
  };
}

/** Let every queued socket message land. */
export function settle(ms = 150): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function cleanupDatabase(): void {
  if (dbDir) rmSync(dbDir, { recursive: true, force: true });
}
