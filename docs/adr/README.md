# Architecture decision records

One file per decision. Never edit an accepted ADR's decision; write a new
one that supersedes it and update the status line of the old one.

| # | Title | Status | Date |
|---|---|---|---|
| 0001 | [Money is integer fils everywhere](0001-integer-fils.md) | Accepted | 2025-10-02 |
| 0002 | [Journal scheme rounding residue at export](0002-scheme-residue-at-export.md) | Accepted, implemented | 2025-11-20 |
| 0003 | [Date windows for reports and finance scripts](0003-report-date-windows.md) | Accepted; monthly part superseded by 0009 | 2026-02-26 |
| 0004 | [Balance cache rebuild source](0004-balance-rebuild-source.md) | Superseded by 0007 | 2026-05-30 |
| 0005 | [Settlement v2 and the shadow ledger](0005-settlement-v2-shadow-ledger.md) | Proposed (paused) | 2026-05-18 |
| 0006 | [Adjustments are display corrections, not postings](0006-display-adjustments.md) | Accepted | 2026-05-04 |
| 0007 | [Every balance rebuild reads the ledger](0007-balance-rebuild-reads-the-ledger.md) | Accepted | 2026-10-29 |
| 0008 | [MDR recalculation preserves finalized batches](0008-mdr-finalized-batches.md) | Accepted | 2026-10-29 |
| 0009 | [Monthly windows use the Bahrain month](0009-monthly-windows-use-the-bahrain-month.md) | Accepted | 2026-10-30 |

The finance branch independently recorded an ADR numbered 0007. Its
[original record](0007-ledger-backed-admin-balance-rebuild.md) is retained
as historical context; the merged implementation uses the canonical 0007
listed above. See [merge decisions](../solved-problems/013-finance-main-merge.md).
