# 07: A secret committed to the repo, and Postgres open to the internet

| | |
|---|---|
| **Severity** | High |
| **Status** | Fixed in the repo (5 commits, not pushed). **Rotation needed:** see [After merging](#after-merging). |
| **Component** | `.gitignore`, `ops/.env.docker`, `ops/docker-compose.yml` |
| **Found** | Security review, 2026-10-30 |

## What was wrong

**The acquirer callback signing secret was in git.**
- `ops/.env.docker` held `ACQUIRER_CALLBACK_SIGNING_SECRET`.
- The file's own comment said it was gitignored. A second note said a chat
  assistant had confirmed that `.env` in `.gitignore` matches `.env.docker` "as
  a prefix". It doesn't. Gitignore has no prefix matching, and the file was
  tracked from the first commit (`669af52`).
- The comment also said the secret was "rotated in July after the b64cd3c
  commit". No commit `b64cd3c` exists in the repository. The file has a single
  commit, and the value never changed.

**Postgres was reachable from anywhere.**
- `docker-compose.yml` published `"5432:5432"` with the password
  `filspay_dev_password`, and every service uses that one role.
- The header says the hosted demo box runs this file.
- Docker's published ports bypass host firewalls such as ufw.

## Attack

- With the repo: sign `fraud_review.completed` callbacks to
  `/v1/acquirer/callbacks` and approve or reject fraud reviews.
- With the box's address: connect to Postgres as the owner role. Read or change
  anything: ledger, balances, sessions, encrypted webhook secrets.

## Fix

| # | Commit | What |
|---|---|---|
| 1 | `test: no environment files with real values are tracked` | `scripts/repoHygiene.test.ts`. Fails before the fix. Runs with `npm test`. |
| 2 | `gitignore: ignore every .env variant except .example templates` | `.env.*`, with `!.env*.example`. |
| 3 | `ops: stop tracking .env.docker; commit a template instead` | `git rm --cached ops/.env.docker`; adds `ops/.env.docker.example` with placeholders. |
| 4 | `ops: keep Postgres off the network and take its password from the environment` | Binds `127.0.0.1:5432`. `POSTGRES_PASSWORD` is required and used in every `DATABASE_URL`. |
| 5 | `docs: cyper 07, committed secret and open database` | This file. |

## Verified

`scripts/repoHygiene.test.ts` passes (2). `docker compose config` shows
`host_ip: 127.0.0.1` and refuses to render without `POSTGRES_PASSWORD`.

## After merging

1. **Rotate `ACQUIRER_CALLBACK_SIGNING_SECRET` with the acquirer.** The old
   value is in git history permanently, in every clone. Removing the file doesn't
   un-leak it.
2. **Recreate `ops/.env.docker` locally:** `cp ops/.env.docker.example
   ops/.env.docker` and fill in the new secret. Pulling this change deletes the
   tracked copy from your working tree.
3. **Change the database password on the hosted box.** `POSTGRES_PASSWORD`
   only applies when the data volume is first created. On an existing volume,
   run `ALTER ROLE filspay PASSWORD '...'`, then put the same value in
   `ops/.env`.
4. Check the box for connections to 5432 from outside (Postgres logs, or the
   provider's flow logs) since it was first deployed.
5. Optional: purge the secret from history with `git filter-repo`. This
   rewrites every commit hash and everyone must re-clone. Rotation (step 1)
   matters more.
