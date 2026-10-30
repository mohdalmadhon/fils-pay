# 0009. Monthly windows use the Bahrain month

- **Status:** Accepted
- **Date:** 2026-10-30
- **Deciders:** Mohammed Almadhoon
- **Supersedes:** the calendar-month part of [0003](0003-report-date-windows.md)

## Context

ADR 0003 kept daily windows on the Asia/Bahrain business day but let
calendar-month finance scripts use the UTC month, on the grounds that the
three hours moved at each end "net out". They don't, as YA noted in 0003:
those hours belong to a different month, and a monthly figure is checked
against that month's daily batches, which use the Bahrain day.
`docs/HANDOVER.md` also says the March close script must use the Bahrain
month.

It is not theoretical. The seeded March data has 528 captures between
Bahrain midnight and 03:00 on 1 March. The UTC-month March sweep missed all
of them: 4.750 BD of residue left unposted for one merchant alone
(docs/bugs/017).

## Decision

- Every window, daily or monthly, uses Asia/Bahrain time. A month is
  `[YYYY-MM-01T00:00+03:00, next month 01T00:00+03:00)`.
- Bahrain has no daylight saving, so the offset is a constant three hours.

## Consequences

- A monthly figure always equals the sum of that month's daily batches.
- To reproduce a window in a spreadsheet, subtract three hours from the
  boundaries: March starts at 2026-02-28 21:00 UTC.
- The only monthly script today is `scripts/reconcile_march.ts`. It refuses
  to post if an earlier run with the old window already posted different
  amounts (the source fingerprint differs), so the change can't double-post;
  such a posting needs a person to review it first.
