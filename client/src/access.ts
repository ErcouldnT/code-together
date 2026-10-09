import slugify from "slugify";
import {
  slugOf,
  type AccessInfo,
  type CreateDocumentError,
  type CreateDocumentRequest,
} from "@shared/access";

/**
 * The browser's side of document passwords. Nothing here holds a password
 * longer than one request: the server answers an unlock with an HttpOnly
 * cookie, and that cookie — which this code never sees — is the proof.
 */

/** What a name will become in the address bar, worked out as it is typed. */
export function addressFor(name: string): string {
  return slugOf(name, slugify);
}

export async function fetchAccess(documentId: string): Promise<AccessInfo> {
  const response = await fetch(`/api/documents/${documentId}/access`);
  if (!response.ok) throw new Error(`access ${response.status}`);
  return (await response.json()) as AccessInfo;
}

/** True when the password was right; the cookie is set by then. */
export async function unlock(documentId: string, password: string): Promise<boolean> {
  const response = await fetch(`/api/documents/${documentId}/unlock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (response.status === 429) throw new Error("Too many attempts. Wait a minute and try again.");
  return response.ok;
}

export async function createDocument(
  request: CreateDocumentRequest,
): Promise<{ id: string } | { error: CreateDocumentError | "too-many" }> {
  const response = await fetch("/api/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  if (response.status === 429) return { error: "too-many" };
  return (await response.json()) as { id: string } | { error: CreateDocumentError };
}
