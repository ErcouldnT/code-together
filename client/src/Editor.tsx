import { useParams } from "react-router-dom";
import { useQuill } from "./useQuill";

const STATUS_TEXT = {
  connecting: "Connecting…",
  syncing: "Syncing…",
  synced: null,
  offline: "Offline — your changes will be sent when the connection returns.",
} as const;

export default function Editor() {
  const { id: documentId } = useParams<{ id: string }>();
  const { containerRef, status, problem } = useQuill(documentId);

  // Only shown when there is something to say. A silently broken connection is
  // the failure this whole rewrite is about; saying nothing while synced is the
  // other half of being honest about it.
  const notice = problem ?? STATUS_TEXT[status];

  return (
    <>
      {notice && (
        <p className="notice" role="status" data-kind={problem ? "problem" : "info"}>
          {notice}
        </p>
      )}
      <div className="container" ref={containerRef} />
    </>
  );
}
