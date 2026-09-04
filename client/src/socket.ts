import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@shared/events";

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Same origin in every environment — Vite proxies /socket.io to the API in dev. */
export function connect(): AppSocket {
  return io({ transports: ["websocket", "polling"] });
}
