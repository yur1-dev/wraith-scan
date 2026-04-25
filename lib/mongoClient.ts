import { MongoClient, Db } from "mongodb";

// ─── ENV VALIDATION ───────────────────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || "wraith";

if (!MONGODB_URI) {
  throw new Error(
    "[mongoClient] MONGODB_URI environment variable is not set. " +
      "Add it to .env.local for development or your deployment environment.",
  );
}

// ─── CONNECTION OPTIONS ───────────────────────────────────────────────────────
const MONGO_OPTIONS = {
  serverSelectionTimeoutMS: 30_000,
  connectTimeoutMS: 30_000,
  socketTimeoutMS: 45_000,
  maxPoolSize: 10,
  minPoolSize: 1,
  heartbeatFrequencyMS: 15_000,
};

// ─── CLIENT SINGLETON ─────────────────────────────────────────────────────────
declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
  // eslint-disable-next-line no-var
  var _mongoIndexesEnsured: boolean | undefined;
}

let clientPromise: Promise<MongoClient>;

if (!global._mongoClientPromise) {
  const client = new MongoClient(MONGODB_URI, MONGO_OPTIONS);
  global._mongoClientPromise = client.connect();
}

clientPromise = global._mongoClientPromise;

export default clientPromise;

// ─── DB HELPER ────────────────────────────────────────────────────────────────
export async function getDb(): Promise<Db> {
  const client = await clientPromise;
  return client.db(MONGODB_DB);
}

// ─── INDEX BOOTSTRAP ──────────────────────────────────────────────────────────
// Called once per process. Safe to call multiple times — createIndex is idempotent.
// Runs in the background so it never blocks the first request.
export async function ensureIndexes(): Promise<void> {
  if (global._mongoIndexesEnsured) return;
  global._mongoIndexesEnsured = true;

  try {
    const db = await getDb();

    // ── users (managed by NextAuth adapter) ───────────────────────────────────
    // NextAuth creates its own indexes, but these cover our app-level queries.
    await db
      .collection("users")
      .createIndex({ email: 1 }, { unique: true, sparse: true });

    // ── sessions (NextAuth) ───────────────────────────────────────────────────
    await db.collection("sessions").createIndex({ userId: 1 });
    await db.collection("sessions").createIndex(
      { expires: 1 },
      { expireAfterSeconds: 0 }, // MongoDB TTL — auto-deletes expired sessions
    );

    // ── positions ─────────────────────────────────────────────────────────────
    // Primary query: all positions for a user, sorted by open time
    await db.collection("positions").createIndex({ userId: 1, openedAt: -1 });
    // Uniqueness: one position record per user+token combo (if your logic enforces this)
    await db.collection("positions").createIndex(
      { userId: 1, tokenMint: 1 },
      { unique: false }, // set true if you enforce one-position-per-token
    );

    // ── trades ────────────────────────────────────────────────────────────────
    // Primary query: all trades for a user, newest first
    await db.collection("trades").createIndex({ userId: 1, timestamp: -1 });
    // Filter by token within a user's trade history
    await db
      .collection("trades")
      .createIndex({ userId: 1, tokenMint: 1, timestamp: -1 });

    // ── telegram_links ────────────────────────────────────────────────────────
    // Auto-delete expired one-time link tokens after expiresAt passes
    await db
      .collection("telegram_links")
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

    console.log("[mongoClient] Indexes ensured");
  } catch (err) {
    // Non-fatal — app still works, just potentially slower queries
    console.error("[mongoClient] Failed to ensure indexes:", err);
  }
}

// Auto-run on module load (non-blocking — errors are caught above)
ensureIndexes();
