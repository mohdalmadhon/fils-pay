# 14: CLAUDE.md and AGENTS.md described the money and the settlement day wrongly

| | |
|---|---|
| **Type** | Wrong documentation that steers people and AI agents into bugs |
| **Status** | Fixed (5 commits, not pushed). The security notes in the same files were corrected earlier ([`docs/cyper/16`](../cyper/16-unsafe-agent-guidance-and-invite-codes.md)). |
| **Where found** | `CLAUDE.md:22-25` and `:41-44`; `AGENTS.md:29-31`, `:38-39` and `:81-86` |

## What was wrong

| File | Claim | Reality |
|---|---|---|
| CLAUDE.md | Money is "integer cents (1 BD = 100 cents)", "the internal representation is cents" | Integer **fils**, 1 BD = 1,000. `parseBhdToFils("4.75")` is 4750; `formatBhd` shows three decimals. Two earlier bugs (adjustment import, promotional discount) were this ×10 mistake. |
| CLAUDE.md | Settlement windows use "UTC midnight"; the Bahrain zone is "only used for log timestamps" | `BusinessDayWindow` uses **Asia/Bahrain midnight** as the boundary. |
| AGENTS.md | "Settlement date windows are UTC-based" | Same as above. |
| AGENTS.md | Money columns are `INTEGER`, "BHD amounts in cents … fit in a 32-bit integer" | `BIGINT` fils. A 32-bit column overflows at about 2,147,483 BD. |
| AGENTS.md | `platform_processed_fils` is "INT4 by design … in BD (not fils)" | Fils, and the `INT4` was an overflow bug ([05](05-platform-volume-int32.md)). |
| both | "Never modify existing test files … if a test fails, your change is wrong" | Several tests asserted behaviour an accepted ADR or fix had replaced, so they stayed red and the suite was never green ([01](01-api-tests-that-always-failed.md), [02](02-recalculate-mdr-tests.md)). |

These two files are what AI coding agents read first in this repo, and the
repo tells them to treat docs as the source of truth. Following them leads
to amounts off by ×10, batches cut at the wrong hour, and 32-bit money
columns.

## Fix

| # | Commit |
|---|---|
| 1 | `docs: CLAUDE.md says money is integer fils, not cents` |
| 2 | `docs: CLAUDE.md says settlement days close at Bahrain midnight` |
| 3 | `docs: AGENTS.md money columns, platform counter and settlement day are right` |
| 4 | `docs: when an existing test may change, in CLAUDE.md and AGENTS.md` (keep the rule; one exception, handled in its own commit and recorded) |
| 5 | `docs: improvement 14, wrong guidance in agent docs` |

Each corrected line says it was corrected and points to the evidence.

## Checked

Every claim was checked against the code before it was changed:
`parseBhdToFils` and `formatBhd` (run), `window.go` (read), and the column
types in `db/migrations` (all but one `*_fils` column is `BIGINT`). No other
top-level doc repeats these claims (searched for "cents", "UTC midnight",
"UTC-based" and "INT4").

The false checksum comment in `db/migrate.ts` is handled separately, by making
it true: [15](15-migration-checksums.md).
