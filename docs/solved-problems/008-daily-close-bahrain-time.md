# 008 — Daily close rolls over at 03:00 Bahrain time

Recorded: 2026-10-29.

Status: implemented locally and verified with deterministic clock inputs.
No live daemon was started, settlement batch executed, or historical date
reprocessed as part of the timing verification.

## Reported problem and configured intent

The user reported daily close running around 03:00 local rather than
midnight. The configured business timezone is Asia/Bahrain, UTC+3.

The existing daemon deliberately has a grace period:
`SETTLEMENT_DAEMON_RUN_DELAY_MINUTES` defaults to 15. The intended default
is therefore **00:15 Bahrain**, not exactly 00:00. A zero delay makes a run
due at midnight. The fix preserves that configuration choice and the
60-second default polling interval; the actual start is the first poll
after the due instant, plus any operational delays.

## Root cause

`runIfDue` previously obtained `time.Now().UTC()` and passed it directly
to `BusinessDayWindow`. That helper interprets the argument's calendar date
as a date label: it extracts year/month/day in the argument's own location,
then constructs Bahrain midnight for that label. It does not first convert
an arbitrary instant into Bahrain's calendar.

This distinction is intentional for CLI inputs such as a UTC-parsed
`--date=2026-05-14`. But at 00:15 Bahrain on May 15, the UTC date is still
May 14. The daemon consequently chose May 14 as "today" and May 13 as the
completed day, repeatedly retrying the older batch. The new completed day,
May 14, was not selected until UTC midnight: **03:00 Bahrain**.

| Instant in UTC | Bahrain wall time | Previous selection | Correct selection with 15-minute delay |
|---|---|---|---|
| May 14, 21:00 | May 15, 00:00 | May 13 | Not due yet |
| May 14, 21:05 | May 15, 00:05 | May 13 | Not due yet |
| May 14, 21:15 | May 15, 00:15 | May 13 | May 14 |
| May 15, 00:00 | May 15, 03:00 | May 14 | May 14, already eligible since 00:15 |

The exact observed start can be later because of polling, processing, or
restarts. A source comment mentions approximately 03:15, while saved paid
timestamps include 03:06–03:08. The selector defect explains the UTC-date
rollover; these observations do not establish an exact production schedule.

The bug is not daylight saving or log formatting. The business timezone is
fixed independently of the host's `TZ`; changing how logs render cannot
correct which calendar date was selected.

## Fix and affected code

Separate the two kinds of input explicitly:

- `BusinessDayWindow(date)` continues to interpret a calendar-date label.
  Existing CLI and batch-close semantics are unchanged.
- New `BusinessDayWindowAt(instant)` converts an instant into the existing
  private Bahrain location before obtaining that date's window. No duplicate
  timezone constant or hardcoded three-hour arithmetic was introduced.
- `DueBusinessDate(now, delay)` uses the instant-aware window, waits until
  Bahrain midnight plus the configured grace period, and returns yesterday's
  Bahrain date only when due. Both the startup check and ticker call this
  same function through `runIfDue`.

