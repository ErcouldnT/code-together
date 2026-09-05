import { createPortal } from "react-dom";
import { useParams } from "react-router-dom";
import ConnectionStatus from "./components/ConnectionStatus";
import DocumentSkeleton from "./components/DocumentSkeleton";
import PresenceBar from "./components/PresenceBar";
import { useQuill } from "./useQuill";

export default function Editor() {
  const { id: documentId } = useParams<{ id: string }>();
  const {
    containerRef,
    status,
    problem,
    uploading,
    ready,
    provider,
    toolbar,
    editorArea,
    identity,
    rename,
  } = useQuill(documentId);

  return (
    <>
      {/* One place for status, loading or not: the skeleton is the shape of the
          document, the notice bar is the words about it. */}
      <ConnectionStatus status={status} problem={problem} uploading={uploading} />

      <div className="container" ref={containerRef} />

      {!ready && editorArea && createPortal(<DocumentSkeleton problem={problem} />, editorArea)}

      {toolbar
        && createPortal(
          <PresenceBar provider={provider} identity={identity} onRename={rename} />,
          toolbar,
        )}
    </>
  );
}
