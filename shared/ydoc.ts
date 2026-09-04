/**
 * Names inside the Yjs document. Shared so the two sides cannot drift: a client
 * bound to `getText("quill")` and a server seeding `getText("body")` would sync
 * perfectly and show nothing, with no error anywhere.
 */

/** The rich text Quill is bound to. The name y-quill's own examples use. */
export const TEXT_KEY = "quill";

/** Document metadata that is itself collaborative — the title, from phase 3. */
export const META_KEY = "meta";
