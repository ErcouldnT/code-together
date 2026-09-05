import type { ProviderStatus } from "../yjs/socketProvider";

/**
 * Says something only when there is something to say.
 *
 * The failure this whole rewrite began with was silent: the connection went,
 * the editor kept accepting keystrokes, and nothing left the machine. Being
 * quiet while everything works is the other half of being honest about that —
 * a permanent "connected" badge trains people to stop reading it.
 */

const STATUS_TEXT: Record<ProviderStatus, string | null> = {
  connecting: "Connecting…",
  syncing: "Syncing…",
  synced: null,
  offline: "Offline — your changes will be sent when the connection returns.",
};

interface Props {
  status: ProviderStatus;
  /** an error, which outranks the connection state */
  problem: string | null;
  uploading: number;
}

export default function ConnectionStatus({ status, problem, uploading }: Props) {
  const uploadingText
    = uploading > 0 ? `Uploading ${uploading} picture${uploading === 1 ? "" : "s"}…` : null;
  const text = problem ?? uploadingText ?? STATUS_TEXT[status];
  if (!text) return null;

  return (
    <p className="notice" role="status" data-kind={problem ? "problem" : "info"}>
      {text}
    </p>
  );
}
