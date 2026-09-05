/**
 * Getting a picture from the user to the server: shrink it, post it, get back
 * the address the document will point at.
 *
 * Which gesture produced the file — a paste, a drop, the toolbar button — is
 * not this module's problem. Quill's uploader module funnels all three into
 * one place; see editor-images.ts.
 */

/** Anything wider than this is re-encoded before it leaves the browser. */
const MAX_EDGE = 2048;
/** …as is anything heavier, whatever its dimensions. */
const MAX_BYTES = 512 * 1024;

/**
 * Shrink a picture before uploading it.
 *
 * Done here rather than on the server so the server needs no image library —
 * `sharp` means a native build on the arm64 box this runs on, for work the
 * browser can do while the user is still looking at the page.
 *
 * The trade is real and worth stating: this is a lossy re-encode and the
 * original is not kept. For a document people paste screenshots into that is
 * the right side of the trade; for a photo archive it would not be.
 */
export async function shrink(file: File): Promise<Blob> {
  if (file.size <= MAX_BYTES) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  }
  catch {
    // An animated GIF, or a format this browser cannot decode. Sending it
    // untouched is better than failing: the server's cap is the backstop.
    return file;
  }

  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);

    const encoded = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/webp", 0.9);
    });
    // Re-encoding does not always win — a small PNG screenshot can come out
    // larger as WebP. Keep whichever is smaller.
    return encoded && encoded.size < file.size ? encoded : file;
  }
  finally {
    bitmap.close();
  }
}

export class UploadError extends Error {}

/** Store a picture and return the address the document should point at. */
export async function upload(file: File): Promise<string> {
  const body = await shrink(file);
  const response = await fetch("/api/uploads", {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body,
  });

  if (response.status === 413) throw new UploadError("That picture is too large.");
  if (response.status === 415) throw new UploadError("That file is not an image we can store.");
  if (!response.ok) throw new UploadError(`Upload failed (${response.status}).`);

  const { url } = (await response.json()) as { url?: string };
  if (!url) throw new UploadError("Upload failed.");
  return url;
}