| Location | Change |
|---|---|
| [window.go:51](../../apps/settlement/internal/settlement/window.go#L51), `BusinessDayWindowAt`, lines 51–55 | Add an instant-aware wrapper using the existing business timezone; leave `BusinessDayWindow` unchanged |
| [daemon.go:63](../../apps/settlement/internal/scheduler/daemon.go#L63), `DueBusinessDate`, lines 63–74 | Calculate the completed business date and grace cutoff on the Bahrain calendar |
| [daemon.go:76](../../apps/settlement/internal/scheduler/daemon.go#L76), `runIfDue` | Replace the UTC-date path with the shared due-date calculation; retain batch execution and notification behavior |
| [config.go:86](../../apps/settlement/internal/config/config.go#L86) | Clarify the grace-period comment; environment variable and default remain unchanged |
| [Architecture](../ARCHITECTURE.md#settlement) and [runbook](../RUNBOOK.md#daily-close-timing) | Explain the local due time, polling, activation, and the distinction between an instant and a date label |

Frozen money code, regression-locked tests, payout arithmetic, daily batch
windows, monthly report windows, retry/idempotency logic, and log-estimate
behavior were not changed.

## References and earlier mentions

The pre-fix source and removed comments can be inspected with
`git show 8cb5dfb:<path>`. Substantive references found in this investigation:

| Reference | Evidence and limits |
|---|---|
| [Original daemon](../../apps/settlement/internal/scheduler/daemon.go), baseline `8cb5dfb` | Uses UTC's date, claims the window helper converts it, and includes an operator comment about a close at approximately 03:15 instead of 00:15 |
| [Timezone handover note](../HANDOVER.md#L52) | Explicitly says the daemon's "yesterday" uses the UTC date, but calls it harmless. The first three Bahrain hours show why that assessment was incorrect. |
| [June 2 engineering sync](../meetings/2026-06-02-eng-sync.md#L54) | Questions whether a 00:05 close log is Bahrain or UTC; the reply attributes it to log timezone and asserts Bahrain midnight. This is an earlier concern, not runtime proof that selection was correct. |
| [Architecture settlement lifecycle](../ARCHITECTURE.md#settlement) | Establishes midnight-to-midnight Bahrain business days and close shortly after local midnight |
| [ADR 0003](../adr/0003-report-date-windows.md#decision) | Specifies Bahrain windows for daily batches and treats monthly reporting separately; this fix does not change the monthly policy |
| [Window implementation](../../apps/settlement/internal/settlement/window.go), `BusinessDayWindow` | Uses the caller's year/month/day as a date label; an inline comment already points out that a UTC late-night instant has the wrong date for Bahrain |
| [Calendar-window tests](../../apps/settlement/internal/settlement/window_utc_compat_test.go) | Preserve date-label behavior and fixed Bahrain boundaries, including year-end. The fix adds a separate instant-aware wrapper rather than changing these semantics. |
| [Daemon configuration](../../apps/settlement/internal/config/config.go) | Documents a buffer after Bahrain midnight and sets defaults of 15 minutes and a 60-second poll; the old comment questions whether the daemon really computes Bahrain midnight |
| [Scheduler status logger](../../apps/settlement/internal/scheduler/status.go) and [its tests](../../apps/settlement/internal/scheduler/status_test.go) | Render an approximate next check-in using `TZ` or the local zone, but never control which batch is due. Passing these tests did not verify midnight scheduling. |
| [CLI date parsing](../../apps/settlement/cmd/settlement/main.go#L103) | Parses explicit business dates in UTC intentionally; converting that calendar label as though it were an arbitrary instant would change a separate contract |
| [May incident timeline](../incidents/postmortem-2026-05.md#L52) | Records a 00:05 daily close during a different incident. That timestamp alone does not establish the daemon's deployed delay, zone, or selected date. |
| [September batch snapshot](../exports/settlement-batches-2026-09-01_20.csv) | Contains Bahrain `paid_at_bh` timestamps around 03:06–03:08. Payout timestamps are not identical to daemon start times, and snapshots are not a complete scheduler log. |

No production daemon logs or deployment environment were inspected. The
confirmed evidence is the source-level date rollover and its deterministic
reproduction, supported by the earlier notes above.

## Verification

A temporary Go harness called the actual pure scheduling and window helpers
without any database or batch execution. It was removed from the working
tree afterward; locked tests were left unchanged.

- Exact checks covered Bahrain midnight, 00:05, the nanosecond before 00:15,
  exactly 00:15, just before/after UTC midnight, zero grace delay, year-end,
  and leap day.
- Reproduced the old selector at `2026-05-14T21:15Z` choosing May 13; the
  corrected selector chooses May 14, the day just completed in Bahrain.
- 315,792 checks covered all days in 2026 and leap-year 2028, delays of
  0/5/15/60 minutes, four host zones, and four input-time zones. The business
  date and due boundary were independent of the host and input timezone.
- Existing CLI/date-label behavior remained unchanged in an explicit
  late-UTC-December-31 check.

Final checks:

- The full PostgreSQL-backed Go run passed the scheduler, config, internal
  API, money, and split packages. Existing calendar-window tests reported
  no failures. The run still failed on the two balance-refresh and four
  finalized-MDR expectations documented in records
  [003](003-admin-balance-rebuild-source.md#verification) and
  [004](004-mdr-finalized-batches.md#verification).
- The required full PostgreSQL-backed `npm test` run did not pass. It
  retains previously recorded fee-display expectations and missing schema,
  including `adjustment_imports`, `credit_requests`, and
  `reporting_saved_filters`. No JavaScript or TypeScript code changed in
  this timing fix.
- Documentation file references and `git diff --check` passed. No locked
  test was edited or bypassed, and there is no claim of a green full suite.

## Activation and historical limits

Rebuild and restart the settlement daemon to activate the fix. For literal
midnight eligibility, configure `SETTLEMENT_DAEMON_RUN_DELAY_MINUTES=0` before
starting it; otherwise the existing default makes the close due at 00:15
Bahrain. Polling can delay the actual start beyond the configured due time.

This change does not start the local or production daemon, re-close paid
batches, replay payouts, or repair earlier close timings. The existing
startup catch-up still attempts only the most recently completed business
day. Review any older unprocessed dates separately with their actual capture
windows and batch status before proposing a manual backfill.
