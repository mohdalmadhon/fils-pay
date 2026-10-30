# 080: Deploying from Windows sends scripts the server cannot run

**Severity:** High. A deploy from Git Bash on Windows (the documented way)
failed on the server before anything was started.

## Where

`ops/deploy.sh`, the `git archive ... | ssh` step. The repository had no
`.gitattributes` file.

## Why it was wrong

The deploy sends the committed code with:

```bash
git archive --format=tar HEAD | ssh "$SERVER" "..."
```

`git archive` applies the local line-ending settings. Git for Windows sets
`core.autocrlf=true` by default, so every text file in the archive, including
`ops/remote-deploy.sh`, arrived with CRLF (`\r\n`) line endings. Bash on the
Linux server reads the `\r` as part of the line, so the script's first command
failed:

```
set: pipefail
: invalid option name
```

## How to reproduce

```bash
git -c core.autocrlf=true archive HEAD ops/remote-deploy.sh | tar -xO | file -
```

Before the fix this printed "with CRLF line terminators".

## Fix

- New `.gitattributes`: `* text=auto eol=lf`, so text files are checked out
  and archived with LF on every machine. Binary types (the `.bundle` file,
  images, fonts, archives) are marked `binary` so they are never touched.
- `ops/deploy.sh` now runs `git -c core.autocrlf=false archive`, which sends
  the files exactly as committed even if someone's own settings differ.

The repository was not renormalized. Three files are committed with CRLF
(`apps/api/src/routes/paymentLinksExpiry.test.ts`,
`apps/web/src/api/paymentLinks.ts` and
`docs/incidents/2026-10-29-payment-link-paid-after-expiry.md`). With
`text=auto`, Git leaves a file that is already committed with CRLF alone, so
adding `.gitattributes` does not show them as changed. They are not shell
scripts, so they do not break a deploy. Converting them can be done later with
`git add --renormalize .` as its own change.

## Test

`scripts/deployLineEndings.test.ts` (run by the root `npm test`):

- "every shell script is checked out and archived with LF endings": before
  the fix every `.sh` file had `eol: unspecified`.
- "an archive made with core.autocrlf=true (the Git for Windows default) has
  no CR in shell scripts": before the fix it found CRLF.
- "ops/deploy.sh archives with core.autocrlf=false".
