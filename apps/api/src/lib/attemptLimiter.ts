/**
 * Counts attempts per key in a sliding time window, in this process's memory,
 * and says when a key has used up its allowance. Used to stop one public
 * payment link from being used to test stolen card numbers
 * (docs/defence/03).
 *
 * In memory, not in the database: the API runs as one replica on the hosted
 * box (docker-compose.yml), and this check sits on the checkout hot path,
 * where a database round trip per attempt would cost capacity. A restart
 * forgets the counts, which only ever gives an attacker a fresh allowance of
 * a few attempts. With several replicas each would count separately.
 *
 * Memory is bounded: expired timestamps are dropped on every touch, and when
 * more than `maxKeys` keys are tracked the oldest-touched ones are dropped.
 */
export interface AttemptLimiter {
  /** Records an attempt for `key` and returns false when it is over the
   *  limit (the attempt is not recorded then). */
  tryAttempt(key: string, now?: number): boolean;
  /** Seconds until `key` gets an attempt back, for Retry-After. */
  retryAfterSeconds(key: string, now?: number): number;
}

export function createAttemptLimiter(options: { max: number; windowMs: number; maxKeys?: number }): AttemptLimiter {
  const { max, windowMs } = options;
  const maxKeys = options.maxKeys ?? 50_000;
  const attempts = new Map<string, number[]>();

  function live(key: string, now: number): number[] {
    const list = (attempts.get(key) ?? []).filter((t) => now - t < windowMs);
    // Re-insert so Map order is "least recently touched first".
    attempts.delete(key);
    if (list.length > 0) attempts.set(key, list);
    return list;
  }

  return {
    tryAttempt(key, now = Date.now()) {
      if (max <= 0) return true; // disabled
      const list = live(key, now);
      if (list.length >= max) {
        attempts.set(key, list);
        return false;
      }
      list.push(now);
      attempts.set(key, list);
      while (attempts.size > maxKeys) {
        const oldest = attempts.keys().next().value;
        if (oldest === undefined) break;
        attempts.delete(oldest);
      }
      return true;
    },
    retryAfterSeconds(key, now = Date.now()) {
      const list = attempts.get(key) ?? [];
      const oldest = list.find((t) => now - t < windowMs);
      return oldest === undefined ? 0 : Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    },
  };
}
