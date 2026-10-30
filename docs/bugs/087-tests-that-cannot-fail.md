# 087: Two integration tests never ran the code they were named after

**Severity:** Low. The March residue sweep and the seed's self-checks had
tests that passed whatever the real code did, so a bug in either would not
have been caught.

## Where

- `scripts/reconcile_march.integration.test.ts` (for `runMarchSweep` in
  `scripts/reconcile_march.ts`).
- `db/seed/selfVerify.integration.test.ts` (for `buildAssertions` and
  `runAssertions` in `db/seed/selfVerify.ts`).

## Why it was wrong

The March test only imported `computeResidueFils` and never called
`runMarchSweep`. It filled its own temporary table and checked that three
ways of writing the same arithmetic agreed:

```ts
`SELECT COALESCE(SUM(captured_fils % 10), 0)::text AS total FROM stress_captures`
...
assert.equal(modTotal, dbTotal, "mod-10 residue should match stored residue");
```

Nothing in it read `transactions`, looked at the month window, posted to
`ledger_entries` or checked a repeat run.

The self-verify test did the same thing: it inserted 3000 synthetic rows
into its own temp tables and checked its own sums. It never imported
`selfVerify.ts` or ran the seed. It was also not in any test script
(`npm test` runs `scripts/*.test.ts`, `npm run test:db` lists its files), so
nothing ran it.

## How to reproduce

Change `% 10n` to `% 100n` in `groupByMerchant` in
`scripts/reconcile_march.ts`, or break any self-verify assertion. Both old
tests still passed.

## Fix

Both tests are rewritten to run the real code in a throwaway database they
create, migrate and drop (the same pattern as `db/migrate.integration.test.ts`):

- The March test inserts captures for three merchants (inside March, in
  February, in April, with and without a residue). It checks the dry-run
  report, that a dry run posts nothing, the two balanced legs per merchant
  after `--apply`, that a second `--apply` reports `already_applied` and
  posts nothing, and that a changed March capture blocks the sweep. The rows
  stay away from the month edges, because whether the window should be the
  UTC or the Bahrain month is still an open decision.
- The self-verify test seeds the database with `generate()`, runs every
  REAL assertion (all must pass, including `seed-deterministic`), then breaks
  one transaction (`captured_fils > amount_fils`, after dropping the check
  constraint in the throwaway database) and checks that
  `captured-le-authorized` fails. It is added to `npm run test:db`.

## Test

- `scripts/reconcile_march.integration.test.ts`: "runMarchSweep previews,
  posts once per merchant, then reports already_applied". With the `% 100n`
  change above it now fails.
- `db/seed/selfVerify.integration.test.ts`: "every REAL self-verify assertion
  passes on the seed, and fails on a broken row".
