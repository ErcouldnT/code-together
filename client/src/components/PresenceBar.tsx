import { useState } from "react";
import { initials, type Identity } from "../identity";
import { usePresence } from "../presence";
import type { SocketProvider } from "../yjs/socketProvider";

/**
 * Who is in the room, as a row of coloured initials.
 *
 * Your own chip is a button: clicking it lets you change the name everyone
 * else sees on your cursor. That is the only place identity can be edited,
 * because it is the only place it is visible.
 */

interface Props {
  provider: SocketProvider | null;
  identity: Identity;
  onRename: (name: string) => void;
}

export default function PresenceBar({ provider, identity, onRename }: Props) {
  const peers = usePresence(provider);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(identity.name);

  function commit() {
    setEditing(false);
    const name = draft.trim().slice(0, 40);
    // An empty box means "I changed my mind", not "call me nothing".
    if (name && name !== identity.name) onRename(name);
    else setDraft(identity.name);
  }

  if (peers.length === 0) return null;

  return (
    <div className="presence" aria-label="People in this document">
      {editing && (
        <input
          className="presence-name"
          value={draft}
          autoFocus
          maxLength={40}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
            if (event.key === "Escape") {
              setDraft(identity.name);
              setEditing(false);
            }
          }}
        />
      )}
      {peers.map((peer) => (
        <button
          key={peer.clientId}
          type="button"
          className="presence-chip"
          style={{ backgroundColor: peer.color }}
          // The name is the accessible label because the chip itself shows two
          // letters; a screen reader reading "QO" would be telling nobody
          // anything.
          title={peer.self ? `${peer.name} (you) — click to rename` : peer.name}
          aria-label={peer.self ? `${peer.name}, you. Rename yourself.` : peer.name}
          data-self={peer.self || undefined}
          disabled={!peer.self}
          onClick={() => {
            setDraft(identity.name);
            setEditing(true);
          }}
        >
          {initials(peer.name)}
        </button>
      ))}
    </div>
  );
}
