# Solved problems

Records of implemented fixes: the symptom, root cause, evidence, changed
code, validation, and remaining limitations. An entry means a code fix
exists in the working tree; it does not imply deployment or historical
data repair.

| Problem | Fix | Remaining work |
|---|---|---|
| [001 — Scheme export rounding mismatch](001-scheme-export-rounding.md) | Derive both scheme amount columns from the same truncated integer fils value | Reconcile historical exports, confirm the acquirer's conversion rule, resolve the separate migration failure |
| [002 — Split payouts do not conserve the parent total](002-split-payout-allocation.md) | Validate weights total 100%; distribute remaining whole fils deterministically; verify the posted total | Audit historical batches and production weights; investigate discrepancies larger than rounding can explain |
| [003 — Admin/CLI balance rebuild mismatch (problem 4)](003-admin-balance-rebuild-source.md) | Make the admin button call the full CLI's payable-ledger rebuild | Verify the reported incident against production history; assess timeout and concurrency concerns separately |
| [004 — MDR recalculation rewrites finalized batches](004-mdr-finalized-batches.md) | Recalculate provisional open-batch totals only; preserve closed/paid history and financial postings | Audit historical recalculations; any remediation requires separately approved adjustments |
| [005 — Fee display selects a historical backfill](005-fee-schedule-display.md) | Select the schedule already in effect using capture's effective-date ordering | Confirm the actual production screen and rows if they differ from the saved fixture; other fee modifiers remain separate |
| [006 — CSV adjustment import misreads BD as two-decimal minor units](006-adjustment-import-bhd-parsing.md) | Parse signed BD with the validated `parseBhdToFils` helper, preserving three decimals | Audit old raw amount text against posted fils; any correction must avoid duplicating existing imports |
| [007 — Merchant login accepts a pending pre-OTP session](007-merchant-otp-session-gate.md) | Require OTP completion, no revocation, and a valid expiry in the shared session lookup | Deploy/restart API instances; production access history has not been audited |
| [008 — Daily close rolls over at 03:00 Bahrain time](008-daily-close-bahrain-time.md) | Convert the current instant to the Bahrain calendar before selecting the completed business day | Rebuild/restart the daemon; preserve or explicitly configure the midnight grace period; review missed historical dates separately |
| [009 — Lifetime payout estimate drifts at high volume](009-lifetime-payout-estimate.md) | Add integer fils; migrate REAL to BIGINT and reconstruct the counter from actual payout ledger legs; stop seeding unpaid totals | DBA review and maintenance deployment of migration 0073; restart connections; verify complete historical ledger coverage |
| [010 — Test merchants enter real settlement after status recomputation](010-test-merchants-in-settlement.md) | Remove automatic sandbox-to-live promotion from the admin status-recompute action | Deploy API; review prior flag-clearing audit events and affected merchants/batches before historical remediation |
| [011 — Merchant A can cancel merchant B's payment link](011-payment-link-cancel-ownership.md) | Scope cancellation and status lookup to the authenticated merchant as well as link ID | Deploy API; investigate prior cancellations using retained request/session logs before restoring or replacing links |
| [012 — March residue sweep posts again on every run](012-march-sweep-repeat-postings.md) | Default to read-only preview; verify stable per-merchant keys and source fingerprints; serialize applies; block uncertain history | Retire old copies; review historical postings and finance scope before applying or correcting duplicates |
| [013 — Integrate finance fixes with main](013-finance-main-merge.md) | Combine distinct fixes and preserve each branch's safeguards | Existing test failures and broken migrations remain documented; production rollout is separate |

For future entries, use the next number and a descriptive filename. Include
before/after examples and links to the affected code. Line numbers reflect
the code when the entry was written; use function names if lines move.

