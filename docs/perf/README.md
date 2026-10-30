# Performance investigations

| Report | Scope |
|---|---|
| [Remaining capacity fixes](2026-10-30-remaining-capacity-fixes.md) | Search indexes, webhook/import/reporting batching, bounded delivery concurrency, CSV memory, compiled runtime and hosting limits; output parity and measured results. |
| [2026-10-30 capacity follow-up](2026-10-30-capacity-follow-up.md) | Independent review of capacity commits, batching fixes and CSV compatibility check, comparative verification and measured checkout ceiling. |
| [Checkout capacity and recovery](checkout-capacity.md) | Original capacity work: pool sizing, ledger indexes, shorter balance locks, overload and restart behavior. |
| [2026-10-30 backend load audit](2026-10-30-backend-load-audit.md) | Historical snapshot at `9571805`: restart, reads and checkout load, pool contention, per-row SQL, memory and query-plan evidence. Documentation only. |
| [Reproducing the October audit](2026-10-30-load-test-reproduction.md) | Tools, disposable dataset and request generators. |
| [2026-09 FP-209](fp-209-loadtest-2026-09.md) | Historical container/dataset run; its pass result applies to its recorded conditions. |
