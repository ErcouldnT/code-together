import "dotenv/config";

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: int(process.env.PORT, 5000),
  /** Path to the SQLite file. Keep this on a volume so documents survive redeploys. */
  databasePath: process.env.DATABASE_PATH ?? "./data/together.db",
  /** How long a document may sit untouched before the cleanup job drops it. 0 disables it. */
  documentTtlDays: int(process.env.DOCUMENT_TTL_DAYS, 0),
} as const;

export const isProduction = env.nodeEnv === "production";
