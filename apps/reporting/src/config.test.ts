import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "./config.js";

const base = { DATABASE_URL: "postgres://unused" };

test("loadConfig rejects integer settings with trailing or non-integer text", () => {
  for (const value of ["15s", "1.5e4", "15000ms", "1.5", "abc", " 15"]) {
    assert.throws(
      () => loadConfig({ ...base, REPORTING_POLL_INTERVAL_MS: value }),
      /expected an integer/,
      `REPORTING_POLL_INTERVAL_MS=${JSON.stringify(value)} must be rejected`,
    );
  }
});

test("loadConfig accepts plain integers and falls back when unset", () => {
  const config = loadConfig({ ...base, REPORTING_POLL_INTERVAL_MS: "20000", PG_POOL_MAX: "7" });
  assert.equal(config.reportingPollIntervalMs, 20_000);
  assert.equal(config.pgPoolMax, 7);
  assert.equal(loadConfig(base).reportingPollIntervalMs, 15_000);
});
