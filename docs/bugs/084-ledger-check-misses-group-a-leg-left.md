# 084: The ledger balance check misses the group a leg was moved out of

**Severity:** Low. An UPDATE could leave a ledger entry group with debits
not equal to credits, which the trigger is there to prevent. No code moves
legs today, so it needs a manual or buggy UPDATE.

## Where

`db/migrations/0007_ledger_double_entry.sql`, the trigger function
`check_ledger_group_balance()` behind the `ledger_entries_balance`
constraint trigger.

## Why it was wrong

The function picks one group to check:

```sql
IF TG_OP = 'DELETE' THEN
    v_group_id := OLD.entry_group_id;
ELSE
    v_group_id := NEW.entry_group_id;
END IF;
```

On an UPDATE that changes `entry_group_id`, it checks only the group the row
moved into. The group the row left is never checked. The comment at the end
of 0007 says an edited leg "unbalances its group and the commit is
rejected", which is only true when the group stays the same.

## How to reproduce

In one transaction: group A has a 100 fils debit and a 100 fils credit.
Move the credit to a new group B
(`UPDATE ledger_entries SET entry_group_id = B ...`) and insert a 100 fils
debit into B. Commit. Before the fix the commit succeeded: B balances, but
A is left with a lone 100 fils debit.

## Fix

New migration `db/migrations/0087_ledger_balance_checks_old_group.sql`
replaces the function. On an UPDATE that changes the group it checks both
the old and the new group. INSERT and DELETE are checked as before, and the
trigger itself is unchanged.

## Test

`db/ledgerGroupBalance.integration.test.ts` (added to `npm run test:db`):

- "moving a leg out of a group is refused when it leaves that group
  unbalanced": before the fix, `Missing expected rejection`.
- "an UPDATE that keeps both groups balanced is still allowed".
