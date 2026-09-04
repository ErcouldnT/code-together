import { mkdirSync } from "node:fs";
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

/** Applied at boot — the image ships the generated SQL, nothing is written by hand. */
export function runMigrations(): void {
  migrate(db, { migrationsFolder: resolve(import.meta.dirname, "../../../drizzle") });
}

export function closeDatabase(): void {
  sqlite.close();
}
