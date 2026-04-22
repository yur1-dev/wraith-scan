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
  // Keep alive — prevents connection drops on serverless cold starts
  serverSelectionTimeoutMS: 10_000,
  socketTimeoutMS: 30_000,
  // Connection pool — serverless functions share at most 10 connections
  maxPoolSize: 10,
  minPoolSize: 1,
};

// ─── CLIENT SINGLETON ─────────────────────────────────────────────────────────
// In both development and production we cache the client on the global object.
//
// Development: Next.js hot-reloads modules on every file save, which would
// create a new MongoClient on every reload and exhaust the connection pool
// within minutes. The global cache survives hot-reloads.
//
// Production (serverless): Each worker process evaluates modules once per
// cold start. Without the global cache, concurrent invocations that happen
// to cold-start at the same time each create their own client. With the
// global cache, the first invocation wins and all subsequent ones in the
// same process reuse it.
//
// Either way: one MongoClient per Node.js process, never more.

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

let clientPromise: Promise<MongoClient>;

if (!global._mongoClientPromise) {
  const client = new MongoClient(MONGODB_URI, MONGO_OPTIONS);
  global._mongoClientPromise = client.connect();
}

clientPromise = global._mongoClientPromise;

export default clientPromise;

// ─── DB HELPER ────────────────────────────────────────────────────────────────
// Always targets the named "wraith" database (or MONGODB_DB env override).
// Never falls back to the connection string default or "test".
export async function getDb(): Promise<Db> {
  const client = await clientPromise;
  return client.db(MONGODB_DB);
}
