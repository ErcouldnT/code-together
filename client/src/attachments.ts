/**
 * Files attached to a document, as the server keeps them. They live outside
 * the Yjs document — see src/attachments.ts — so this is plain HTTP.
 */

export interface Attachment {
  id: string;
  name: string;
  size: number;
  addedBy: string | null;
  createdAt: number;
}

import type * as Y from "yjs";

export class AttachmentError extends Error {}

const base = (documentId: string) => `/api/documents/${encodeURIComponent(documentId)}/attachments`;

export function downloadUrl(documentId: string, attachmentId: string): string {
  return `${base(documentId)}/${attachmentId}`;
}

export async function listAttachments(documentId: string): Promise<{ attachments: Attachment[]; maxBytes: number }> {
  const response = await fetch(base(documentId));
  if (!response.ok) throw new AttachmentError("Could not load the attachments.");
  return (await response.json()) as { attachments: Attachment[]; maxBytes: number };
}

/**
 * XMLHttpRequest rather than fetch: a gigabyte takes long enough that a
 * progress bar is not decoration, and fetch still cannot report upload
 * progress.
 */
export function uploadAttachment(
  documentId: string,
  file: File,
  addedBy: string,
  onProgress: (fraction: number) => void,
): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const query = new URLSearchParams({ name: file.name, by: addedBy });
    request.open("POST", `${base(documentId)}?${query}`);
    request.setRequestHeader("content-type", "application/octet-stream");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      if (request.status === 201) resolve(JSON.parse(request.responseText) as Attachment);
      else if (request.status === 413) reject(new AttachmentError(`“${file.name}” is too large.`));
      else reject(new AttachmentError(`Upload failed (${request.status}).`));
    };
    request.onerror = () => reject(new AttachmentError("Upload failed: the connection dropped."));
    request.send(file);
  });
}

export async function deleteAttachment(documentId: string, attachmentId: string): Promise<void> {
  const response = await fetch(`${base(documentId)}/${attachmentId}`, { method: "DELETE" });
  // 404 means somebody else got there first, which is the outcome asked for.
  if (!response.ok && response.status !== 404) throw new AttachmentError("Could not delete that file.");
}

/**
 * Take every link to a deleted attachment out of the text, along with the
 * space inserted after it. Done as an ordinary edit, so everyone in the room
 * receives it like any other change. Returns how many links were removed.
 */
export function removeLinksTo(text: Y.Text, url: string): number {
  const ranges: Array<[number, number]> = [];
  let index = 0;
  for (const op of text.toDelta() as Array<{ insert: unknown; attributes?: { link?: unknown } }>) {
    const length = typeof op.insert === "string" ? op.insert.length : 1;
    if (op.attributes?.link === url) {
      const previous = ranges.at(-1);
      // adjacent runs with different formatting are one link
      if (previous && previous[0] + previous[1] === index) previous[1] += length;
      else ranges.push([index, length]);
    }
    index += length;
  }
  const whole = text.toString();
  const run = () => {
    // from the end, so earlier indices stay valid
    for (const [start, length] of ranges.reverse()) {
      const trailingSpace = whole[start + length] === " " ? 1 : 0;
      text.delete(start, length + trailingSpace);
    }
  };
  if (text.doc) text.doc.transact(run);
  else run();
  return ranges.length;
}

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}
