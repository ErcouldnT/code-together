import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * Better Auth from the browser. Same origin as the page, so no base URL;
 * only the admin screen imports it, so it loads with that screen and not
 * with every document.
 */
export const authClient = createAuthClient({ plugins: [adminClient()] });
