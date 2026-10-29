# Fix report: really large exports and uploads

| | |
|---|---|
| **Status** | Fixed (5 commits, not pushed) |
| **Severity** | Medium. Large webhook delivery archives (the "export" of an endpoint's history before a URL rotation) were built entirely in API memory and could fail. Adjustment CSVs over 1 MB were refused with a **500**. |
| **Component** | `apps/api/src/webhooks/archiveReplay.ts`, `routes/adminAdjustmentImport.ts`, `config.ts`, `db/migrations/0077` |
| **Reported** | "Has anyone tried uploading a really large export?" |
| **Date** | 2026-10-29 |

## Summary

**1. Webhook delivery archives.** `createWebhookDeliveryArchive`:

1. read **every** delivery in the range into the API process (no paging),
2. `JSON.stringify`'d them all into **one string**, and
3. stored it in **one text column** (`archive_payload`).

Restoring did the reverse: it read the whole value and `JSON.parse`'d it in
the API, then inserted row by row. Memory use grew with the range and the
whole history was held several times over. It fails outright past V8's
maximum string length (~512 MB, roughly a couple of hundred thousand
deliveries at a few KB each) or Postgres's 1 GB field limit. ADMIN.md said
*"Archives are written in pages of 1000 deliveries, so any range is fine"*,
and the 0068 comment said *"built in 1000-row pages and stored compressed, so a
full year's history is fine"*. Neither paging nor compression existed.

**2. Adjustment CSV uploads.** The import route ran under Fastify's default
**1 MB** body limit. That's about 15 000 short rows, or far fewer with
real reasons. A larger file never reached the importer. With the old code
the test got a **500** back, not even a 413. There was also no upper bound on rows per upload, all
applied in one transaction.

## Fix (5 commits)

| # | Commit | What |
|---|---|---|
| 1 | `db: store webhook delivery archives one row per delivery` | Migration `0077`: `webhook_delivery_archive_entries (archive_id, seq, …)`. `archive_payload` becomes optional. Existing archives are copied in (in the test DB all 32, holding 40 deliveries) and their original text is kept. |
| 2 | `webhooks: capture and restore delivery archives inside Postgres` | Capture and replay are each a single `INSERT … SELECT`, so the API never holds the archive. Replay produces exactly what the old row-by-row path produced: a new `delivery_event_id`, also written into the envelope's `id`, and `replay_of_delivery_id` linking back to the original. New `readArchiveEntries` pages through an archive 1000 entries at a time, for export. |
| 3 | `admin: accept large adjustment CSVs, up to a clear row limit` | The route's `bodyLimit` is `ADJUSTMENT_IMPORT_MAX_BYTES` (default 10 MB). Files over `ADJUSTMENT_IMPORT_MAX_ROWS` (default 20 000) are refused with `400 import_too_large` and a message to split the file, before anything is posted. |
| 4 | `test: large webhook archives and adjustment CSVs` | `largeExport.test.ts`. `archiveReplay.test.ts` now reads entries through the pager instead of parsing the old blob. |
| 5 | `docs: large export fix report` | This report, plus ADMIN.md corrected (archives and import limits). |

## Verification

- `largeExport.test.ts`: 3/3 pass.
  - A **25 000-delivery archive** with 2 KB payloads is captured with no
    JSON blob, read back in 25 ordered pages, and replayed in full, with every
    row linked and its envelope id matching. The whole file takes about 2.5 s.
  - A 1.2 MB CSV is accepted (it got a **500** with the old route). A file over
    the row limit is refused, with nothing posted (the old route posted it).
- `archiveReplay.test.ts`: 4/4 pass.
- Not shown by a test: the old archive path breaking outright. 25 000
  deliveries fit in memory; it needs a few hundred thousand.

## Deploying

1. Run `npm run migrate` (0077). It copies existing archives into the new
   table, which takes as long as their size.
2. Optionally set `ADJUSTMENT_IMPORT_MAX_BYTES` / `ADJUSTMENT_IMPORT_MAX_ROWS`.
   If a reverse proxy sits in front of the API, its own body-size limit has to
   allow the same size.

## Related, not changed here

- A restore is still all-or-nothing in one transaction, so a huge restore
  holds that transaction for a while. It no longer needs API memory to do it.
- There's no download endpoint for an archive yet. `readArchiveEntries` is
  ready for one.
- `archive_payload` of old archives can be set to NULL once nobody needs
  the original text.
