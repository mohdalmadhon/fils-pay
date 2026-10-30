# 07: Uploaded identity documents were stored readable by every user on the server

**Severity:** Low. On the hosted box the files live in a Docker volume, so
the exposure is to other users and processes on the host and in the
container. But these are identity documents, and nothing needs more than the
API's own user to read them.

**Area:** merchant onboarding (KYC uploads).

## How it was tested

A probe uploaded an `owner_id` PNG through
`POST /v1/merchants/:id/kyc/documents`, then looked at what was stored. The
document and its thumbnail were `-rw-r--r--` (0644), in a merchant folder
that was `drwxr-xr-x` (0755): readable by every account on the machine.
For comparison, the operator OTP file (`OTP_LOG_FILE`) is created 0600 and
refuses anything looser.

## Why it happened

`recordKycDocument` called `mkdir(dir, { recursive: true })` and
`writeFile(path, buffer)` without a mode, so the process defaults applied.

## Fix

In `apps/api/src/onboarding/kyc.ts`, the merchant's folder is created
`0700` and each file (the document and its thumbnail) `0600`. Each is then
also `chmod`-ed, because the mode given to `mkdir` or `writeFile` only
applies to something they create. A folder or file that already exists keeps
its old mode: an earlier upload, or the same document uploaded again (files
are named by their hash). Serving the documents is unchanged: the API reads
them as their owner.

Existing uploads on a running server keep their old permissions until they
are uploaded again. To tighten them now:

```sh
docker compose -f ops/docker-compose.yml exec api sh -c 'find /app/data/kyc -type d -exec chmod 700 {} + && find /app/data/kyc -type f -exec chmod 600 {} +'
```

## Test

`apps/api/src/routes/kycUploadSafety.test.ts`: "identity documents are
stored readable by the API's own user only". After an upload it checks the
folder is 0700 and every file 0600. Before the fix the folder was 0755.
