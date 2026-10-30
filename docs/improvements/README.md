# Improvements: `cyper` branch, 2026-10-30

After the security review ([`docs/cyper`](../cyper/README.md)), these fixes
cover the rest of the system: tests that were always red, money bugs,
missing pieces needed to run it, CI, the database, documentation, the
customer-facing pages, browser tests and accessibility.

Each report says **where the problem was found** (file and line, or the
missing file), **what was wrong**, **what the fix was** and **how it was
verified**. Each fix is 5 commits, usually starting with a test that fails
before the fix. 19 is the round of fixes from an independent review of 15–18.

**Nothing is pushed.** All commits are on the local `cyper` branch, authored
and committed as `malmadhoo`.

## Fixed

| # | Issue | Kind | Report |
|---|---|---|---|
| 01 | Two API tests failed on every run (fee display, webhook backoff) | Tests | [01](01-api-tests-that-always-failed.md) |
| 02 | Four Go settlement tests asserted behaviour that ADR 0008 replaced | Tests | [02](02-recalculate-mdr-tests.md) |
| 03 | Reporting tests failed because API tests left malformed outbox events behind | Tests / operations | [03](03-reporting-tests-and-outbox-leftovers.md) |
| 04 | Large settlement batches paid out the wrong net amount (`float32`) | **Money** | [04](04-net-payout-float32.md) |
| 05 | The platform volume counter would overflow just past the tier threshold (`INT4`) | **Money** | [05](05-platform-volume-int32.md) |
| 06 | The negotiated discount was charged three different ways | **Money** | [06](06-negotiated-discount-consistency.md) |
| 07 | The API and settlement could pick different fee schedules on the same day | **Money** | [07](07-fee-schedule-tie-break.md) |
| 08 | Refunds weren't reachable, and the helper behind them could refund another merchant's transaction | Feature + security | [08](08-refunds.md) |
| 09 | The Dockerfiles that compose builds from didn't exist | Deployment | [09](09-dockerfiles.md) |
| 10 | No CI | Process | [10](10-ci.md) |
| 11 | Signup had no limits, no password rules, no record of email ownership | Security | [11](11-signup-abuse.md) |
| 12 | `docker compose up` emptied the database every time (the seed ran on every start) | **Data loss** | [12](12-seed-wipes-the-database.md) |
| 13 | Every service connected as the database owner | Security | [13](13-database-roles.md) |
| 14 | CLAUDE.md and AGENTS.md described the money and the settlement day wrongly | Docs | [14](14-wrong-guidance-in-agent-docs.md) |
| 15 | The migration runner claimed to check checksums and didn't | Database | [15](15-migration-checksums.md) |
| 16 | A suspended merchant's payment link still looked payable to customers | Customer-facing | [16](16-suspended-merchant-payment-links.md) |
| 17 | Nothing tested the dashboard or checkout in a browser | Tests | [17](17-browser-end-to-end-check.md) |
| 18 | Accessibility: amounts unreadable to screen readers, low-contrast text, missing headings, unannounced errors | Accessibility | [18](18-accessibility.md) |
| 19 | Follow-ups from an independent review of 15–18: migrate's check not atomic, an in-flight payment shown as "unavailable", a check that couldn't fail, the costume heading, CI start step | Review | [19](19-review-follow-ups.md) |

## The state after these fixes

- `npm test` is green for the first time: every workspace and the scripts.
  `go test ./...` passes. `npm run test:db` passes.
- `npm run e2e:browser` passes 11/11. `npm run e2e:a11y` passes on 39/39 pages
  (light, night and the Halloween costume).
- CI (`.github/workflows/ci.yml`) runs all of the above on every pull request.

## Do these after merging

| Who | What | From |
|---|---|---|
| GitHub admin | Protect `main`: require **Typecheck and build**, **Tests**, **Settlement**, **Browser end-to-end** and **Dependency audit**, plus one approval | [10](10-ci.md), [17](17-browser-end-to-end-check.md) |
| Ops | Add `API_DB_PASSWORD`, `SETTLEMENT_DB_PASSWORD` and `REPORTING_DB_PASSWORD` to `ops/.env` | [13](13-database-roles.md) |
| Ops | Run `npm run migrate` (0080, 0081) before the next settlement run. The first run records checksums (`RECORD` lines). | [05](05-platform-volume-int32.md), [11](11-signup-abuse.md), [15](15-migration-checksums.md) |
| Ops | On the hosted box, check whether past deploys reset the database; don't run the seed there | [12](12-seed-wipes-the-database.md) |
| Finance | Review the payouts and fees listed under "For finance" | [04](04-net-payout-float32.md), [06](06-negotiated-discount-consistency.md) |
| API clients | Handle the new public payment-link status `unavailable`, `400 weak_password` and `429 too_many_signups` | [16](16-suspended-merchant-payment-links.md), [11](11-signup-abuse.md) |

## Not done here

- **pgx 5.9.x:** it needs Go 1.25, which can't be downloaded in this
  environment ([`docs/cyper/15`](../cyper/15-vulnerable-dependencies.md)).
- **`docker build`:** Docker Hub isn't reachable here. The Dockerfile
  steps were run by hand instead ([09](09-dockerfiles.md)).
- **The Ops console in the browser and accessibility checks** ([17](17-browser-end-to-end-check.md), [18](18-accessibility.md)).
- **A real screen-reader test** before a public launch ([18](18-accessibility.md)).
