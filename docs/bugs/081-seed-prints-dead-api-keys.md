# 081: The seed prints two sets of API keys, and the first set does not work

**Severity:** Medium. People copying the first printed key for a merchant
(as the deploy output tells them to) got 401 from the API.

## Where

`db/seed/selfVerify.ts`, the `seed-deterministic` check, and
`db/seed/generate.ts`, `generate()`. The keys are shown by `db/seed/index.ts`
and saved by `ops/remote-deploy.sh` in `seed-output.txt`.

## Why it was wrong

`generate()` issued one API key per merchant and printed it right away:

```ts
console.log(`seed: issued API key for ${merchant.displayName}: ${issued.rawKey}`);
```

Then the `seed-deterministic` check ran the whole seed a second time to
compare checksums:

```ts
const rerun = await generate(pool);
```

That second run truncates `api_keys` and issues new keys, so it printed a
second set of 8 keys and the first 8 printed keys no longer existed. The
output showed 16 "issued API key" lines and only the last 8 worked.
`ops/remote-deploy.sh` and `docs/deploy.md` tell people to use the printed
keys, without saying which ones.

## How to reproduce

Run `npm run seed` on an empty, migrated database. Count the lines starting
`seed: issued API key for`: 16. Look up the first key's sha256 in
`api_keys.key_hash`: no row.

## Fix

`generate()` no longer prints keys; it returns them in its summary
(`issuedApiKeys`). The determinism check passes the re-run's summary back
through a new `onRegenerated` callback. `index.ts` prints the keys once,
after all the checks, from the latest run, so every printed key is live.
The check itself is unchanged.

## Test

`db/seed/printedKeys.integration.test.ts`: "every API key the seed prints is
a live api_keys row". It creates its own database, migrates and seeds it,
and looks up each printed key by hash. Before the fix: `expected: 8,
actual: 16` printed keys. It is added to `npm run test:db`.
