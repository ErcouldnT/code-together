import type { SaveState as State } from "../useQuill";

/**
 * Whether the document is anywhere other than this tab yet.
 *
 * The notice bar above says nothing while everything works, which is right for
 * an error channel and wrong for this question: "was that saved?" is asked
 * precisely when nothing is wrong. So this one is always present, and the word
 * changes rather than the row appearing and disappearing under the title.
 */

interface Props {
  state: State;
  /** whether an offline copy exists, which decides what "Offline" costs */
  onThisDevice: boolean;
}

const LABEL: Record<State, string> = {
  saving: "Saving…",
  saved: "Saved",
  offline: "Offline",
};

export default function SaveStateBadge({ state, onThisDevice }: Props) {
  const detail = state === "offline"
    ? onThisDevice
      ? "Not sent yet — kept on this device until the connection returns."
      : "Not sent yet, and this browser cannot keep a local copy. Leave this tab open."
    : state === "saving"
      ? "Your changes are on their way to the server."
      : "Written to the server.";

  return (
    <span className="savestate" data-state={state} role="status" title={detail}>
      {LABEL[state]}
    </span>
  );
}
