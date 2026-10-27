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
  // Serverless: every warm instance keeps its own pool. 10 x many instances blows past Atlas' connection cap
  // (free tier: 500), so keep pools small and let idle ones close.
  maxPoolSize: 5,
  minPoolSize: 0,
  maxIdleTimeMS: 30_000,
  heartbeatFrequencyMS: 15_000,
};

// ─── CLIENT SINGLETON ─────────────────────────────────────────────────────────
declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
  // eslint-disable-next-line no-var
  var _mongoIndexesEnsured: boolean | undefined;
  // eslint-disable-next-line no-var
  var _mongoScaleIndexes: boolean | undefined;
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

    // ── account identity ──────────────────────────────────────────────────────
    await db
      .collection("users")
      .createIndex({ email: 1 }, { unique: true, sparse: true });
    await db
      .collection("users")
      .createIndex({ privyUserId: 1 }, { unique: true, sparse: true });

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

    // ── wallet_reputation ─────────────────────────────────────────────────────
    // _id is already the wallet address (unique by definition), so the only
    // extra index needed is for querying "who's been reliably winning
    // lately" — sorted by how recently a wallet was last seen as a top
    // holder, for any future leaderboard/admin view.
    await db.collection("wallet_reputation").createIndex({ lastSeenAt: -1 });

    console.log("[mongoClient] Indexes ensured");
  } catch (err) {
    // Non-fatal — app still works, just potentially slower queries
    console.error("[mongoClient] Failed to ensure indexes:", err);
  }
}

// ─── SCALE INDEXES ────────────────────────────────────────────────────────────
// Added for 1,000+ users: every list/feed endpoint looks users up by userId / mint / wallet. Without these Mongo reads
// the whole collection on each request. All non-unique (safe on existing data) and idempotent. Each one is wrapped so a
// single failure never blocks the rest. Runs a few seconds after boot so it never competes with the first requests.
type IndexSpec = [string, Record<string, 1 | -1>, Record<string, unknown>?];
const SCALE_INDEXES: IndexSpec[] = [
  ["signal_calls", { shadow: 1, spottedAt: -1 }],
  ["signal_calls", { learned: 1, spottedAt: 1 }],
  ["profiles", { userId: 1 }],
  ["profiles", { updatedAt: -1 }],
  ["profiles", { displayName: 1 }],
  ["users", { telegramChatId: 1 }, { sparse: true }],
  ["users", { walletAddress: 1 }, { sparse: true }],
  ["trader_follows", { followerId: 1, traderId: 1 }],
  ["trader_follows", { traderId: 1 }],
  ["callouts", { mint: 1, createdAt: -1 }],
  ["callouts", { userId: 1, createdAt: -1 }],
  ["callouts", { parentId: 1, createdAt: 1 }],
  ["callouts", { createdAt: -1 }],
  ["callout_hearts", { calloutId: 1, userId: 1 }],
  ["callout_reposts", { calloutId: 1, userId: 1 }],
  ["token_activity", { mint: 1, lastAt: -1 }],
  ["token_activity", { userId: 1, mint: 1 }],
  ["telegram_links", { token: 1 }],
  ["positions", { userId: 1, mint: 1, status: 1 }],
  // dedupe markers for Telegram alerts: nothing reads them after a few weeks, so let Mongo delete them
  ["tg_sent", { at: 1 }, { expireAfterSeconds: 30 * 24 * 3600 }],
];
async function ensureScaleIndexes(): Promise<void> {
  if (global._mongoScaleIndexes) return;
  global._mongoScaleIndexes = true;
  try {
    const db = await getDb();
    let ok = 0;
    for (const [col, spec, opts] of SCALE_INDEXES) {
      try { await db.collection(col).createIndex(spec, opts ?? {}); ok++; }
      catch (e) { console.warn(`[mongoClient] index ${col} ${JSON.stringify(spec)} skipped:`, e instanceof Error ? e.message : e); }
    }
    console.log(`[mongoClient] Scale indexes ensured (${ok}/${SCALE_INDEXES.length})`);
  } catch (e) {
    console.warn("[mongoClient] scale indexes failed:", e instanceof Error ? e.message : e);
  }
}

// Auto-run on module load (non-blocking — errors are caught above)
ensureIndexes();
setTimeout(() => { void ensureScaleIndexes(); }, 4000).unref?.();
