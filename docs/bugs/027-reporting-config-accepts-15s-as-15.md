# 027: Reporting config reads "15s" as 15 and "1.5e4" as 1

**Severity:** Low. A typo in a reporting setting was quietly turned into a
very different number instead of stopping the worker at boot.

## Where

`apps/reporting/src/config.ts`, `parseIntEnv` (used for `PG_POOL_MAX`,
`REPORTING_POLL_INTERVAL_MS`, `REPORTING_MIN_PASS_GAP_MS`,
`REPORTING_CONSUMER_BATCH_LIMIT`).

## Why it was wrong

The comment promised that trailing characters are rejected:

```ts
/**
 * Number.parseInt rejects trailing characters, so '15s' fails loudly at boot.
 */
const parsed = Number.parseInt(value, 10);
if (!Number.isFinite(parsed)) { throw ... }
```

But `Number.parseInt` does not reject them. It reads digits until the first
character it cannot use and ignores the rest. So
`REPORTING_POLL_INTERVAL_MS=15s` became a 15 ms poll (a thousand times more
often than meant) and `1.5e4` became 1 ms.

## How to reproduce

`loadConfig({ DATABASE_URL: "x", REPORTING_POLL_INTERVAL_MS: "15s" })`
returned `reportingPollIntervalMs: 15` before the fix.

## Fix

`parseIntEnv` first checks the whole value against `/^-?\d+$/` and throws
`expected an integer` if it does not match. Only then is it parsed. The
comment now says what the code does.

## Test

`apps/reporting/src/config.test.ts`: "loadConfig rejects integer settings
with trailing or non-integer text" (failed before the fix: `15s` did not
throw) and "loadConfig accepts plain integers and falls back when unset".
