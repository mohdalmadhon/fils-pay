# 15: The migration runner said it checked checksums; it didn't

| | |
|---|---|
| **Type** | Database safety / wrong comment |
| **Status** | Fixed (5 commits, not pushed) |
| **Where found** | `db/migrate.ts:67-78`. A comment said *"schema_migrations also stores a checksum per file and refuses to run if an applied migration has changed"*. The next line asked *"AM: I only see filename + applied_at in the table?"*, and AM was right: the table had only those two columns. |

## What was wrong

The runner skipped any file whose name was already in `schema_migrations`.
If an applied `.sql` file was edited, nothing noticed. Existing databases
kept the old schema, new ones got the new one, and the two drifted apart
without any error.

This has already happened in this repo. 0054 and 0055 were fixed in place
([RUNBOOK](../RUNBOOK.md), "`npm run migrate` stops at 0054 or 0055"), and so
were 0078 and 0079 during the security work. Those edits were deliberate and
safe. The point is that nothing would have caught an edit that wasn't.

## Fix

| # | Commit |
|---|---|
| 1 | `test: the migration runner refuses an applied file that changed`: `db/migrateChecksum.test.ts` (scratch database and directory). It fails before the fix. |
| 2 | `migrate: record a checksum for each migration it applies` |
| 3 | `migrate: refuse to run when an applied migration has changed` |
| 4 | `docs: how to recover when migrate finds a changed migration`: RUNBOOK, CLAUDE.md, AGENTS.md |
| 5 | `docs: improvement 15, migration checksums` |

How it works now (`db/migrate.ts`):

- **Storing.** `schema_migrations.checksum` is added in place on existing
  databases (`ADD COLUMN IF NOT EXISTS`). Each newly applied file's sha256 is
  stored in the same transaction as the migration.
- **Line endings.** CRLF is changed to LF before hashing, so a Windows
  checkout (`core.autocrlf`) of an unchanged file matches.
- **Checking.** Before applying anything, every applied file still on disk is
  compared with its stored checksum. On a mismatch the runner stops, names
  the files, and applies nothing.
- **Old rows.** Rows from before this change (checksum `NULL`) take the
  current file's checksum once, and the output prints a `RECORD` line for
  each. This assumes the files in the repo today are the right ones, which
  is the state every environment is meant to be in.
- **Overrides.** `MIGRATE_ACCEPT_CHANGED=<file>[,<file>...]` accepts an edit
  that has been reviewed and is harmless, and stores the new checksum. Later
  runs don't need the flag.
- **Tests.** The runner is exported as `runMigrations(client, dir)` so it can
  be tested. `npm run migrate` and the tests that run the script as a
  subprocess work as before.

## Verified

- `db/migrateChecksum.test.ts` (2 tests) failed before the fix and passes
  after. It covers:
  - checksums are stored;
  - CRLF counts as unchanged;
  - an edited file is refused and the next migration does not run;
  - `MIGRATE_ACCEPT_CHANGED` accepts the edit once;
  - a table from the old runner gets checksums added.
- On an existing database migrated by the old runner (`cyperfresh`, 76
  files), the first run printed 76 `RECORD` lines and applied nothing. The
  second run was clean, and the table showed `76|76`.
- `npm run test:db`, which now includes the checksum test, passed 5/5.
  `scripts/serviceRoles.integration.test.ts`, which runs `db/migrate.ts` as a
  subprocess, also passes.

## After merging

- The first `npm run migrate` in each environment records checksums
  (`RECORD` lines). That is expected.
- To change an applied migration from now on, add a new file
  ([RUNBOOK](../RUNBOOK.md)).
