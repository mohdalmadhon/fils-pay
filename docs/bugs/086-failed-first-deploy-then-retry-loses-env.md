# 086: Retrying a failed first deploy deletes the only copy of the settings

**Severity:** Low. On a server set up before `~/fils-pay-config` existed, a
failed deploy followed by a retry deleted the old `ops/.env`, including the
database password the existing database volume needs.

## Where

`ops/deploy.sh`, the remote step that unpacks the code and rotates
`~/fils-pay` to `~/fils-pay.old`. The settings are copied later, in step 2
of `ops/remote-deploy.sh`.

## Why it was wrong

The remote step rotates first:

```bash
if [ -d ~/fils-pay ]; then rm -rf ~/fils-pay.old && mv ~/fils-pay ~/fils-pay.old; fi
```

and only afterwards `remote-deploy.sh` copies `~/fils-pay.old/ops/.env` (or
`.env.docker`) into `~/fils-pay-config`. On an old server:

1. Deploy 1 moves the old code, with its `ops/.env`, to `~/fils-pay.old`,
   then fails before step 2 (for example while installing Docker).
2. Deploy 2 runs `rm -rf ~/fils-pay.old`. The only `.env` is gone, and
   `remote-deploy.sh` then makes a new random `POSTGRES_PASSWORD` that does
   not open the existing database.

## How to reproduce

On a test home folder: put `ops/.env` in `~/fils-pay.old`, no
`~/fils-pay-config`, and run `ops/deploy.sh`. Before the fix
`~/fils-pay-config/.env` did not exist afterwards and `~/fils-pay.old` was
replaced.

## Fix

Before rotating, the remote step now copies `.env` and `.env.docker` from
`~/fils-pay/ops/` (then `~/fils-pay.old/ops/`) into `~/fils-pay-config`,
only if that file is not there yet, with the same folder and file
permissions `remote-deploy.sh` uses (700 and 600). This is the same rule as
`remote-deploy.sh` step 2, which is unchanged.

## Test

`scripts/deployScript.test.ts`, with a fake `ssh` that runs the remote step
against a temporary home folder:

- "a retry after a failed first deploy keeps the old in-code settings":
  before the fix, `ENOENT` for `fils-pay-config/.env`.
- "the in-code settings of the current deploy are kept, and existing config
  is never replaced".
