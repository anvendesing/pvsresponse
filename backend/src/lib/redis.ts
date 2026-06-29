// Shared Redis client with graceful degradation.
//
// When REDIS_URL is set, connects lazily. Every consumer checks
// `if (!redis)` before using the client so a Redis outage
// degrades to a direct Postgres hit instead of crashing.
//
// REDIS_URL examples:
//   redis://redis:6379/0          (Docker Compose — default)
//   redis://localhost:6379/0      (local dev)
//   rediss://user:pass@host:6380  (TLS cloud Redis)

import IORedis from "ioredis";

const REDIS_URL = process.env["REDIS_URL"];

function createClient(): IORedis | null {
  if (!REDIS_URL) {
    console.log("[redis] REDIS_URL not set — Redis cache disabled (graceful degradation)");
    return null;
  }
  const client = new IORedis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2000,
  });

  client.on("connect", () => console.log("[redis] Connected to", REDIS_URL.replace(/:[^@]*@/, ":***@")));
  client.on("error", (err: Error) => {
    // Suppress repeated ECONNREFUSED noise — we degrade gracefully on miss.
    if ((err as NodeJS.ErrnoException).code !== "ECONNREFUSED") {
      console.error("[redis] Error:", err.message);
    }
  });

  // Trigger the lazy connection so the first cache hit doesn't stall.
  client.connect().catch(() => {
    // Expected if Redis isn't up yet — will retry automatically.
  });

  return client;
}

export const redis = createClient();
