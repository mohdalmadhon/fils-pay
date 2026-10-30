-- check_ledger_group_balance (0007) checked only NEW.entry_group_id on an
-- UPDATE. Moving a leg from one group to another therefore checked only the
-- group it moved into; the group it left could be committed unbalanced.
-- docs/bugs/084-ledger-check-misses-group-a-leg-left.md.
--
-- Now an UPDATE checks both the old and the new group (once when they are
-- the same). INSERT checks NEW, DELETE checks OLD, as before. The trigger
-- itself (ledger_entries_balance, deferred to commit) is unchanged.

CREATE OR REPLACE FUNCTION check_ledger_group_balance() RETURNS TRIGGER AS $$
DECLARE
    v_groups   UUID[];
    v_group_id UUID;
    v_net      BIGINT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_groups := ARRAY[OLD.entry_group_id];
    ELSIF TG_OP = 'UPDATE' AND OLD.entry_group_id IS DISTINCT FROM NEW.entry_group_id THEN
        v_groups := ARRAY[OLD.entry_group_id, NEW.entry_group_id];
    ELSE
        v_groups := ARRAY[NEW.entry_group_id];
    END IF;

    FOREACH v_group_id IN ARRAY v_groups LOOP
        SELECT COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount_fils ELSE -amount_fils END), 0)
          INTO v_net
          FROM ledger_entries
         WHERE entry_group_id = v_group_id;

        IF v_net <> 0 THEN
            RAISE EXCEPTION 'ledger_entries group % does not balance: net % fils', v_group_id, v_net;
        END IF;
    END LOOP;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
