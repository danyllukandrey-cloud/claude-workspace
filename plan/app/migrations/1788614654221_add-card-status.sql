-- Up Migration

-- life-area-card: add card.status (soft archival, AC-16) + extend
-- card_lifecycle_event.transition to record the archived transition
-- Staged migration — NOT live. Promoted (real sequence number assigned) by /sdd:implement.

-- Constant DEFAULT means this is a fast metadata-only change on Postgres 11+,
-- no full table rewrite — a single ALTER is safe here, no expand/backfill/contract needed.
ALTER TABLE card
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived'));

CREATE INDEX IF NOT EXISTS idx_card_owner_active
    ON card (owner_user_id)
    WHERE status = 'active';

-- CHECK constraints can't be ALTERed directly — drop the auto-named one
-- from migration 04 and recreate it with 'archived' added.
ALTER TABLE card_lifecycle_event
    DROP CONSTRAINT IF EXISTS card_lifecycle_event_transition_check;

ALTER TABLE card_lifecycle_event
    ADD CONSTRAINT card_lifecycle_event_transition_check
        CHECK (transition IN ('created', 'filled', 'in_use', 'archived'));

-- Down Migration

-- life-area-card: revert card.status + card_lifecycle_event.transition extension
-- Staged migration — NOT live.
--
-- DATA LOSS (T51, review 2026-09-07 group D): re-adding the narrower CHECK below
-- fails outright if any row already has a transition value outside its allowed
-- set (Postgres validates EVERY existing row against a newly added constraint) --
-- card_lifecycle_event is an append-only audit log (postgres-repo.ts: "жодного
-- UPDATE/DELETE тут немає"), so there is no way to fix such a row instead of
-- deleting it. Rolling back past this migration on a database with real
-- archive/restore history permanently loses the audit record of those events.
-- Deliberate trade-off -- failing outright would leave the down-migration useless
-- for its one job (get back to a working schema), not an oversight.
--
-- NOT IN (not a literal `= 'archived'`) on purpose: this file's own down-migration
-- only ever removes 'archived' from the allowed set, but 06_add_card_restore's
-- up-migration (applied later, if it ever ran) could have left 'restored' rows
-- too -- those would ALSO violate this narrower CHECK if this migration is rolled
-- back out of the normal reverse order (or its own down-migration is run first).

ALTER TABLE card_lifecycle_event
    DROP CONSTRAINT IF EXISTS card_lifecycle_event_transition_check;

DELETE FROM card_lifecycle_event WHERE transition NOT IN ('created', 'filled', 'in_use');

ALTER TABLE card_lifecycle_event
    ADD CONSTRAINT card_lifecycle_event_transition_check
        CHECK (transition IN ('created', 'filled', 'in_use'));

DROP INDEX IF EXISTS idx_card_owner_active;

ALTER TABLE card
    DROP COLUMN IF EXISTS status;
