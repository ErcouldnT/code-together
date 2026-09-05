import { createPortal } from "react-dom";
import { useParams } from "react-router-dom";
import ConnectionStatus from "./components/ConnectionStatus";
import PresenceBar from "./components/PresenceBar";
import { useQuill } from "./useQuill";

export default function Editor() {
  const { id: documentId } = useParams<{ id: string }>();
  const { containerRef, status, problem, uploading, provider, toolbar, identity, rename }
    = useQuill(documentId);

  return (
    <>
      <ConnectionStatus status={status} problem={problem} uploading={uploading} />
      <div className="container" ref={containerRef} />
      {toolbar
        && createPortal(
          <PresenceBar provider={provider} identity={identity} onRename={rename} />,
          toolbar,
        )}
    </>
  );
}
