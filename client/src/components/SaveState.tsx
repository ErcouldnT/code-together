import { t } from "../i18n";
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
  saving: t("save.saving"),
  saved: t("save.saved"),
  offline: t("save.offline"),
};

export default function SaveStateBadge({ state, onThisDevice }: Props) {
  const detail = state === "offline"
    ? onThisDevice
      ? t("save.offlineKept")
      : t("save.offlineNotKept")
    : state === "saving"
      ? t("save.savingHint")
      : t("save.savedHint");

  return (
    <span className="savestate" data-state={state} role="status" title={detail}>
      {LABEL[state]}
    </span>
  );
}
