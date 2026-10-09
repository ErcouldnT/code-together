import { randomBytes } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { fromNodeHeaders } from "better-auth/node";
import { admin } from "better-auth/plugins";
import type { NextFunction, Request, Response } from "express";
import { db } from "./db/index.js";
import { account, session, user, verification } from "./db/schema.js";
import { env, isProduction } from "./env.js";

/**
 * Accounts and sign-in, by Better Auth over the app's own Drizzle database.
 *
 * Today there is one account that matters: the admin, made from
 * ADMIN_EMAIL and ADMIN_PASSWORD at boot. Nobody can sign up — the only way
 * an account appears is from here — but the tables and the session handling
 * are Better Auth's, so signing in by email link or anything else later is
 * a plugin, not a rewrite.
 *
 * Signed in as an admin opens every document, password or not. The session
 * cookie is site-wide, so it reaches the socket handshake, which is where
 * reading and writing a document are decided.
 */

/** The admin screen exists only when there is an admin to sign in as. */
export const adminEnabled = Boolean(env.adminEmail && env.adminPassword);

/**
 * Better Auth needs a secret in production. Without one, and without an
 * admin, there is nothing to sign in to anyway, so a throwaway key does; with
 * an admin configured, refusing to start says what is missing.
 */
function secret(): string {
  if (env.authSecret) return env.authSecret;
  if (adminEnabled && isProduction) {
    throw new Error("BETTER_AUTH_SECRET must be set when ADMIN_EMAIL and ADMIN_PASSWORD are");
  }
  return randomBytes(32).toString("base64");
}

/**
 * The client's address, as Express worked it out behind the proxy, under a
 * header Better Auth is told to read. Its own default reads the first
 * X-Forwarded-For entry, which is whatever the visitor typed; this one is set
 * here on every request, so a visitor cannot supply it.
 */
const CLIENT_IP = "x-ct-client-ip";

export function clientIpHeader(req: Request, _res: Response, next: NextFunction): void {
  req.headers[CLIENT_IP] = req.ip ?? "";
  next();
}

export const auth = betterAuth({
  appName: "Code together!",
  baseURL: env.authUrl || undefined,
  trustedOrigins: env.authUrl ? [env.authUrl] : [],
  secret: secret(),
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: { user, session, account, verification },
  }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
  },
  session: {
    // An admin's session is a key to every document: short, renewed while used.
    expiresIn: 12 * 60 * 60,
    updateAge: 60 * 60,
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    // the same budget as a document password
    customRules: { "/sign-in/email": { window: 60, max: 10 } },
  },
  advanced: {
    ipAddress: { ipAddressHeaders: [CLIENT_IP] },
  },
  telemetry: { enabled: false },
  plugins: [admin()],
});

function isAdminRole(role: string | null | undefined): boolean {
  return (role ?? "").split(",").map((r) => r.trim()).includes("admin");
}

/** Whether these request headers carry a signed-in, unbanned admin's session. */
export async function isAdminRequest(headers: IncomingHttpHeaders): Promise<boolean> {
  // Nobody but an admin has a session cookie today; skip the lookup for the rest.
  if (!adminEnabled || !headers.cookie?.includes("session_token")) return false;
  try {
    const found = await auth.api.getSession({ headers: fromNodeHeaders(headers) });
    return Boolean(found && isAdminRole(found.user.role) && !found.user.banned);
  }
  catch {
    return false;
  }
}

/**
 * `res.locals.admin` for every API request after this, so the synchronous
 * access checks can ask without a database round trip of their own.
 */
export async function resolveAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  res.locals.admin = await isAdminRequest(req.headers);
  next();
}

/**
 * Make the admin account from the environment, or bring it into line with
 * it: the role, and the password. A changed ADMIN_PASSWORD is how a lost one
 * is reset, and it ends the sessions signed in with the old one.
 */
export async function ensureAdmin(): Promise<void> {
  if (!adminEnabled) return;
  if (env.adminPassword.length < 12) throw new Error("ADMIN_PASSWORD must be at least 12 characters");

  const ctx = await auth.$context;
  const found = await ctx.internalAdapter.findUserByEmail(env.adminEmail, { includeAccounts: true });
  if (!found) {
    await auth.api.createUser({
      body: { email: env.adminEmail, password: env.adminPassword, name: "Admin", role: "admin" },
    });
    return;
  }

  const { user: existing, accounts } = found;
  // the admin plugin's column, which the core user type does not declare
  if (!isAdminRole((existing as { role?: string | null }).role)) {
    await ctx.internalAdapter.updateUser(existing.id, { role: "admin" });
  }
  const credential = accounts.find((a) => a.providerId === "credential");
  const current = credential?.password
    ? await ctx.password.verify({ hash: credential.password, password: env.adminPassword })
    : false;
  if (current) return;

  const hash = await ctx.password.hash(env.adminPassword);
  if (credential) await ctx.internalAdapter.updatePassword(existing.id, hash);
  else await ctx.internalAdapter.linkAccount({ userId: existing.id, providerId: "credential", accountId: existing.id, password: hash });
  await ctx.internalAdapter.deleteUserSessions(existing.id);
}
