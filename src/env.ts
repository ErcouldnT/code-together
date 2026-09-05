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

  /**
   * Largest single Yjs update the server will apply. Generous next to what
   * typing produces (tens of bytes) and small next to a pasted base64 image,
   * which is what this is really here to stop until uploads exist.
   */
  maxUpdateBytes: int(process.env.MAX_UPDATE_BYTES, 1024 * 1024),
  /**
   * Largest a document may grow. Checked against the size measured at the last
   * save rather than on every update — encoding the whole document per
   * keystroke to enforce a limit nobody reaches would cost more than the limit
   * saves. The practical effect is that the cap can be crossed by up to one
   * save interval's worth of typing before it bites.
   */
  maxDocumentBytes: int(process.env.MAX_DOCUMENT_BYTES, 8 * 1024 * 1024),
  /** Updates one socket may send per window before the rest are dropped. */
  updateBurst: int(process.env.UPDATE_BURST, 200),
  updateWindowMs: int(process.env.UPDATE_WINDOW_MS, 10_000),

  /**
   * Where pasted and dropped pictures are written. Under the same volume as the
   * database, deliberately: they are as much a part of a document as its text,
   * and a second mount would be a second thing to remember to back up.
   */
  uploadDir: process.env.UPLOAD_DIR ?? "./data/uploads",
  /**
   * Largest picture accepted. Generous because the browser already shrinks
   * anything big before sending it; this is the backstop for a client that
   * does not, not the normal case.
   */
  maxUploadBytes: int(process.env.MAX_UPLOAD_BYTES, 25 * 1024 * 1024),
} as const;

export const isProduction = env.nodeEnv === "production";
