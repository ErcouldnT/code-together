import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { env } from "../env.js";
import * as schema from "./schema.js";

const file = resolve(env.databasePath);
mkdirSync(dirname(file), { recursive: true });

const sqlite = new Database(file);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 5000");

export const db = drizzle(sqlite, { schema });
export { schema };

/**
 * Where the generated SQL lives, found by walking up rather than by counting
 * directories.
 *
 * A fixed `../../../drizzle` is right for exactly one layout: the compiled
 * `dist/src/db/index.js`. Run the same file from source — `tsx src/server.ts`,
 * or a test — and it points one level above the repository, where there is no
 * migrations folder at all. That failed at boot, which is to say it failed for
 * anyone running the server outside Docker.
 */
function migrationsFolder(): string {
  let dir = import.meta.dirname;
  for (let up = 0; up < 6; up++) {
    const candidate = resolve(dir, "drizzle");
    if (existsSync(resolve(candidate, "meta/_journal.json"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not find the drizzle migrations folder");
}

/** Applied at boot — the image ships the generated SQL, nothing is written by hand. */
export function runMigrations(): void {
  migrate(db, { migrationsFolder: migrationsFolder() });
}

export function closeDatabase(): void {
  sqlite.close();
}
