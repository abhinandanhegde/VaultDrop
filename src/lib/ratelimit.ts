// In-memory sliding-window rate limiter with periodic eviction.
// NOTE: per-instance only — on serverless (Vercel) each instance has its own
// map. It is a first line of defense; the DB-side failed_attempts counter is
// the authoritative backstop for PIN brute force.

interface Entry {
  count: number;
  resetAt: number;
}

const stores = new Map<string, Map<string, Entry>>();

function evict(windowMs: number, now: number) {
  for (const [, store] of stores) {
    for (const [key, entry] of store) {
      if (entry.resetAt < now - windowMs * 2) store.delete(key);
    }
  }
}

export function createRateLimiter(max: number, windowMs: number) {
  let store = stores.get(`${max}:${windowMs}`);
  if (!store) {
    store = new Map<string, Entry>();
    stores.set(`${max}:${windowMs}`, store);
  }
  let lastEvict = Date.now();

  return {
    allow(key: string): boolean {
      const now = Date.now();
      if (now - lastEvict > windowMs) {
        evict(windowMs, now);
        lastEvict = now;
      }
      const entry = store!.get(key);
      if (!entry || entry.resetAt < now) {
        store!.set(key, { count: 1, resetAt: now + windowMs });
        return true;
      }
      if (entry.count >= max) {
        return false;
      }
      entry.count++;
      return true;
    },
  };
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}