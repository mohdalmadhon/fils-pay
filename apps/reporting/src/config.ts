/**
 * apps/reporting's own configuration, loaded once from environment
 * variables at boot — same loadConfig-throws-at-boot posture as
 * apps/api's, but only the fields this worker
 * actually needs. This worker never serves HTTP, so it has no port,
 * session, or auth-related config at all.
 */
export interface ReportingConfig {
  databaseUrl: string;
  pgPoolMax: number;
  /** How often the consumer's poll-fallback timer runs a pass, independent
   *  of LISTEN/NOTIFY. Default 15_000ms — longer than webhooks' 5_000ms
   *  default, deliberately: a missed analytics notification only ever
   *  means a dashboard number is a few extra seconds later to update. */
  reportingPollIntervalMs: number;
  /** Least time between the end of one consumer pass and the start of the
   *  next (docs/perf/checkout-capacity.md). */
  reportingMinPassGapMs: number;
  /** Max outbox rows read per runConsumerPass call — matches webhooks'
   *  Step A cap. */
  consumerBatchLimit: number;
}

/**
 * Accepts only a plain base-10 integer. Number.parseInt on its own stops at
 * the first bad character ('15s' -> 15, '1.5e4' -> 1), so the whole string
 * is checked first: '15s' fails loudly at boot, and a typo in an interval
 * can never be silently truncated.
 */
function parseIntEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  if (!/^-?\d+$/.test(value)) {
    throw new Error(`loadConfig: expected an integer, got "${value}"`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`loadConfig: expected an integer, got "${value}"`);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ReportingConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("loadConfig: DATABASE_URL environment variable is not set");
  }

  return {
    databaseUrl,
    // FH: PG_POOL_MAX is the same name apps/api reads -- setting it in compose changes both. intended?
    pgPoolMax: parseIntEnv(env.PG_POOL_MAX, 5),
    // MK: 15s fine. dashboards aren't realtime.
    reportingPollIntervalMs: parseIntEnv(env.REPORTING_POLL_INTERVAL_MS, 15_000),
    reportingMinPassGapMs: parseIntEnv(env.REPORTING_MIN_PASS_GAP_MS, 500),
    consumerBatchLimit: parseIntEnv(env.REPORTING_CONSUMER_BATCH_LIMIT, 500),
  };
}
