import { useEffect, useState } from "react";
import type { Identity } from "./identity";
import type { SocketProvider } from "./yjs/socketProvider";

/**
 * Who else is in the room, read out of Yjs awareness.
 *
 * Awareness is already on the wire — the server relays it and clears a
 * person's entry when their socket goes — so this is a subscription, not a
 * protocol. What it adds is only the reading of it.
 */

export interface Peer {
  clientId: number;
  name: string;
  color: string;
  /** true for the person at this keyboard */
  self: boolean;
}

function peersOf(provider: SocketProvider): Peer[] {
  const own = provider.doc.clientID;
  const peers: Peer[] = [];

  for (const [clientId, state] of provider.awareness.getStates()) {
    const user = (state as { user?: Partial<Identity> } | undefined)?.user;
    // Somebody who has connected but not yet announced a name. Skipped rather
    // than shown as a blank chip that appears and then changes.
    if (!user?.name || !user.color) continue;
    peers.push({ clientId, name: user.name, color: user.color, self: clientId === own });
  }

  // yourself first, then everyone else in a stable order — a list that
  // reshuffles as people type is unreadable
  return peers.sort((a, b) => Number(b.self) - Number(a.self) || a.clientId - b.clientId);
}

export function usePresence(provider: SocketProvider | null): Peer[] {
  const [peers, setPeers] = useState<Peer[]>([]);

  useEffect(() => {
    if (!provider) {
      setPeers([]);
      return;
    }
    const update = () => setPeers(peersOf(provider));
    update();
    provider.awareness.on("change", update);
    return () => provider.awareness.off("change", update);
  }, [provider]);

  return peers;
}
