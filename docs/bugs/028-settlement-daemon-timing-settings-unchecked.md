# 028: Bad settlement daemon timing settings crash it or stop it from ever running

**Severity:** Low. One wrong setting could crash the settlement daemon at
start, or keep it running while it never closes a day.

## Where

`apps/settlement/internal/config/config.go`, `Load`
(`SETTLEMENT_DAEMON_POLL_INTERVAL_SECONDS`,
`SETTLEMENT_DAEMON_RUN_DELAY_MINUTES`).

## Why it was wrong

Both values were read as plain integers and used as they were:

```go
runDelay, err := parseIntEnv("SETTLEMENT_DAEMON_RUN_DELAY_MINUTES", 15)
pollIntervalSeconds, err := parseIntEnv("SETTLEMENT_DAEMON_POLL_INTERVAL_SECONDS", 60)
...
DaemonPollInterval: time.Duration(pollIntervalSeconds) * time.Second,
```

- A poll interval of 0 or less reaches `time.NewTicker` in
  `scheduler.Run`, which panics ("non-positive interval for NewTicker").
- The daemon closes yesterday once `runDelay` minutes have passed since
  today's Bahrain midnight. With 1440 or more, that moment is at or after
  the next midnight, which starts a new "today", so the run is never due.
  The daemon looks healthy and settles nothing.
- A negative delay is also meaningless, so it is now refused too.

## How to reproduce

Start `settlement daemon` with `SETTLEMENT_DAEMON_POLL_INTERVAL_SECONDS=0`:
it panics. Start it with `SETTLEMENT_DAEMON_RUN_DELAY_MINUTES=1440`: it only
ever logs the next-run estimate.

## Fix

`Load` returns a clear error naming the variable when the poll interval is
below 1 second or the run delay is outside 0 to 1439 minutes. `main.go`
already treats a `Load` error as a fatal boot error. `Load` runs for every
subcommand, so a bad value also stops `run-batch` and the others, which is
the point: the setting has to be fixed.

## Test

`apps/settlement/internal/config/config_test.go`:
`TestLoad_RejectsUnusableDaemonTiming` (every case loaded without error
before the fix) and `TestLoad_AcceptsDaemonTimingAtTheEdges` (1 second,
0 and 1439 minutes are still fine).
