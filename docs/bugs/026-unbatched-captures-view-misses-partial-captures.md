# 026: The unbatched-captures view leaves out partial captures

**Severity:** Low. Anyone using the view to see what is still waiting for
settlement saw too little whenever a payment was captured in parts.

## Where

`db/migrations/0054_views.sql`, view `v_unbatched_capture_events`.

## Why it was wrong

The view only kept full captures:

```sql
WHERE te.event_type = 'captured'
  AND te.settlement_batch_id IS NULL;
```

CloseBatch settles both kinds of capture event:

```sql
AND te.event_type IN ('captured', 'partially_captured')
```

So every unbatched `partially_captured` event was missing from the view,
and its totals were lower than what the next batch would actually settle.

## How to reproduce

Capture a payment in parts (one `captured` and one `partially_captured`
event, neither batched) and select it from `v_unbatched_capture_events`.
Before the fix only the `captured` event came back.

## Fix

New migration `db/migrations/0084_unbatched_capture_events_include_partial.sql`
recreates the view with `te.event_type IN ('captured', 'partially_captured')`.
The columns are unchanged, so `CREATE OR REPLACE VIEW` is enough. 0054 itself
is not edited, because already-applied migrations are checksummed.

## Test

`db/migrate.integration.test.ts`: "all migrations apply to an empty database,
and re-running is a no-op" now also inserts one event of each kind and checks
that the view returns both. Before the migration it returned only the
`captured` row.
