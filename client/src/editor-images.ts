import { Delta, type default as Quill } from "quill";
import * as Y from "yjs";
import { upload, UploadError } from "./uploads";

/**
 * Pictures in the document: pasted, dropped, or chosen from the toolbar.
 *
 * All three go through Quill's own `uploader` module rather than through
 * listeners of ours racing Quill's. Quill's clipboard already routes pasted
 * files to `uploader.upload()`, and the uploader itself owns the `drop`
 * listener, so replacing its handler is the supported way in — and the only
 * way that cannot lose the race and let the default base64 handler win.
 *
 * What the default handler does is exactly what this feature exists to stop:
 * it reads the file as a data URL and inserts it into the text. In a Yjs
 * document that embedded blob is broadcast to everyone in the room on every
 * edit and rewritten to SQLite on every save.
 */

/** What Quill's uploader will hand us. Deliberately wider than the server accepts. */
export const IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif",
];

export interface Inserter {
  /** Upload, then place the pictures where the caret was when this was called. */
  insert: (files: File[]) => Promise<void>;
  /** Open a file picker and insert whatever comes back. */
  choose: () => void;
}

export interface InserterOptions {
  quill: Quill;
  doc: Y.Doc;
  text: Y.Text;
  onBusy: (uploading: number) => void;
  onError: (message: string | null) => void;
}

export function createInserter({ quill, doc, text, onBusy, onError }: InserterOptions): Inserter {
  let uploading = 0;

  async function insert(files: File[]): Promise<void> {
    if (files.length === 0) return;
    onError(null);

    /*
     * Where the pictures go, held as a Yjs *relative* position rather than an
     * index.
     *
     * An index is a number about a document that is still being edited. While
     * an upload is in flight somebody else in the room can type before this
     * point, and then index 42 is no longer the place the caret was — the
     * picture lands inside somebody else's sentence. A relative position is
     * anchored to the character itself and survives that.
     */
    let anchor = Y.createRelativePositionFromTypeIndex(
      text,
      quill.getSelection()?.index ?? text.length,
    );

    for (const file of files) {
      uploading += 1;
      onBusy(uploading);
      try {
        const url = await upload(file);
        const at = Y.createAbsolutePositionFromRelativePosition(anchor, doc);
        // Null when the anchor was deleted while the upload ran — somebody
        // selected the paragraph and typed over it. Appending is the honest
        // answer; guessing an index would put the picture somewhere nobody
        // asked for.
        const index = at?.index ?? text.length;
        text.insertEmbed(index, { image: url });
        quill.setSelection(index + 1, 0);
        anchor = Y.createRelativePositionFromTypeIndex(text, index + 1);
      }
      catch (error) {
        onError(error instanceof UploadError ? error.message : "Could not upload that picture.");
      }
      finally {
        uploading -= 1;
        onBusy(uploading);
      }
    }
  }

  function choose(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = IMAGE_MIME_TYPES.join(",");
    input.multiple = true;
    input.addEventListener("change", () => {
      void insert([...(input.files ?? [])]);
    });
    input.click();
  }

  return { insert, choose };
}

/**
 * The one path Quill's uploader does not cover.
 *
 * Copying from Word, Google Docs or a web page produces HTML containing
 * `<img src="data:image/png;base64,…">` and no file attachment, so the
 * clipboard never reaches the uploader and the blob goes straight into the
 * document. The matcher strips those images out of the pasted content and
 * hands the bytes to the normal upload path instead.
 *
 * They are inserted where the paste finished rather than at their exact place
 * within it. For the ordinary case — one picture — that is the same position;
 * for a multi-image paste the pictures arrive in order at the end. Worth the
 * imprecision: the alternative on offer is base64 in the document.
 */
export function catchPastedDataUrls(quill: Quill, inserter: Inserter): void {
  quill.clipboard.addMatcher("IMG", (node, delta) => {
    const src = (node as HTMLImageElement).getAttribute("src") ?? "";
    if (!src.startsWith("data:image/")) return delta;

    const file = fileFromDataUrl(src);
    // Undecodable: leave Quill's own delta alone rather than silently deleting
    // something out of somebody's paste.
    if (!file) return delta;

    // after the paste settles, so the caret is at its end
    queueMicrotask(() => void inserter.insert([file]));
    // an empty delta: the image contributes nothing to the pasted content
    return new Delta();
  });
}

function fileFromDataUrl(url: string): File | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  const mime = match?.[1];
  const payload = match?.[2];
  if (!mime || !payload) return null;
  try {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], "pasted", { type: mime });
  }
  catch {
    return null;
  }
}
